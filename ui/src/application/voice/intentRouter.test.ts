/**
 * intentRouter tests — pin the dispatcher's MVP contract:
 *
 *   - edit-score route  → applyEditStream + audio.eval in sequence.
 *   - non-edit intents  → onError fired, Effect.unit, no LLM/audio calls.
 *   - self-heal reject  → onError fired, Effect.fail.
 *
 * We stand up fakes for `LLMClient.streamCompletion` and
 * `AudioEngine.eval` so each test counts how many times each was
 * called and with what payload. The wiring mirror is identical to
 * `llmEdit.test.ts` (`Layer.succeed` + capturing dispatch).
 */

import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { LLMClient, AudioEngine, type CompletionChunk, type CompletionRequest } from '~/domain/services';
import {
  routeIntent,
  type RouterContext,
  type RouterCallbacks,
} from './intentRouter';
import type { VoiceIntent } from '~/domain/voice/VoiceIntent';

const chunk = (delta: string): ReadableStream<CompletionChunk> =>
  new ReadableStream<CompletionChunk>({
    start(controller) {
      controller.enqueue({ type: 'text', delta });
      controller.close();
    },
  });

type Recorder = {
  llmCalls: number;
  evalCalls: number;
  lastEvalInput: string | null;
};

const buildServices = (response: ReadableStream<CompletionChunk>): { layer: Layer.Layer<LLMClient | AudioEngine, never, never>; rec: Recorder } => {
  const rec: Recorder = { llmCalls: 0, evalCalls: 0, lastEvalInput: null };
  const llmLayer = Layer.succeed(
    LLMClient,
    {
      streamCompletion: (_req: CompletionRequest) => {
        rec.llmCalls += 1;
        return Effect.succeed(response);
      },
    },
  );
  const audioLayer = Layer.succeed(
    AudioEngine,
    {
      eval: (snippet: string) => {
        rec.evalCalls += 1;
        rec.lastEvalInput = snippet;
        return Effect.void;
      },
      stop: () => Effect.void,
      compileAndQuery: () => Effect.succeed([]),
      setCps: () => Effect.void,
      setLayerMix: () => Effect.void,
      setScore: () => Effect.void,
      getCycleProgress: () => Effect.succeed(0),
      getActiveHaps: () => Effect.succeed([]),
      recordLive: () => Effect.die('not used'),
      renderOffline: () => Effect.die('not used'),
    },
  );
  return {
    layer: Layer.merge(llmLayer, audioLayer),
    rec,
  };
};

const ctx = (_rec: Recorder, currentScore = ''): RouterContext => ({
  // Services come from `yield*` inside the router effect; here we
  // only carry per-route scalars. The recorder is parameterised but
  // unused at this layer — service-side counters live on the fakes.
  currentScore,
  nowMs: 1_700_000_000_000,
});

describe('routeIntent — edit-score route', () => {
  it('streams LLM tokens and calls audio.eval with the cleaned score', async () => {
    const { layer, rec } = buildServices(chunk('note("c4")'));
    const tokens: Array<string> = [];
    const completedWith: Array<string | null> = [null];
    const callbacks: RouterCallbacks = {
      onToken: (t) => tokens.push(t),
      onComplete: (s) => {
        completedWith[0] = s;
      },
    };
    const intent: VoiceIntent = {
      kind: 'edit-score',
      instruction: 'wrap in note',
      confidence: 0.9,
      timestampMs: ctx(rec).nowMs,
    };
    const eff = routeIntent(intent, ctx(rec), callbacks).pipe(Effect.provide(layer));
    await Effect.runPromise(eff);
    expect(rec.llmCalls).toBe(1);
    expect(rec.evalCalls).toBe(1);
    expect(rec.lastEvalInput).toBe('note("c4")');
    expect(tokens.join('')).toBe('note("c4")');
    expect(completedWith[0]).toBe('note("c4")');
  });

  it('calls audio.eval with the current score when the LLM emits unchanged output', async () => {
    // The classify path treats "no-edit instruction" as a pass-through.
    // The router still has to evaluate (so the AudioEngine reflects
    // the latest upstream state — useful when LLM service is unreachable).
    const { layer, rec } = buildServices(chunk('note("c4")'));
    const intent: VoiceIntent = {
      kind: 'edit-score',
      instruction: '',
      confidence: 0.5,
      timestampMs: ctx(rec).nowMs,
    };
    await Effect.runPromise(
      routeIntent(intent, ctx(rec, 'note("c4")')).pipe(Effect.provide(layer)),
    );
    expect(rec.llmCalls).toBe(1);
    expect(rec.evalCalls).toBe(1);
    expect(rec.lastEvalInput).toBe('note("c4")');
  });
});

describe('routeIntent — unsupported intents', () => {
  it('fires onError and skips LLM/audio for any non-edit-score intent', async () => {
    const { layer, rec } = buildServices(chunk('note("c4")'));
    const errors: Array<Error> = [];
    const intent: VoiceIntent = {
      kind: 'transport',
      action: 'play',
      timestampMs: ctx(rec).nowMs,
    };
    const eff = routeIntent(intent, ctx(rec), { onError: (e) => errors.push(e) }).pipe(
      Effect.provide(layer),
    );
    await Effect.runPromise(eff);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('intent not implemented in MVP: transport');
    expect(rec.llmCalls).toBe(0);
    expect(rec.evalCalls).toBe(0);
  });

  it('fires onError for every other VoiceIntent.kind (exhaustive switch)', async () => {
    const { layer, rec } = buildServices(chunk('note("c4")'));
    const kinds: ReadonlyArray<VoiceIntent['kind']> = [
      'clarify',
      'transport',
      'preset',
      'system',
      'whistle',
      'help',
    ];
    for (const kind of kinds) {
      const errors: Array<Error> = [];
      const intent = (
        kind === 'transport'
          ? ({ kind, action: 'play', timestampMs: 0 } as const)
          : kind === 'preset'
            ? ({ kind, action: 'load', target: 'x', timestampMs: 0 } as const)
            : kind === 'system'
              ? ({ kind, action: 'undo', timestampMs: 0 } as const)
              : kind === 'whistle'
                ? ({ kind, mode: 'capture', timestampMs: 0 } as const)
                : kind === 'clarify'
                  ? ({ kind, question: 'q', timestampMs: 0 } as const)
                  : ({ kind, query: 'q', timestampMs: 0 } as const)
      ) as VoiceIntent;
      await Effect.runPromise(
        routeIntent(intent, ctx(rec), { onError: (e) => errors.push(e) }).pipe(
          Effect.provide(layer),
        ),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain(`intent not implemented in MVP: ${kind}`);
    }
    expect(rec.llmCalls).toBe(0);
    expect(rec.evalCalls).toBe(0);
  });
});

describe('routeIntent — failure paths', () => {
  it('fires onError when the LLM emits a structurally broken score twice', async () => {
    // Two-stream fake: first attempt broken, second attempt also
    // broken (closes the self-heal budget). The router should map
    // the resulting Effect failure through `onError` and reject.
    const counter = { calls: 0 };
    const llmLayer = Layer.succeed(
      LLMClient,
      {
        streamCompletion: () => {
          counter.calls += 1;
          // Each call gets a fresh ReadableStream — they are
          // single-use, so a shared instance would lock on the
          // second attempt and produce an empty delta.
          return Effect.succeed(
            new ReadableStream<CompletionChunk>({
              start(controller) {
                controller.enqueue({ type: 'text', delta: 'stack(note("c4"' }); // unbalanced
                controller.close();
              },
            }),
          );
        },
      },
    );
    const audioLayer = Layer.succeed(AudioEngine, {
      eval: () => Effect.die('eval should not be called on broken'),
      stop: () => Effect.void,
      compileAndQuery: () => Effect.succeed([]),
      setCps: () => Effect.void,
      setLayerMix: () => Effect.void,
      setScore: () => Effect.void,
      getCycleProgress: () => Effect.succeed(0),
      getActiveHaps: () => Effect.succeed([]),
      recordLive: () => Effect.die('not used'),
      renderOffline: () => Effect.die('not used'),
    });
    const errors: Array<Error> = [];
    const intent: VoiceIntent = {
      kind: 'edit-score',
      instruction: 'do thing',
      confidence: 0.9,
      timestampMs: 0,
    };
    const eff = routeIntent(
      intent,
      { currentScore: 'note("c4")', nowMs: 0 },
      { onError: (e) => errors.push(e) },
    ).pipe(Effect.provide(Layer.merge(llmLayer, audioLayer)));

    await expect(Effect.runPromiseExit(eff)).resolves.toMatchObject({ _tag: 'Failure' });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('self-heal failed');
    // Both attempts fired.
    expect(counter.calls).toBe(2);
  });
});
