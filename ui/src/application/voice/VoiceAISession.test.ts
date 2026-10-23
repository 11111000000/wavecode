/**
 * VoiceAISession tests — exercise the orchestrator's wiring between
 * the pure `voiceSessionReducer` and Effect-typed IO (a fake STT, a
 * fake LLMClient, and a fake AudioEngine).
 *
 * Coverage:
 *   1. Final chunk lands the FSM in `review` (auto path) — the
 *      route does NOT fire until `sendReview` is called. The two
 *      steps are observed independently so a regression that
 *      silently re-introduces auto-commit fails loudly.
 *   2. `sendReview` after auto-review routes the edited text and
 *      the FSM reaches `idle`.
 *   3. `cancelInFlight` interrupts a long-running route (forked by
 *      `runRouteFromReview`) and resets the FSM back to `idle`.
 *   4. `enterReview` (manual path), `sendReview`, `cancelReview`,
 *      and the no-op-on-non-review guard.
 */

import { describe, it, expect } from 'vitest';
import { Effect, Fiber, Layer, Ref, Stream, type StreamEmit } from 'effect';
import {
  createVoiceAISession,
  type VoiceSessionDeps,
} from './VoiceAISession';
import type { STTEngine, SttStartOptions, SttUnsupportedError } from './STTEngine';
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

/**
 * STTEngine whose stream is driven by the test rather than by a
 * microphone. `capture` records what the (imaginary) mic heard; the
 * `final` chunk is only emitted when `stop()` is called, which is
 * exactly how the real server engine behaves now that release
 * flushes the take instead of cancelling it.
 *
 * Emission is buffered rather than dropped when `stop()` wins the
 * race against the subscriber fiber attaching — `handle.start`
 * dispatches `stt-ready` BEFORE it forks the subscriber, so a test
 * can legitimately observe `listening` before `asyncPush`'s register
 * has run.
 */
const controllableStt = (): {
  readonly svc: ContextNs.Tag.Service<typeof STTEngine>;
  readonly capture: (text: string) => void;
} => {
  type Handler = StreamEmit.EmitOpsPush<SttUnsupportedError, TranscriptChunk>;
  let handler: Handler | null = null;
  let captured = '';
  let ended = false;
  let replay: TranscriptChunk[] = [];

  const drain = (h: Handler): void => {
    for (const c of replay) h.single(c);
    replay = [];
    if (ended) h.end();
  };

  return {
    svc: {
      isSupported: () => Effect.succeed(true),
      start: (_opts: SttStartOptions) =>
        Effect.sync(() => {
          // A new utterance: nothing captured, nothing replayed, not
          // ended. Reset here rather than in the register Effect so
          // a `stop()` that beat the attach is preserved.
          captured = '';
          ended = false;
          replay = [];
          handler = null;
          // `asyncPush` runs `register` through `Effect.tap`, so its
          // return value is discarded — returning a "cleanup" here
          // would just execute it inline and tear `handler` down
          // before a single chunk arrived. The stream's real lifetime
          // is the `acquireRelease` scope that `runForEach` holds open.
          return Stream.asyncPush<TranscriptChunk, SttUnsupportedError>((emit) => {
            handler = emit;
            drain(emit);
            return Effect.void;
          }, { bufferSize: 16 });
        }),
      stop: () =>
        Effect.sync(() => {
          if (ended) return;
          const text = captured;
          captured = '';
          if (text !== '') replay = [...replay, finalChunk(text)];
          ended = true;
          if (handler !== null) drain(handler);
        }),
    },
    capture: (text: string): void => { captured = text; },
  };
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
  // The auto-commit path is gone (`decisions/
  // wavecode-voice-confirm-before-send`): a final chunk alone
  // never reaches `requesting`/`applying`. The tests below pin
  // that contract — if a future change re-introduces the silent
  // route on final, these tests fail loudly.
  it('walks idle → arming → listening → transcribing → review (final chunk awaits confirmation, no LLM call)', async () => {
    const response = 'note("e4")';
    const { layer, rec } = buildServices(response);
    const stt = fakeStt([interim('сейчас', 10), finalChunk('сделай e4', 100)]);
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'oneshot', lang: 'ru-RU', bargeInMode: 'replace' }),
    );

    // Wait for the final chunk to land + auto-review to fire. The
    // FSM must NOT advance to requesting/applying/idle on its own.
    const landed = await waitForState(handle, (s) => s.tag === 'review');
    if (landed.tag !== 'review') throw new Error('unreachable');
    expect(landed.editedText).toBe('сделай e4');
    expect(landed.transcript.lang).toBe('ru-RU');
    // The LLM must not have been called yet — that's the entire
    // reason for the review step.
    expect(rec.llmCalls).toBe(0);
    expect(rec.evalCalls).toBe(0);
  });

  it('sendReview after auto-review routes the edited text and FSM reaches idle', async () => {
    const response = 'note("e4")';
    const { layer, rec } = buildServices(response);
    const stt = fakeStt([interim('сейчас', 10), finalChunk('сделай e4', 100)]);
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'oneshot', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    const landed = await waitForState(handle, (s) => s.tag === 'review');
    if (landed.tag !== 'review') throw new Error('unreachable');

    // User presses «→ В ИИ» with the (un-edited) transcript.
    await Effect.runPromise(handle.sendReview('сделай e4'));
    const final = await waitForState(handle, (s) => s.tag === 'idle');
    expect(final.tag).toBe('idle');
    expect(rec.llmCalls).toBe(1);
    expect(rec.evalCalls).toBe(1);
    expect(rec.evalInputs[0]).toBe(response);
  });

  it('persists state through the queue; auto-review is the terminal auto-path tag', async () => {
    // The stream API is what `RecordingPanel` binds to; this test
    // pins the public observable: the FSM tags transit through the
    // auto-review path, NOT through `requesting` / `applying`. If a
    // future refactor wires auto-commit back through the stream, the
    // expectation below fails.
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
    await waitForState(handle, (s) => s.tag === 'review');
    await Effect.runPromise(Fiber.interrupt(fiber));

    // The reducer steps recorded (allowing duplicates from multiple
    // chunks, transitive state visibility). The auto path lands in
    // `review` — NO requesting/applying/idle until the user presses
    // the send button.
    expect(transitions).toContain('arming');
    expect(transitions).toContain('listening');
    expect(transitions).toContain('transcribing');
    expect(transitions).toContain('review');
    expect(transitions).not.toContain('requesting');
    expect(transitions).not.toContain('applying');
    // Final state in the auto path is `review`, never `idle`.
    expect(transitions[transitions.length - 1]).toBe('review');
    expect(rec.llmCalls).toBe(0);
  });
});

describe('createVoiceAISession — barge-in', () => {
  it('cancelInFlight resets the FSM to idle mid-route', async () => {
    // The auto-commit path is gone: the final chunk alone drops
    // the FSM into `review`. To exercise barge-in mid-route we
    // explicitly trigger a route via `sendReview`, which forks the
    // route under `inFlightRef` (same shape as the old auto path).
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
    // Auto path: final chunk → review.
    await waitForState(handle, (s) => s.tag === 'review');
    // User presses «→ В ИИ». The dispatch is sync; the route is
    // forked, so `Effect.runPromise` returns immediately and the
    // FSM advances through requesting/applying while we poll.
    await Effect.runPromise(handle.sendReview('note g4'));
    // Wait until the route is actually running (`inFlightRef` has
    // a fiber). The `routeStarted` gate fires inside `streamCompletion`
    // — only after the FSM has hit `requesting` and `runRoute` has
    // called LLM. Gives us a window to barge-in before `applied`.
    await routeStarted;
    // Wait until the FSM is in `requesting` or `applying` to confirm
    // we're mid-route, not pre-route.
    await waitForState(handle, (s) => s.tag === 'requesting' || s.tag === 'applying');
    // Now barge in. `cancelInFlight` interrupts the in-flight
    // fiber and dispatches `barge-in`.
    await Effect.runPromise(handle.cancelInFlight());
    // Allow the interrupt to propagate.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const final = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(final.tag).toBe('idle');
  });
});

describe('createVoiceAISession — review-and-edit', () => {
  /**
   * `enterReview` (the manual path) is reachable from listening /
   * transcribing / paused. The auto path now lands in `review`
   * directly on a final chunk, but `enterReview` is still useful
   * for the user-driven case ("I'm still mid-utterance, pause and
   * send what I have"). For these tests we pass a stream that
   * holds open indefinitely so we can prove the reviewer owns the
   * FSM without triggering the auto path.
   */
  const holdingStt = (): ContextNs.Tag.Service<typeof STTEngine> => ({
    isSupported: () => Effect.succeed(true),
    start: (_opts: SttStartOptions) =>
      Effect.succeed(
        Stream.fromEffect(Effect.never) as unknown as Stream.Stream<TranscriptChunk, SttUnsupportedError>,
      ),
    stop: () => Effect.void,
  });

  it('enterReview from listening transitions to review (and stops STT)', async () => {
    const { layer } = buildServices('unused');
    const stt = holdingStt();
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    await Effect.runPromise(handle.enterReview());
    const after = await waitForState(handle, (s) => s.tag === 'review');
    if (after.tag !== 'review') throw new Error('unreachable');
    expect(after.transcript.lang).toBe('ru-RU');
    expect(after.editedText).toBe('');
  });

  it('sendReview routes the edited text through the LLM+audio path', async () => {
    const response = 's("hh*4")';
    const { layer, rec } = buildServices(response);
    const stt = holdingStt();
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    await Effect.runPromise(handle.enterReview());
    await waitForState(handle, (s) => s.tag === 'review');

    await Effect.runPromise(handle.sendReview('сделай хай-хэт побыстрее'));
    const final = await waitForState(handle, (s) => s.tag === 'idle');
    expect(final.tag).toBe('idle');
    expect(rec.llmCalls).toBe(1);
    expect(rec.evalInputs[0]).toBe(response);
  });

  it('cancelReview returns to idle without invoking the LLM', async () => {
    const { layer, rec } = buildServices('s("bd")');
    const stt = holdingStt();
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    await Effect.runPromise(handle.enterReview());
    await waitForState(handle, (s) => s.tag === 'review');

    await Effect.runPromise(handle.cancelReview());
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const after = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(after.tag).toBe('idle');
    expect(rec.llmCalls).toBe(0);
  });

  it('sendReview from non-review state is a no-op (no LLM call)', async () => {
    const { layer, rec } = buildServices('s("bd")');
    const stt = holdingStt();
    const { deps } = await buildDeps(stt, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));
    // Never started: still idle.
    await Effect.runPromise(handle.sendReview('whatever'));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const after = await Effect.runPromise(Ref.get(handle.stateRef));
    expect(after.tag).toBe('idle');
    expect(rec.llmCalls).toBe(0);
  });
});

/**
 * The gesture that was broken: hold the FAB, say a phrase, let go —
 * then hold it again to continue the same take, and send once at
 * the end. Every step here corresponds to something the user could
 * not do before.
 */
describe('createVoiceAISession — take continuation', () => {
  it('a released take lands in review instead of being discarded', async () => {
    const { layer } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    stt.capture('сделай тише');
    // Release. The engine flushes, so the words must survive.
    await Effect.runPromise(handle.stop());

    const s = await waitForState(handle, (x) => x.tag === 'review');
    expect(s.tag).toBe('review');
    if (s.tag !== 'review') throw new Error('unreachable');
    expect(s.editedText).toBe('сделай тише');
  });

  it('re-pressing appends to the same take and one send ships both phrases', async () => {
    const { layer, rec } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    stt.capture('сделай тише');
    await Effect.runPromise(handle.stop());
    await waitForState(handle, (x) => x.tag === 'review');

    // Second press. `arm` used to be a no-op from `paused`/`review`
    // teardown, so nothing after this point was ever captured.
    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    const listening = await waitForState(handle, (x) => x.tag === 'listening');
    expect(listening.tag).toBe('listening');
    if (listening.tag !== 'listening') throw new Error('unreachable');
    // The first phrase survived the re-arm.
    expect(listening.transcript.final).toBe('сделай тише');

    stt.capture('и добавь немного ритма');
    await Effect.runPromise(handle.stop());
    const review = await waitForState(handle, (x) => x.tag === 'review');
    expect(review.tag).toBe('review');
    if (review.tag !== 'review') throw new Error('unreachable');
    expect(review.editedText).toBe('сделай тише и добавь немного ритма');

    // One send. One LLM call. Both phrases in the instruction.
    await Effect.runPromise(handle.sendReview(review.editedText));
    await waitForState(handle, (s) => s.tag === 'idle');
    expect(rec.llmCalls).toBe(1);
  });

  it('a silent release parks in paused and the next press still works', async () => {
    const { layer } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    // Held the button, said nothing, let go.
    await Effect.runPromise(handle.stop());
    const parked = await waitForState(handle, (s) => s.tag === 'paused');
    expect(parked.tag).toBe('paused');

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    const back = await waitForState(handle, (s) => s.tag === 'listening');
    expect(back.tag).toBe('listening');
  });

  it('hands the routed score back for the editor write-back', async () => {
    const { layer } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const applied: string[] = [];
    const handle = await Effect.runPromise(
      createVoiceAISession({ ...deps, onApplied: (s) => { applied.push(s); } }),
    );

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    stt.capture('сделай тише');
    await Effect.runPromise(handle.stop());
    const review = await waitForState(handle, (s) => s.tag === 'review');
    if (review.tag !== 'review') throw new Error('unreachable');

    await Effect.runPromise(handle.sendReview(review.editedText));
    await waitForState(handle, (s) => s.tag === 'idle');

    // Without this the score was evaluated but never written into the
    // editor buffer — the user heard the edit and saw no change.
    expect(applied).toEqual(['note("e4")']);
  });
});

describe('createVoiceAISession — re-press during the release flush', () => {
  it('waits out the in-flight drain instead of colliding with it', async () => {
    // The FAB fires `stop` from a pointerup handler and never awaits
    // it, so a second press can land while the take is still being
    // uploaded. Without the drain barrier in `start` that produced a
    // hard `aborted` from the engine's one-recording-at-a-time guard.
    const { layer } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    stt.capture('первая фраза');

    // Do NOT await: this is the fire-and-forget pointerup path.
    const stopping = Effect.runPromise(handle.stop());
    // Second press, mid-flush.
    const starting = Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await stopping;
    await starting;

    // `review` is transitory here: the re-arm fires the moment the
    // drain releases it, so the settled state is `listening`. The
    // transcript is the sharp observable — if the drain had NOT
    // completed first, `arm` would have been dispatched from
    // `listening`, and `fromListening + arm` deliberately resets the
    // buffer. A preserved transcript therefore proves the ordering.
    const listening = await waitForState(handle, (s) => s.tag === 'listening');
    expect(listening.tag).toBe('listening');
    if (listening.tag !== 'listening') throw new Error('unreachable');
    expect(listening.transcript.final).toBe('первая фраза');
  });
});

describe('createVoiceAISession — engine ends the stream by itself', () => {
  it('parks on the silence flush instead of counting seconds forever', async () => {
    // The field failure: the engine flushes on its own after 1.3 s of
    // silence, so `handle.stop()` is never called — the finger is still
    // down. The stream completed with no final chunk and the FSM stayed
    // pinned on `listening`: the panel kept incrementing the counter
    // and no text ever appeared, until the user closed the panel by
    // hand. The sink has to live on the stream's exit, not on stop().
    const { layer } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');

    // Engine terminates on its own, having captured nothing (the take
    // was all silence, or the recorder produced no data at all).
    await Effect.runPromise(stt.svc.stop());
    await Effect.runPromise(Effect.sleep(20));

    const parked = await waitForState(handle, (s) => s.tag !== 'listening');
    expect(parked.tag).not.toBe('listening');
    expect(parked.tag).toBe('paused');
  });

  it('offers a take that DID produce text for review', async () => {
    const { layer } = buildServices('note("e4")');
    const stt = controllableStt();
    const { deps } = await buildDeps(stt.svc, layer);
    const handle = await Effect.runPromise(createVoiceAISession(deps));

    await Effect.runPromise(
      handle.start({ mode: 'continuous', lang: 'ru-RU', bargeInMode: 'replace' }),
    );
    await waitForState(handle, (s) => s.tag === 'listening');
    stt.capture('добавь немного ритма');
    // Silence flush: emits the final, then ends the stream.
    await Effect.runPromise(stt.svc.stop());
    await Effect.runPromise(Effect.sleep(20));

    const review = await waitForState(handle, (s) => s.tag === 'review');
    expect(review.tag).toBe('review');
    if (review.tag !== 'review') throw new Error('unreachable');
    expect(review.editedText).toBe('добавь немного ритма');
  });
});
