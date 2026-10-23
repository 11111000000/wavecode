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
 *   chunk    → reducer appendChunk → if final → enter-review →
 *              teardown STT + subscriber (FSM holds the buffer
 *              for the user to confirm)
 *   send     → send-review → requesting → route → applied → idle
 *   applied  → continuous? listening : idle
 *   stop     → ask the engine to FLUSH (it uploads the take), keep
 *              the FSM in `listening` until the final chunk lands,
 *              then land on `review`. This is the release-the-button
 *              gesture, not a discard; only `dismiss` discards. The
 *              mic mutex stays claimed (release is the presenter's
 *              job).
 *   cancelInFlight → interrupt the routed fiber → barge-in → idle.
 *
 * `stream` is a single-consumer Effect `Stream` that yields the
 * FSM state after every reducer step. UI binds to it once; the
 * orchestrator publishes via an internal `Queue` on every
 * transition (and once on subscription so a mount-time render sees
 * the current state immediately).
 *
 * MVP flow: press-and-hold (oneshot) and tap-continuous both use
 * the auto-review path — a final chunk lands the FSM in `review`
 * (STT is stopped); the user must press «→ В ИИ» to route the
 * buffer through the LLM. This is the only safe shape for voice →
 * editor commits: STT occasionally mistranscribes (noisy room,
 * homophones), and `routeIntent` rewrites the score. Without the
 * buffer step, one misheard word silently corrupts the composition
 * (`decisions/wavecode-voice-confirm-before-send`).
 *
 * The `onChunk` hook on the handle is the *explicit* chunk-feed
 * signal for non-STT pipelines (test streams, future wake-word
 * buffers). It still does NOT auto-commit — `enterReview` is the
 * only entry point into the confirmation sink.
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
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import { LLMClient, AudioEngine } from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';

/**
 * Ceiling on how long `handle.stop` waits for the STT stream to
 * drain after it asks the engine to flush. The happy path is one
 * server round trip — 2.6-5.2 s measured on angara-1 with
 * `ggml-base-q5_1` (`decisions/wavecode-server-stt`) — so this is
 * roughly 2× the observed worst case. It exists so a wedged engine
 * or a stalled network cannot pin the FAB in `holding` forever.
 */
const DRAIN_MAX_MS = 12_000;

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
  /**
   * Called with the LLM's cleaned score once a routed edit succeeds.
   *
   * The orchestrator cannot dispatch into the app store itself —
   * `application/` is not allowed to import `presentation/`. So the
   * write-back is injected: `voiceAIStore` passes
   * `dispatch({type:'replaceScore', text})`.
   *
   * This callback is the entire difference between "the voice-AI
   * feature works" and "it auditions your edit and throws it away".
   * `routeIntent` calls `audio.eval(cleanedScore)`, so the user
   * HEARS the new pattern — but before this hook the score was never
   * written to the editor buffer. Every sibling input path (mic,
   * whistle, piano recording, the AI edit panel) already did the
   * `replaceScore` dispatch; voice was the only one that didn't.
   */
  readonly onApplied?: (score: string) => void;
};

/** Handle returned by `createVoiceAISession`. All methods are pure
 *  Effect-programs the caller can `runPromise` / chain. */
export type VoiceSessionHandle = {
  readonly stateRef: Ref.Ref<VoiceSessionState>;
  readonly start: (
    input: VoiceSessionInput,
  ) => Effect.Effect<void, MicBusyError | SttUnsupportedError, never>;
  readonly stop: () => Effect.Effect<void, never, never>;
  /** Explicit chunk-feed for non-STT pipelines (test streams,
   *  future wake-word buffers). Unlike the STT subscriber, this
   *  does NOT auto-review — callers that want confirmation must
   *  explicitly dispatch `enter-review` themselves. */
  readonly onChunk: (chunk: TranscriptChunk) => Effect.Effect<void, never, never>;
  /** Live FSM stream — UI subscribes once. */
  readonly stream: Stream.Stream<VoiceSessionState, never, never>;
  /** Barge-in: cancel any in-flight route and reset the FSM to `idle`. */
  readonly cancelInFlight: () => Effect.Effect<void, never, never>;
  /** Drop the session entirely: stop the STT stream, release the
   * subscriber slot and force the FSM back to `idle`.
   *
   * `stop` alone leaves the FSM in `paused`, which the recording
   * panel renders as an on-screen state — the user who pressed ✕ to
   * dismiss the panel would instead get a panel stuck at «на паузе».
   * `dismiss` is the FSM event that exists for that case, but it
   * needs the same teardown `stop` does, so the two are composed
   * here rather than left to the caller. Safe to call from any
   * state: on `idle` the reducer's `dismiss` branch returns it
   * unchanged and the teardown is idempotent. */
  readonly dismiss: () => Effect.Effect<void, never, never>;
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
    // The release-drain currently in flight, if any.
    //
    // `stop` waits out the whole flush (one server round trip) before
    // returning, but the FAB fires it and forgets — it is a pointerup
    // handler, nobody blocks a touch event on the network. So a user
    // who presses the button again inside that window would reach
    // `start` while the engine is still mid-flush, get `arm` from
    // `listening` (which resets the transcript by design) and then a
    // hard `aborted` from the engine's single-recording guard.
    // Tracking the drain lets `start` simply wait it out, which is
    // both correct and what the user meant by pressing again.
    const drainRef: Ref.Ref<Fiber.RuntimeFiber<void, never> | null> = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);
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
        // Capture the cleaned score through `onComplete` so it can be
        // handed to `deps.onApplied` (the editor write-back) after the
        // route resolves. The callback is invoked synchronously on
        // this fiber before `applyEditStream` returns, so the value is
        // already in place by the time we read it below.
        //
        // Held in an object rather than a plain `let`: the assignment
        // happens inside a callback, which TypeScript's control-flow
        // analysis does not follow, so `let x: string | null = null`
        // is narrowed to `null` at every read and the post-check
        // collapses to `never`. A property access is re-widened
        // after each call, so the object form types correctly.
        const applied: { score: string | null } = { score: null };
        const routeEff = routeIntent(
          { kind: 'edit-score', instruction, confidence: 1, timestampMs },
          { currentScore: score, nowMs: timestampMs },
          {
            onComplete: (cleaned: string): void => {
              applied.score = cleaned;
            },
          },
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
        // Write the result into the editor. Without this the voice
        // path evaluated the new score (`audio.eval`) and stopped —
        // the user heard the edit land but the score buffer never
        // changed, which reads as "the LLM failed to parse it".
        const cleaned = applied.score;
        if (cleaned !== null && cleaned.trim().length > 0) {
          yield* Effect.sync(() => {
            deps.onApplied?.(cleaned);
          });
        }
        yield* dispatch({ type: 'applied' });
        // After `applied`, the reducer flips back to listening (when
        // continuous=true) or idle (oneshot). Mode is currently carried
        // through `transcribing → commit` as `continuous: false` per
        // the reducer design — the orchestrator does not re-arm here.
      });

    /**
     * Run the route from the `review` sink with a user-edited text.
     * Branched off `runRoute` so the auto path stays free of
     * review-specific bookkeeping — the FSM does the bookkeeping
     * (review → requesting via `send-review`), and this just makes
     * sure the audio eval / LLM call is identical to the auto path.
     *
     * Why `Effect.forkDaemon` here, when the orchestrator's
     * `runRouteFromReview` previously ran the route inline
     * --------------------------------------------------
     * The auto-commit branch (now retired) forked its route via
     * `forkDaemon` + `Ref.set(inFlightRef, fiber)` so that
     * `cancelInFlight` could interrupt a long-running LLM
     * request mid-route. Without the fork, the Effect blocks its
     * caller until the LLM responds — fine on the auto path (the
     * subscriber fiber was already async), but bad here: the
     * store's `sendVoiceAIReview` would hang the UI button click
     * through the entire round-trip and `cancelInFlight` would
     * have no fiber to interrupt.
     *
     * The shape is "dispatch `send-review` synchronously to flip
     * the FSM tag, then fork the route so the caller returns
     * immediately". The reducer guarantees the FSM hits
     * `requesting` before the route body runs: `send-review`
     * transitions review → requesting, and `runRoute`'s first
     * step dispatches `request-sent` (requesting → applying). No
     * `commit` event is fired — there's nothing to double-commit.
     *
     * The `stateRef.get` check at the head is what stops the
     * entire branch when the caller is stale (e.g. the user
     * already cancelled). The reducer's `fromReview + send-review`
     * is also a no-op for non-`review` states, but we still
     * need to short-circuit before `Ref.set(inFlightRef, ...)`
     * would otherwise stash a fiber against the wrong FSM tag.
     */
    const runRouteFromReview = (
      text: string,
    ): Effect.Effect<void, never, never> => {
      const t = Date.now();
      return Effect.gen(function* () {
        const prev = yield* Ref.get(stateRef);
        if (prev.tag !== 'review') return;
        yield* dispatch({ type: 'send-review', text });
        const fiber = yield* Effect.forkDaemon(runRoute(text, t));
        yield* Ref.set(inFlightRef, fiber);
      });
    };

    /**
     * Teardown the STT engine + the subscriber fiber slot
     * atomically. Shared by `handle.dismiss` and `handle.enterReview`
     * — both mean "this take is over, throw the rest away".
     *
     * Deliberately NOT used by `handle.stop`: interrupting the
     * subscriber first would discard whatever the engine was in the
     * middle of delivering. See the comment there.
     *
     * The atomic modify+interrupt keeps `subscriberRef` correct even
     * if the interrupting fiber is itself interrupted (a known
     * surprising interaction in Effect): the slot is nulled before
     * the old fiber's interrupt propagates, so a second caller can
     * never observe the dead reference.
     */
    const teardownSubscriber = Effect.gen(function* () {
      const cleared = yield* Ref.modify(
        subscriberRef,
        (curr) => [curr, null] as const,
      );
      if (cleared !== null) {
        yield* Fiber.interrupt(cleared);
      }
      yield* deps.stt.stop();
    });

    // Subscribe to the STT chunk stream. For each chunk: dispatch a
    // `chunk` event; if the chunk is final and the FSM is in
    // `transcribing`, drop into `review` so the user can confirm /
    // edit the buffer before any LLM call fires (the previous
    // auto-commit path is gone — see the file header for why).
    //
    // Why this is the only path that triggers `enter-review` from
    // a reducer event
    // --------------------------------------------------
    // The reducer's `enter-review` event is reachable from any
    // active state (listening / transcribing / paused). This
    // subscriber is the only caller that fires it without an
    // explicit user action — the others are `handle.enterReview`,
    // which a UI button would call manually. Keeping the auto
    // transition here means the rule-based classifier (`voiceIntent
    // Classifier.run`) is dead code in the MVP path; classification
    // only runs if/when a future "send verbatim" affordance
    // bypasses review. Until then, the user is the only agent that
    // promotes `review → requesting`.
    const subscribeLoop = (
      chunks: Stream.Stream<TranscriptChunk, SttUnsupportedError>,
    ): Effect.Effect<void, SttUnsupportedError, never> =>
      Stream.runForEach(chunks, (chunk: TranscriptChunk) =>
        Effect.gen(function* () {
          yield* dispatch({ type: 'chunk', chunk });
          if (chunk.kind !== 'final') return;
          // Read FSM AFTER the chunk event so we see the post-
          // transition state — auto-review fires only when the
          // reducer put us in `transcribing` (i.e., this final chunk
          // landed). Buffered finals that arrive after the FSM is
          // already in `review` drop through silently: the reducer
          // ignores chunks in `review`, so the transcript buffer is
          // not mutated retroactively. STT engines that emit one
          // final per utterance (Web Speech, server Whisper) match
          // this single-transition expectation.
          const s = yield* Ref.get(stateRef);
          if (s.tag !== 'transcribing') return;
          yield* dispatch({ type: 'enter-review' });
          // Stop STT so the subscriber drains its remaining
          // buffered chunks (which become no-ops once we're in
          // `review`) and the stream completes on its own. We
          // do NOT interrupt the subscriber here: any in-flight
          // chunks still finish their dispatch, and the subscriber
          // slot ends naturally. Cancellation on user demand goes
          // through `cancelVoiceAIReview` / `cancelVoiceAIInFlight`.
          yield* deps.stt.stop();
        }),
      );

    // Publish the current state once so a mount-time subscriber sees
    // the initial `idle` immediately.
    yield* Queue.offer(stateQueue, initialVoiceSession());

    const handle: VoiceSessionHandle = {
      stateRef,
      start: (input) =>
        Effect.gen(function* () {
          // A release-drain may still be running (see `drainRef`).
          // Let it finish: the take it is uploading belongs to the
          // same press-and-hold the user is continuing, and the engine
          // accepts exactly one recording at a time.
          const draining = yield* Ref.get(drainRef);
          if (draining !== null) {
            yield* Fiber.await(draining);
            yield* Ref.set(drainRef, null);
          }
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
          // The drain runs on its own fiber so `start` can join it
          // instead of colliding with it (see `drainRef`). `stop`
          // itself still waits for the outcome — callers rely on the
          // FSM being settled when it resolves.
          const drain = Effect.gen(function* () {
          // `stop` means "the finger came off the button", NOT "throw
          // the take away" — the server engine now flushes and uploads
          // on stop, so the final chunk is still coming.
          //
          // That makes ordering load-bearing. Pausing FIRST (the
          // previous behaviour) left the FSM in `paused` by the time
          // the transcript arrived, and `fromPaused` had no `chunk`
          // branch: the words were recognised, billed for a full
          // server round trip, and then dropped on the floor. So we
          // hold the FSM in `listening` and wait for the stream to
          // end — the reducer then walks listening → transcribing →
          // review on its own, which is the state the user wants:
          // the text is in front of them, «→ В ИИ» is live, and the
          // next press-and-hold appends to the same take.
          yield* deps.stt.stop();
          const fiber = yield* Ref.get(subscriberRef);
          if (fiber !== null) {
            // The drain is one server round trip (2.6-5.2 s measured).
            // `DRAIN_MAX_MS` is a ceiling for the pathological case
            // (engine wedged, network stalled) — past it we fall
            // through to the sink below rather than pinning the FAB.
            yield* Fiber.await(fiber).pipe(
              Effect.timeout(DRAIN_MAX_MS),
              Effect.catchAll(() => Effect.void),
            );
            yield* Ref.set(subscriberRef, null);
          }
          // Nothing was recognised — a silent take, or an engine that
          // ended without emitting a final chunk. The subscriber's own
          // normal exit already handles this, but `stop()` can also be
          // reached without a stream ever having produced anything, so
          // pin the FSM to `paused` (which re-arms on the next press)
          // rather than leaving it stuck on «записываю…».
          const s = yield* Ref.get(stateRef);
          if (s.tag === 'listening' || s.tag === 'arming') {
            const hasText =
              s.tag === 'listening' && s.transcript.final.trim().length > 0;
            yield* dispatch({ type: hasText ? 'enter-review' : 'pause' });
          } else if (s.tag === 'transcribing') {
            yield* dispatch({ type: 'enter-review' });
          }
          });
          const drainFiber = yield* Effect.forkDaemon(drain);
          yield* Ref.set(drainRef, drainFiber);
          yield* Fiber.await(drainFiber);
          yield* Ref.set(drainRef, null);
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
      dismiss: () =>
        Effect.gen(function* () {
          // Kill any in-flight route FIRST: dismissing the panel while
          // the LLM is mid-edit would otherwise let the route finish
          // and apply an edit the user just abandoned.
          const inFlight = yield* Ref.modify(inFlightRef, (curr) => [curr, null] as const);
          if (inFlight !== null) yield* Fiber.interrupt(inFlight);
          // Then tear down the capture side so the STT stream ends and
          // the mic is released.
          yield* teardownSubscriber;
          // `dismiss` is a wildcard transition in the reducer: it maps
          // paused / errored → idle and leaves a bare `idle` untouched.
          yield* dispatch({ type: 'dismiss' });
        }),
      enterReview: () =>
        Effect.gen(function* () {
          // Stop the STT stream + subscriber so the FSM doesn't
          // accumulate more chunks during review. The reducer
          // decides which states can enter review (any except
          // armed-flow + errored); for the rest it's a no-op.
          yield* teardownSubscriber;
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
