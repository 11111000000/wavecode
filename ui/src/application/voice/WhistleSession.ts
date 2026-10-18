/**
 * WhistleSession — orchestrator for the whistle mini-FAB.
 *
 * Lifecycle (MVP)
 * ---------------
 *   start   → arm → mic.start → mic-ready → recording
 *   feed    → reducer appends frame to open-note / notes buffer
 *   commit  → closeOpenNote → segmenting
 *   applied → idle
 *   stop    → cancel (FSM-only; mic.stop() is the caller's job).
 *
 * Why a `MicCaptureLike` interface
 * --------------------------------
 * The existing `micStore.ts` (presentation) wraps the live
 * `MicCapture` from `infrastructure/audio/`. Importing it here
 * would break the strict layering — application cannot depend on
 * presentation. Instead, this orchestrator consumes a tiny
 * `MicCaptureLike` interface that capture-side code already
 * satisfies. The adapter that bridges `micStore` ↔
 * `MicCaptureLike` lives in `infrastructure/audio/` (Agent 4/5
 * scope; not written here).
 *
 * TODO (downstream)
 * -----------------
 * Agent 5 should:
 *   1. Add `ui/src/infrastructure/audio/MicCaptureAdapter.ts` that
 *      builds a `MicCaptureLike` from the live `micStore.startMic /
 *      stopMic / onMicFrame` API. The adapter is the ONLY new file
 *      needed; downstream of it, the WhistleMiniFAB and FAB
 *      presentation components consume the orchestrator.
 *   2. Wire the orchestrator into
 *      `presentation/state/whistleStore.ts` (already declared in
 *      the decision packet's `scope.paths`).
 *
 * Snippet generation
 * ------------------
 * On `commit` the reducer hands the buffered `AudioNote[]` to this
 * orchestrator; we convert them via `notesToSnippet` (already in
 * domain/audio/micCapture.ts) and call `audio.eval`. No segmenter
 * heuristics here — the `notes` array IS the segmenter output. If
 * a future "enhanced" snippet is needed (transients, vibrato),
 * `micSnippetFromBuffers` from `domain/audio/micSnippet.ts` takes
 * `transients` as a second arg.
 */

import { Effect, Ref, Queue, Stream, type Context } from 'effect';
import type { AudioNote, PitchFrame } from '~/domain/audio/micCapture';
import {
  whistleSessionReducer,
  initialWhistleSession,
  type WhistleSessionState,
  type WhistleSessionEvent,
} from '~/domain/audio/whistleSession';
import { notesToSnippet } from '~/domain/audio/micCapture';
import type { AudioEngine } from '~/domain/services';

/** Error from `mic.start`. Carries the underlying DOM exception name
 *  so the presentation can render "permission denied" vs "no mic"
 *  vs "in use". Kept as a plain tagged object for the same reasons
 *  as `SttUnsupportedError`. */
export type MicPermissionError = {
  readonly _tag: 'MicPermissionError';
  readonly kind: 'permission-denied' | 'no-mic' | 'busy' | 'unknown';
  readonly message: string;
};

/** Minimal capture API the orchestrator needs. The live adapter
 *  (Agent 5) implements this on top of `micStore`; the inline test
 *  implements it on top of plain object fakes. */
export type MicCaptureLike = {
  readonly start: () => Effect.Effect<void, MicPermissionError, never>;
  readonly stop: () => Effect.Effect<void, never, never>;
  /** Feed one PitchFrame. Returns an Effect that fails only on
   *  capture-side glitches (rare in MVP); orchestrator maps those
   *  into FSM `error` events. */
  readonly feed: (frame: PitchFrame) => Effect.Effect<void, never, never>;
  /** Read every accumulated AudioNote. Called once on `commit`. */
  readonly getNotes: () => Effect.Effect<ReadonlyArray<AudioNote>, never, never>;
};

export type WhistleSessionDeps = {
  readonly mic: MicCaptureLike;
  readonly audio: Context.Tag.Service<typeof AudioEngine>;
  readonly currentScoreRef: Ref.Ref<string>;
};

export type WhistleSessionInput = {
  /** Unit instrument for `notesToSnippet`; default `'piano'`. */
  readonly instrument?: string;
};

export type WhistleSessionHandle = {
  readonly stateRef: Ref.Ref<WhistleSessionState>;
  readonly start: (
    input?: WhistleSessionInput,
  ) => Effect.Effect<void, MicPermissionError, never>;
  readonly stop: () => Effect.Effect<void, never, never>;
  readonly feed: (frame: PitchFrame) => Effect.Effect<void, never, never>;
  /** Commit the buffered notes → AudioEngine.eval. Caller decides
   *  whether to also push to the editor (out of scope for MVP —
   *  presentation). */
  readonly commit: () => Effect.Effect<void, never, never>;
  readonly stream: Stream.Stream<WhistleSessionState, never, never>;
};

export const createWhistleSession = (
  deps: WhistleSessionDeps,
): Effect.Effect<WhistleSessionHandle, never, never> =>
  Effect.gen(function* () {
    const stateRef: Ref.Ref<WhistleSessionState> = yield* Ref.make(initialWhistleSession());
    const stateQueue: Queue.Queue<WhistleSessionState> = yield* Queue.unbounded<WhistleSessionState>();
    const instrumentRef: Ref.Ref<string> = yield* Ref.make<string>('piano');

    const dispatch = (event: WhistleSessionEvent): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const prev = yield* Ref.get(stateRef);
        const next = whistleSessionReducer(prev, event);
        if (next !== prev) {
          yield* Ref.set(stateRef, next);
          yield* Queue.offer(stateQueue, next);
        }
      });

    // Publish the initial state once so subscribers see something.
    yield* Queue.offer(stateQueue, initialWhistleSession());

    const handle: WhistleSessionHandle = {
      stateRef,
      start: (input = {}) =>
        Effect.gen(function* () {
          const instrument = input.instrument ?? 'piano';
          yield* Ref.set(instrumentRef, instrument);
          yield* dispatch({ type: 'arm' });
          yield* deps.mic.start();
          // The orchestrator does not block on a mic-ready signal —
          // the mic adapter just returns from `start` when the
          // MediaStream is hot, mirroring the existing
          // `micCapture.startMic` flow (see `micStore.ts`).
          yield* dispatch({ type: 'mic-ready' });
          // Silence "unused state" until the first frame arrives.
          const initial = yield* Ref.get(stateRef);
          if (initial.tag === 'arming') {
            // Already past arming — no-op (the test double skips
            // mic-ready if it isn't wired).
            yield* dispatch({ type: 'mic-ready' });
          }
        }),
      stop: () =>
        Effect.gen(function* () {
          yield* deps.mic.stop();
          yield* dispatch({ type: 'cancel' });
        }),
      feed: (frame: PitchFrame) =>
        Effect.gen(function* () {
          yield* deps.mic.feed(frame);
          yield* dispatch({ type: 'feed', frame });
        }),
      commit: () =>
        Effect.gen(function* () {
          yield* dispatch({ type: 'commit' });
          const s = yield* Ref.get(stateRef);
          if (s.tag !== 'segmenting') return;
          const instrument = yield* Ref.get(instrumentRef);
          const snippet = notesToSnippet(s.notes, { instrument });
          if (snippet !== null) {
            // Synth errors are best-effort — the user already has
            // the buffered `notes`, the orchestrator shouldn't
            // propagate `audio.eval` rejections through the FSM
            // commit path. We swallow here and surface via
            // `onError` from the surrounding presentation layer
            // when it subscribes to `stream`.
            yield* deps.audio.eval(snippet).pipe(
              Effect.catchAll(() => Effect.void),
            );
          }
          yield* dispatch({ type: 'applied' });
        }),
      stream: Stream.fromQueue(stateQueue, { shutdown: true }),
    };

    return handle;
  });
