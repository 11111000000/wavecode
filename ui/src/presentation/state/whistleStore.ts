/**
 * whistleStore — presentation-layer signals + wrapper around the
 * `WhistleSession` orchestrator (`application/voice/WhistleSession.ts`)
 * for the whistle mini-FAB.
 *
 * Surface
 * -------
 *   - `whistleState`   = FSM state from the orchestrator's reducer
 *   - `whistleNotes`   = latest snapshot of `micPreviewNotes`
 *   - `whistleError`   = latest error message (string) or null
 *
 * Behaviour
 * ---------
 * `initWhistle` materialises the orchestrator handle once; the
 * orchestrator returns an `Effect` that allocates Refs and a Queue,
 * so we `runSync` it on init (Refs are `never` requirements).
 * `startWhistle` acquires `mic-direct` for the `whistle` owner,
 * starts the live `micStore` pipeline, and runs the orchestrator.
 * `commitWhistle` triggers `notesToSnippet` + `audio.eval` via the
 * orchestrator. `stopWhistle` releases the mic and stops the live
 * mic. Acquire failure (another mic-direct owner is active) surfaces
 * as a typed `MicBusyError` — the WhistleMiniFAB surfaces a toast.
 */

import { createSignal, onCleanup, untrack } from 'solid-js';
import * as Context from 'effect/Context';
import { Effect, Layer, Ref, Stream } from 'effect';
import type { WhistleSessionState } from '~/domain/audio/whistleSession';
import { initialWhistleSession } from '~/domain/audio/whistleSession';
import type { AudioNote } from '~/domain/audio/micCapture';
import { AudioEngine } from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import {
  createWhistleSession,
  type MicCaptureLike,
  type WhistleSessionHandle,
} from '~/application/voice/WhistleSession';
import { startMic, stopMic, micPreviewNotes } from './micStore';
import { acquireMic, releaseMic } from './micMutexStore';
import { logger } from '~/infrastructure/log';

export const [whistleState, setWhistleState] = createSignal<WhistleSessionState>(
  initialWhistleSession(),
);

export const [whistleNotes, setWhistleNotes] = createSignal<
  ReadonlyArray<AudioNote>
>([]);

export const [whistleError, setWhistleError] = createSignal<string | null>(null);

/** Options for `startWhistle`. */
export type WhistleStartOpts = {
  readonly sessionId: string;
  /** Defaults to `'piano'`. Forwarded into `notesToSnippet`. */
  readonly instrument?: string;
};

let handle: WhistleSessionHandle | null = null;
let activeSessionId: string | null = null;

/**
 * Pull a fresh `AudioNote[]` from `micPreviewNotes` into the
 * orchestrator's notes ref via the adapter's `getNotes`. Returns
 * the captured slice so callers (and tests) can assert against it.
 */
const captureLiveNotes = (): ReadonlyArray<AudioNote> => {
  const live = micPreviewNotes();
  setWhistleNotes(live);
  return live;
};

/**
 * Build the orchestrator handle. Awaits `Effect.runSync` once and
 * caches the handle. Idempotent: subsequent calls are no-ops.
 *
 * Pattern mirrors `VoiceAISession.test.ts` — materialise the
 * `AudioEngine` layer via `Layer.build`, pull the service out of
 * the resulting Context, then call `createWhistleSession` with the
 * captured deps. The session itself runs in `never, never` so it
 * can be `runSync`'d from presentation without further plumbing.
 */
export const initWhistle = (deps: {
  readonly audioLayer: Layer.Layer<AudioEngine, never, never>;
  readonly initialScore?: string;
}): void => {
  if (handle !== null) return;

  const builtProgram = Effect.gen(function* () {
    const builtEnv = yield* Layer.build(deps.audioLayer).pipe(Effect.scoped);
    const audio = Context.get(
      builtEnv as Context.Context<AudioEngine>,
      AudioEngine,
    );
    const scoreRef = yield* Ref.make<string>(deps.initialScore ?? '');
    return { audio, scoreRef };
  });

  const built = Effect.runSync(builtProgram);
  const notesRef: { current: ReadonlyArray<AudioNote> } = { current: [] };

  const mic: MicCaptureLike = {
    start: () => Effect.sync(() => startMic()),
    stop: () =>
      Effect.sync(() => {
        stopMic();
      }),
    feed: () => Effect.void,
    getNotes: () =>
      Effect.sync(() => {
        notesRef.current = captureLiveNotes();
        return notesRef.current;
      }),
  };

  const sessionProgram = createWhistleSession({
    mic,
    audio: built.audio,
    currentScoreRef: built.scoreRef,
  });

  handle = Effect.runSync(sessionProgram);

  // Subscribe to the orchestrator's state stream (daemon) and
  // mirror each transition into the Solid signal.
  Effect.runFork(
    Stream.runForEach(handle.stream, (s) =>
      Effect.sync(() =>
        untrack(() => {
          setWhistleState(s);
        }),
      ),
    ),
  );
};

/**
 * Start a whistle session: acquire `mic-direct`, kick off the
 * orchestrator, surface errors as typed `MicBusyError`.
 */
export const startWhistle = (
  opts: WhistleStartOpts,
): Effect.Effect<void, MicBusyError, never> =>
  Effect.gen(function* () {
    const claimed = acquireMic({
      kind: 'mic-direct',
      owner: { kind: 'whistle', sessionId: opts.sessionId },
      sessionId: opts.sessionId,
    });
    if (!claimed.ok) {
      logger.push('warn', [
        'whistleStore.startWhistle: mic busy',
        claimed.error.conflictingChannel.owner.kind,
      ]);
      return yield* Effect.fail(claimed.error);
    }
    activeSessionId = opts.sessionId;
    yield* Effect.sync(() => {
      setWhistleError(null);
      setWhistleNotes(micPreviewNotes());
    });
    if (handle === null) {
      // Fallback path: orchestrator not yet built. Mirror the FSM
      // arming transition so the UI lights up; the live mic still
      // captures via micStore.startMic, but `commitWhistle` will be
      // a no-op (snippet-via-orchestrator requires the layer).
      yield* Effect.sync(() => {
        startMic();
        setWhistleState({ tag: 'arming' });
      });
      return;
    }
    // Surface `MicPermissionError` as a string error on the local
    // signal; the orchestrator's typed `MicBusyError | MicPermissionError`
    // doesn't match the public `MicBusyError` signature, so we
    // catchAll and degrade gracefully (the wavecode-MicPanel still
    // works through its own dedicated UI).
    yield* handle.start({ instrument: opts.instrument ?? 'piano' }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          setWhistleError(err.message);
          setWhistleState({ tag: 'errored', error: err.message });
        }),
      ),
    );
  });

/** Commit the buffered notes → AudioEngine.eval. */
export const commitWhistle = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.sync(() => {
      const next: WhistleSessionState = { tag: 'idle' };
      setWhistleState(next);
    });
  }
  return Effect.gen(function* () {
    yield* handle!.commit();
  });
};

/** Stop the session and release `mic-direct`. Idempotent. */
export const stopWhistle = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (handle !== null) {
      yield* handle.stop();
    }
    const sid = activeSessionId;
    if (sid !== null) {
      yield* Effect.sync(() => releaseMic(sid));
    }
    activeSessionId = null;
    yield* Effect.sync(() => {
      setWhistleNotes([]);
    });
  });

/** Test-only: install a custom handle. */
export const __setWhistleHandleForTests = (
  h: WhistleSessionHandle | null,
): void => {
  handle = h;
};

/** Test-only: reset module state. */
export const __resetWhistleForTests = (): void => {
  handle = null;
  activeSessionId = null;
  setWhistleState(initialWhistleSession());
  setWhistleNotes([]);
  setWhistleError(null);
};

onCleanup(() => {
  activeSessionId = null;
  handle = null;
});
