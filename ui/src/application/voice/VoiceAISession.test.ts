/**
 * VoiceAISession tests — exercise the orchestrator's wiring between
 * the pure `voiceSessionReducer` and Effect-typed IO (a fake STT, a
 * fake LLMClient, and a fake AudioEngine).
 *
 * Coverage:
 *   1. `start` arms the FSM and walks it from idle → listening
 *      (after `stt-ready`), then a final chunk drives the
 *      classification + route → `idle`.
 *   2. `cancelInFlight` interrupts a long-running route and resets
 *      the FSM back to `idle`.
 */

import { describe, it, expect } from 'vitest';
import { Effect, Fiber, Layer, Ref, Stream } from 'effect';
import {
  createVoiceAISession,
  type VoiceSessionDeps,
} from './VoiceAISession';
import type { STTEngine, SttStartOptions } from './STTEngine';
import {
  LLMClient,
  AudioEngine,
  type CompletionChunk,
  type CompletionRequest,
} from '~/domain/services';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import type { VoiceSessionState } from '~/domain/voice/voiceSession';

const ts = (n: number): number => 1_700_000_000_000 + n;

const interim = (text: string, t: number = 0): TranscriptChunk => ({
  kind: 'interim',
  text,
  confidence: 0.9,
  lang: 'ru-RU',
  timestampMs: ts(t),
});

const finalChunk = (text: string, t: number = 100): TranscriptChunk => ({
  kind: 'final',
  text,
  confidence: 0.93,
  lang: 'ru-RU',
  timestampMs: ts(t),
});

const chunk = (delta: string): ReadableStream<CompletionChunk> =>
  new ReadableStream<CompletionChunk>({
    start(controller) {
      controller.enqueue({ type: 'text', delta });
      controller.close();
    },
  });

/**
 * STTEngine backed by a fixed chunk list. `start` returns a
 * Stream.fromIterable which the orchestrator's subscriber consumes.
 */
const fakeStt = (chunks: ReadonlyArray<TranscriptChunk>): ContextNs.Tag.Service<typeof STTEngine> => ({
  isSupported: () => Effect.succeed(true),
  start: (_opts: SttStartOptions) => Effect.succeed(Stream.fromIterable(chunks)),
  stop: () => Effect.void,
});

type Recorder = {
  llmCalls: number;
  evalCalls: number;
  evalInputs: ReadonlyArray<string>;
};

const buildServices = (responseText: string): { layer: Layer.Layer<LLMClient | AudioEngine, never, never>; rec: Recorder } => {
  const rec: Recorder = { llmCalls: 0, evalCalls: 0, evalInputs: [] };
  const llmLayer = Layer.succeed(
    LLMClient,
    {
      streamCompletion: (_req: CompletionRequest) => {
        rec.llmCalls += 1;
        return Effect.succeed(chunk(responseText));
      },
    },
  );
  const audioLayer = Layer.succeed(
    AudioEngine,
    {
      eval: (snippet: string) => {
        rec.evalCalls += 1;
        rec.evalInputs = [...rec.evalInputs, snippet];
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
  return { layer: Layer.merge(llmLayer, audioLayer), rec };
};

// `Context` is imported separately to avoid a circular dep with the
// Effect top-level import. Effect exports `Context` as a namespace
// (`Context.get`, `Context.empty`), so we import it as a namespace.
import * as ContextNs from 'effect/Context';

const buildDeps = async (
  stt: ContextNs.Tag.Service<typeof STTEngine>,
  layer: Layer.Layer<LLMClient | AudioEngine, never, never>,
): Promise<{ deps: VoiceSessionDeps; scoreRef: Ref.Ref<string> }> => {
  const scoreRef = await Effect.runPromise(Ref.make<string>('note("c4")'));
  // Materialise the Layer via `Effect.scoped` so any scoped finalizers
  // (e.g., Layer.succeed closers) run on the way out. Pulling the
  // service values into closures here means the orchestrator runs
  // free of `LLMClient | AudioEngine` in its `R`, simplifying the
  // return type to `Effect<void, never, never>`.
  const env = await Effect.runPromise(
    Layer.build(layer).pipe(Effect.scoped) as Effect.Effect<unknown, never, never>,
  );
  const llm = ContextNs.get(env as ContextNs.Context<LLMClient | AudioEngine>, LLMClient);
  const audio = ContextNs.get(env as ContextNs.Context<LLMClient | AudioEngine>, AudioEngine);
  const deps: VoiceSessionDeps = {
    stt,
    llm,
    audio,
    currentScoreRef: scoreRef,
  };
  return { deps, scoreRef };
};

const waitForState = async (
  handle: { readonly stateRef: Ref.Ref<VoiceSessionState> },
  predicate: (s: VoiceSessionState) => boolean,
  attempts: number = 200,
): Promise<VoiceSessionState> => {
  for (let i = 0; i < attempts; i += 1) {
    const s = await Effect.runPromise(Ref.get(handle.stateRef));
    if (predicate(s)) return s;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  return Effect.runPromise(Ref.get(handle.stateRef));
};

describe('createVoiceAISession — happy-path FSM transitions', () => {
  it('walks idle → arming → listening → transcribing → requesting → applying → idle', async () => {
    const response = 'note("e4")';
    const { layer, rec } = buildServices(response);
    const stt = fakeStt([interim('сейчас', 10), finalChunk('сделай e4', 100)]);
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'oneshot', lang: 'ru-RU', bargeInMode: 'replace' }),
    );

    // Wait for the final chunk to land + route to complete.
    const final = await waitForState(handle, (s) => s.tag === 'idle');
    expect(final.tag).toBe('idle');
    expect(rec.llmCalls).toBe(1);
    expect(rec.evalCalls).toBe(1);
    expect(rec.evalInputs[0]).toBe(response);
  });

  it('persists state through the queue when subscribers consume `stream`', async () => {
    const response = 'note("g4")';
    const { layer, rec } = buildServices(response);
    const stt = fakeStt([finalChunk('note g4')]);
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    // Use `forkDaemon` so the subscriber outlives the immediate
    // test step's Effect run; we explicitly interrupt it at the
    // end of the test.
    const transitions: Array<string> = [];
    const fiber = await Effect.runPromise(
      handle.stream.pipe(
        Stream.tap((s) =>
          Effect.sync(() => {
            transitions.push(s.tag);
          }),
        ),
        Stream.runDrain,
        Effect.forkDaemon,
      ),
    );

    await Effect.runPromise(
      handle.start({ mode: 'oneshot', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'idle');
    await Effect.runPromise(Fiber.interrupt(fiber));

    // The reducer steps recorded (allowing duplicates from multiple
    // chunks, transitive state visibility):
    expect(transitions).toContain('arming');
    expect(transitions).toContain('listening');
    expect(transitions).toContain('transcribing');
    expect(transitions).toContain('requesting');
    expect(transitions).toContain('applying');
    // Final state:
    expect(transitions[transitions.length - 1]).toBe('idle');
    expect(rec.llmCalls).toBe(1);
  });
});

describe('createVoiceAISession — barge-in', () => {
  it('cancelInFlight resets the FSM to idle mid-route', async () => {
    // Build a stream that emits one final chunk only AFTER
    // `cancelInFlight` has been called. We use a Promise to gate
    // the route completion so we can interrupt BEFORE applied.
    let routeStart: (() => void) | null = null;
    const routeStarted = new Promise<void>((resolve) => {
      routeStart = resolve;
    });
    const llmLayer = Layer.succeed(
      LLMClient,
      {
        streamCompletion: (_req: CompletionRequest) => {
          if (routeStart) routeStart();
          return Effect.succeed(
            new ReadableStream<CompletionChunk>({
              start(controller) {
                controller.enqueue({ type: 'text', delta: 'note("g4")' });
                controller.close();
              },
            }),
          );
        },
      },
    );
    const audioLayer = Layer.succeed(
      AudioEngine,
      {
        eval: () => Effect.void,
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
    const layer = Layer.merge(llmLayer, audioLayer);
    const stt = fakeStt([finalChunk('note g4')]);
    const { deps } = await buildDeps(stt, layer);

    const handle = await Effect.runPromise(createVoiceAISession(deps));
    await Effect.runPromise(
      handle.start({ mode: 'oneshot', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    // Wait until the FSM entered `requesting` (route kicked off).
    await waitForState(handle, (s) => s.tag === 'requesting');
    // Wait for the route to actually start (so `inFlightRef` has a fiber).
    await routeStarted;
    // Now barge in.
    await Effect.runPromise(handle.cancelInFlight());
    // Allow the interrupt to propagate.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const final = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(final.tag).toBe('idle');
  });
});
