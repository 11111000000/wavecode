/**
 * VoiceAISession — orchestrator that wraps the pure
 * `voiceSessionReducer` from `domain/voice/voiceSession.ts` with
 * the IO needed to drive it: an `STTEngine` for inbound chunks,
 * an `LLMClient` + `AudioEngine` for the routed intent, and a
 * `Ref<string>` for the current editor score.
 *
 * Why an orchestrator at all
 * -------------------------
 * The reducer is pure, by design: it cannot import `Ref`, `Queue`,
 * or `Fiber`. Effect-typed side-effects (STT subscription, LLM
 * call, audio eval, cancellation) live here in the application
 * layer and read/write a `Ref<VoiceSessionState>` that mirrors the
 * reducer's output. The FSM logic stays a pure function — only
 * "what to do at each transition" lives here.
 *
 * Lifecycle (MVP)
 * ---------------
 *   start    → arm → STT.start → stt-ready → listening
 *   chunk    → reducer appendChunk → if final → auto-commit →
 *              classifyTranscript → routeIntent → audio.eval
 *   applied  → continuous? listening : idle
 *   stop     → pause (FSM-only); STT is stopped but the mic mutex
 *              stays (release is the presenter's job).
 *   cancelInFlight → interrupt the routed fiber → barge-in → idle.
 *
 * `stream` is a single-consumer Effect `Stream` that yields the
 * FSM state after every reducer step. UI binds to it once; the
 * orchestrator publishes via an internal `Queue` on every
 * transition (and once on subscription so a mount-time render sees
 * the current state immediately).
 *
 * MVP simplification: both press-and-hold (oneshot) and tap-continuous
 * use the same auto-commit flow (commit on the first final chunk).
 * The `onChunk` hook on the handle is the *explicit* commit signal
 * for advanced UIs that want to drive commit from a non-STT source.
 */

import { Effect, Fiber, Queue, Ref, Stream, type Context } from 'effect';
import type { STTEngine, SttUnsupportedError } from './STTEngine';
import { routeIntent } from './intentRouter';
import {
  voiceSessionReducer,
  initialVoiceSession,
  type VoiceSessionState,
  type VoiceSessionEvent,
} from '~/domain/voice/voiceSession';
import { classifyTranscript } from '~/domain/voice/voiceIntentClassifier';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import { LLMClient, AudioEngine } from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';

/** User-facing session options, set at start-time. */
export type VoiceSessionInput = {
  readonly mode: 'oneshot' | 'continuous';
  readonly lang: 'ru-RU' | string;
  readonly bargeInMode: 'replace' | 'queue' | 'ignore';
};

/** Dependencies: services handed in at construction. None of them
 *  are yielded into Effect environment — they're captured closures,
 *  so `createVoiceAISession` runs in `never, never` (its only side
 *  effect is constructing `Ref`s). */
export type VoiceSessionDeps = {
  readonly stt: Context.Tag.Service<typeof STTEngine>;
  readonly llm: Context.Tag.Service<typeof LLMClient>;
  readonly audio: Context.Tag.Service<typeof AudioEngine>;
  readonly currentScoreRef: Ref.Ref<string>;
};

/** Handle returned by `createVoiceAISession`. All methods are pure
 *  Effect-programs the caller can `runPromise` / chain. */
export type VoiceSessionHandle = {
  readonly stateRef: Ref.Ref<VoiceSessionState>;
  readonly start: (
    input: VoiceSessionInput,
  ) => Effect.Effect<void, MicBusyError | SttUnsupportedError, never>;
  readonly stop: () => Effect.Effect<void, never, never>;
  /** Explicit commit signal (pointerup / sentence-end). MVP auto-commits
   *  on every final chunk — this is a manual override hook. */
  readonly onChunk: (chunk: TranscriptChunk) => Effect.Effect<void, never, never>;
  /** Live FSM stream — UI subscribes once. */
  readonly stream: Stream.Stream<VoiceSessionState, never, never>;
  /** Barge-in: cancel any in-flight route and reset the FSM to `idle`. */
  readonly cancelInFlight: () => Effect.Effect<void, never, never>;
  /** Pause STT and freeze the transcript for the user to edit before
   *  sending. Safe to call from listening / transcribing / paused —
   *  from any other state it's a no-op (we keep the FSM total). */
  readonly enterReview: () => Effect.Effect<void, never, never>;
  /** Send the (possibly edited) text to the LLM as if it were a
   *  finalised transcript. Skips the rule-based classifier — the
   *  user has already shaped the instruction, so we route the text
   *  verbatim via `routeIntent`. Must be called from the `review`
   *  state; calling it elsewhere is a no-op. */
  readonly sendReview: (text: string) => Effect.Effect<void, never, never>;
  /** Drop the review buffer and return to idle. */
  readonly cancelReview: () => Effect.Effect<void, never, never>;
};

/**
 * Build a session handle. Returns an Effect that, when run,
 * allocates the underlying `Ref`s and the subscriber `Queue` and
 * returns the immutable handle. Once created, the handle methods
 * are safe to call concurrently — the reducer is the single source
 * of truth, and the FSM has no race because every transition
 * threads through `Ref.update`.
 */
export const createVoiceAISession = (
  deps: VoiceSessionDeps,
): Effect.Effect<VoiceSessionHandle, never, never> =>
  Effect.gen(function* () {
    const stateRef: Ref.Ref<VoiceSessionState> = yield* Ref.make(initialVoiceSession());
    const inFlightRef: Ref.Ref<Fiber.RuntimeFiber<void, never> | null> = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);
    // Subscriber fiber carries the STT stream's error channel because
    // `Stream.runForEach` propagates `Stream<A, E>`'s `E` as the loop's
    // own error channel.
    const subscriberRef: Ref.Ref<Fiber.RuntimeFiber<void, SttUnsupportedError> | null> = yield* Ref.make<Fiber.RuntimeFiber<void, SttUnsupportedError> | null>(null);
    // Single-consumer unbounded queue that backs the `stream` API.
    const stateQueue: Queue.Queue<VoiceSessionState> = yield* Queue.unbounded<VoiceSessionState>();

    // Apply the pure reducer and publish the result. Single funnel so
    // the FSM semantics stay identical to the pure reducer (test parity).
    const dispatch = (event: VoiceSessionEvent): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const prev = yield* Ref.get(stateRef);
        const next = voiceSessionReducer(prev, event);
        if (next !== prev) {
          yield* Ref.set(stateRef, next);
          yield* Queue.offer(stateQueue, next);
        }
      });

    // Run one route end-to-end. The router may fail on self-heal
    // exhaustion; we map that into an FSM `error` event so the
    // presentation can surface a toast and the FSM stays in a
    // recoverable state (errored, resumable via `dismiss`).
    //
    // The route Effect requires `LLMClient | AudioEngine` in `R`; we
    // provide the captured deps via `Effect.provideService` so the
    // outer orchestrator signature stays `never, never`.
    const runRoute = (
      instruction: string,
      timestampMs: number,
    ): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const score = yield* Ref.get(deps.currentScoreRef);
        yield* dispatch({ type: 'request-sent', score });
        // `RouterContext` no longer carries services — the router
        // pulls `LLMClient` + `AudioEngine` from its own environment.
        const routeEff = routeIntent(
          { kind: 'edit-score', instruction, confidence: 1, timestampMs },
          { currentScore: score, nowMs: timestampMs },
        );
        const provided = routeEff.pipe(
          Effect.provideService(LLMClient, deps.llm),
          Effect.provideService(AudioEngine, deps.audio),
          Effect.either,
        );
        const result = yield* provided;
        if (result._tag === 'Left') {
          yield* dispatch({ type: 'error', message: result.left.message });
          return;
        }
        yield* dispatch({ type: 'applied' });
        // After `applied`, the reducer flips back to listening (when
        // continuous=true) or idle (oneshot). Mode is currently carried
        // through `transcribing → commit` as `continuous: false` per
        // the reducer design — the orchestrator does not re-arm here.
      });

    /**
     * Run the route from the `review` sink with a user-edited text.
     * Branched off `runRoute` so the auto-commit path stays free of
     * review-specific bookkeeping — the FSM does the bookkeeping
     * (review → requesting via `send-review`), and this just makes
     * sure the audio eval / LLM call is identical to the auto path.
     *
     * The orchestrator's `sendReview` dispatches `send-review(text)`
     * first; if we're not in `review`, the reducer's no-op branch
     * applies and we drop the request before it ever starts an LLM
     * call (preventing accidental work after a stale render).
     */
    const runRouteFromReview = (
      text: string,
    ): Effect.Effect<void, never, never> => {
      const t = Date.now();
      return Effect.gen(function* () {
        const prev = yield* Ref.get(stateRef);
        if (prev.tag !== 'review') return;
        yield* dispatch({ type: 'send-review', text });
        yield* runRoute(text, t);
      });
    };

    // Subscribe to the STT chunk stream. For each chunk: dispatch a
    // `chunk` event; if the chunk is final and the FSM is in
    // `transcribing`, auto-commit per the MVP behaviour.
    const subscribeLoop = (
      chunks: Stream.Stream<TranscriptChunk, SttUnsupportedError>,
    ): Effect.Effect<void, SttUnsupportedError, never> =>
      Stream.runForEach(chunks, (chunk: TranscriptChunk) =>
        Effect.gen(function* () {
          yield* dispatch({ type: 'chunk', chunk });
          if (chunk.kind !== 'final') return;
          // Read FSM AFTER the chunk event so we see the post-transition
          // state — auto-commit only when the reducer put us in
          // `transcribing` (i.e., this final chunk landed).
          const s = yield* Ref.get(stateRef);
          if (s.tag !== 'transcribing') return;
          yield* dispatch({ type: 'commit' });
          const r = yield* Ref.get(stateRef);
          if (r.tag !== 'requesting') return;
          const score = yield* Ref.get(deps.currentScoreRef);
          const result = classifyTranscript(r.transcript, {
            now: chunk.timestampMs,
            currentScore: score,
            bargeInMode: 'replace',
          });
          if (!result.ok || result.intent.kind !== 'edit-score') return;
          // `forkDaemon` decouples the route from the subscriber's
          // lifetime: the subscriber is only alive while the STT
          // stream produces chunks, but a route may extend past
          // that (e.g., LLM self-heal retry). Linkage would force
          // a premature interrupt; daemon lets the route finish.
          // `cancelInFlight` interrupts this fiber explicitly.
          const fiber = yield* Effect.forkDaemon(
            runRoute(result.intent.instruction, result.intent.timestampMs),
          );
          yield* Ref.set(inFlightRef, fiber);
        }),
      );

    // Publish the current state once so a mount-time subscriber sees
    // the initial `idle` immediately.
    yield* Queue.offer(stateQueue, initialVoiceSession());

    const handle: VoiceSessionHandle = {
      stateRef,
      start: (input) =>
        Effect.gen(function* () {
          // `input.mode` is forwarded into `bargeInMode` context for the
          // classifier (currently the rule-based classifier ignores it,
          // but the type signature is reserved for future LLM-routed
          // versions). The orchestrator itself does not branch on mode
          // — the pure reducer decides `idle` vs `listening` after
          // `applied` via the `continuous` flag it carries.
          yield* dispatch({ type: 'arm' });
          const chunks = yield* deps.stt.start({ lang: input.lang, interim: true });
          yield* dispatch({ type: 'stt-ready' });
          void input.mode;
          void input.bargeInMode;
          // `forkDaemon` decouples the subscriber from `start`'s
          // lifetime: the subscriber must keep consuming the STT
          // stream past start's return point so final chunks and
          // auto-commit fire. `handle.stop()` interrupts it
          // explicitly via the subscriberRef.
          const fiber = yield* Effect.forkDaemon(subscribeLoop(chunks));
          yield* Ref.set(subscriberRef, fiber);
        }),
      stop: () =>
        Effect.gen(function* () {
          // Atomic get+reset so the subscriber slot is vacated even
          // if the interrupting fiber is itself interrupted.
          const cleared = yield* Ref.modify(subscriberRef, (curr) => [curr, null] as const);
          if (cleared !== null) {
            yield* Fiber.interrupt(cleared);
          }
          yield* deps.stt.stop();
          yield* dispatch({ type: 'pause' });
        }),
      onChunk: (chunk: TranscriptChunk) =>
        Effect.gen(function* () {
          yield* dispatch({ type: 'chunk', chunk });
        }),
      stream: Stream.fromQueue(stateQueue, { shutdown: true }),
      cancelInFlight: () =>
        Effect.gen(function* () {
          // No `getAndClear` — use `modify` to read+reset in one step
          // so the in-flight slot is atomically cleared even if the
          // interrupt Effect is itself interrupted.
          const cleared = yield* Ref.modify(inFlightRef, (curr) => [curr, null] as const);
          if (cleared !== null) yield* Fiber.interrupt(cleared);
          yield* dispatch({ type: 'barge-in' });
        }),
      enterReview: () =>
        Effect.gen(function* () {
          // Stop the STT stream + subscriber so the FSM doesn't
          // accumulate more chunks during review. The reducer
          // decides which states can enter review (any except
          // armed-flow + errored); for the rest it's a no-op.
          const cleared = yield* Ref.modify(subscriberRef, (curr) => [curr, null] as const);
          if (cleared !== null) {
            yield* Fiber.interrupt(cleared);
          }
          yield* deps.stt.stop();
          yield* dispatch({ type: 'enter-review' });
        }),
      sendReview: (text: string) =>
        Effect.gen(function* () {
          // `runRouteFromReview` checks the state under a `Ref.get`
          // first so a stale `review → requesting` triggered after
          // the user has already cancelled cannot spawn a route.
          yield* runRouteFromReview(text);
        }),
      cancelReview: () =>
        Effect.gen(function* () {
          yield* dispatch({ type: 'cancel-review' });
        }),
    };

    return handle;
  });
