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
 * `commitWhistle` builds the take's snippet (the whistled NOTES) through
 * `micSnippetFromBuffers`, auditions it
 * via the orchestrator AND splices the same snippet into
 * `appStore.score` via a presentation-layer dispatch — the
 * orchestrator (application layer) does not touch the editor,
 * mirroring `micStore.applyToScore` and `pianoRecStore.applyToScore`.
 * `stopWhistle` releases the mic and stops the live mic. Acquire
 * failure (another mic-direct owner is active) surfaces as a typed
 * `MicBusyError` — the WhistleMiniFAB surfaces a toast.
 */

import { createSignal, onCleanup, untrack } from 'solid-js';
import * as Context from 'effect/Context';
import { Effect, Layer, Ref, Stream } from 'effect';
import type { WhistleSessionState } from '~/domain/audio/whistleSession';
import { initialWhistleSession } from '~/domain/audio/whistleSession';
import type { AudioNote } from '~/domain/audio/micCapture';
import { micSnippetFromBuffers } from '~/domain/audio/micSnippet';
import { soundLabel, isMelodicSound } from '~/domain/sounds';
import { appendToTopStack } from '~/domain/strudel';
import { AudioEngine } from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import {
  createWhistleSession,
  type MicCaptureLike,
  type WhistleSessionHandle,
} from '~/application/voice/WhistleSession';
import {
  startMic,
  stopMic,
  micPreviewNotes,
  setMicPreviewNotes,
  subscribeMicFrame,
  clearPreview,
} from './micStore';
import { acquireMic, releaseMic, resetMicMutexForTests } from './micMutexStore';
import { dispatch, appStore } from './appStore';
import { consoleStore } from '~/presentation/components/consoleStore';
import { logger } from '~/infrastructure/log';

export const [whistleState, setWhistleState] = createSignal<WhistleSessionState>(
  initialWhistleSession(),
);

export const [whistleNotes, setWhistleNotes] = createSignal<
  ReadonlyArray<AudioNote>
>([]);

export const [whistleError, setWhistleError] = createSignal<string | null>(null);

/**
 * UI flag: the user has tapped the whistle FAB without holding long
 * enough to start recording. The panel renders a ●REC + «Применить»
 * pair until the user presses ●REC (which starts the orchestrator and
 * clears the flag) or ✕ (which clears the flag and drops the buffer).
 *
 * Pure presentation concern, NOT a `whistleSessionReducer` state —
 * the orchestrator's job is mic + segmenter + score splice, not "user
 * opened the panel before pressing record". See
 * `decisions/wavecode-voice-rec-and-meter` outcome `armed-state-
 * lives-in-presentation-not-domain-fsm`.
 */
export const [whistlePanelArmed, setWhistlePanelArmed] = createSignal<boolean>(
  false,
);

/** Request the whistle armed state. Called by `WhistleMiniFAB` on a
 *  fast `pointerup` (held below `MIN_HOLD_BEFORE_RELEASE_OK_MS`).
 *  Idempotent. */
export const requestWhistlePanelArmed = (): void => {
  setWhistlePanelArmed(true);
};

/** Drop the whistle armed state. Called when the in-panel ●REC
 *  fires the orchestrator (so the live body takes over), when the
 *  user dismisses the panel via ✕, and after `commitWhistle`
 *  applies the buffered notes. */
export const clearWhistlePanelArmed = (): void => {
  setWhistlePanelArmed(false);
};

/**
 * The default melodic sound a whistle take commits its notes to.
 *
 * It MUST be a name superdough knows — the catalogue in
 * `domain/sounds.ts` is exactly the set of registered names, and an
 * unknown name is fatal at trigger time (`sound X not found!`), not
 * merely quiet. The user picks another sound from the same catalogue
 * through `chooseWhistleInstrument`; the panel and the hint chip read
 * `whistleInstrumentLabel()` rather than restating the name, so a
 * second hardcoded copy in a component cannot make the label lie about
 * what the take actually plays.
 */
export const WHISTLE_INSTRUMENT = 'piano';

/** Instrument of the session that is running right now. A signal and
 *  not a plain constant because `startWhistle` accepts an override —
 *  the UI must show what was committed, not what we default to. */
export const [whistleInstrument, setWhistleInstrument] = createSignal<string>(
  WHISTLE_INSTRUMENT,
);

/**
 * Pick the melodic sound of the next whistle take.
 *
 * Only names from the catalogue (`domain/sounds.ts`) are accepted: a
 * `.s("…")` name that superdough does not know is FATAL at trigger
 * time (`sound <name> not found!`), it does not just fall silent.
 * The catalogue is exactly the set of registered names, so the
 * guard here is what keeps an unplayable sound out of a take.
 */
export const chooseWhistleInstrument = (id: string): void => {
  if (!isMelodicSound(id)) return;
  setWhistleInstrument(id);
};

/**
 * The instrument the RUNNING take was started with.
 *
 * A take's timbre is fixed when it starts: the notes are committed as
 * one snippet, so a mid-take switch would make the audition and the
 * score disagree (the orchestrator holds the instrument it was
 * started with, the store would splice a different one).
 */
let activeInstrument: string = WHISTLE_INSTRUMENT;

/** Display name of the instrument the session will commit to. Falls
 *  through to the raw name for an unknown instrument rather than
 *  rendering `undefined` into the chip. */
export const whistleInstrumentLabel = (): string =>
  soundLabel(whistleInstrument());

/** Options for `startWhistle`. */
export type WhistleStartOpts = {
  readonly sessionId: string;
  /** Defaults to `'piano'`. Forwarded into the snippet builder. */
  readonly instrument?: string;
};

/**
 * The whistle session id, shared by every surface that can start a
 * whistle take (the mini-FAB toggle and the panel's ●REC).
 *
 * One id, not one per surface: the mic mutex releases by session id
 * (`releaseMic(sessionId)` drops every channel that id owns), so a
 * take started by the FAB and stopped by the panel must speak the
 * same id — otherwise the release would not match the acquire and
 * the device would stay claimed.
 */
let whistleSessionId: string | null = null;

/** Stable id for the current whistle take. Created once, reused. */
export const ensureWhistleSessionId = (): string => {
  if (whistleSessionId === null) {
    whistleSessionId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `whistle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return whistleSessionId;
};

let handle: WhistleSessionHandle | null = null;
let activeSessionId: string | null = null;
let unsubscribeFrame: (() => void) | null = null;

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

/** True when the segmenter holds notes from an earlier (paused) take.
 *  The mic restart must not wipe them. */
const hasBufferedNotes = (): boolean => micPreviewNotes().length > 0;

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
    // Resume, not restart: the whistle toggle pauses a take and the
    // next press continues it. Without `keepBufferedNotes` the
    // segmenter's buffer would be wiped by the mic restart and the
    // notes the user had just whistled would be gone — the pause
    // would silently mean "start over".
    start: () => Effect.sync(() => startMic({ keepBufferedNotes: hasBufferedNotes() })),
    stop: () =>
      Effect.sync(() => {
        stopMic();
      }),
    // The orchestrator's `handle.feed(frame)` is invoked by the live
    // MicCapture pipeline through the subscription installed below —
    // we KEEP this adapter as a no-op so the orchestrator doesn't
    // double-feed (one feed through the subscription, one through the
    // adapter). The orchestrator's FSM then sees every frame and the
    // `commit()` path can transition from `recording` → `segmenting`
    // with the accumulated `notes`.
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

  // Bridge live MicCapture frames → orchestrator.handle.feed so the
  // FSM accumulates notes during a press-and-hold whistle session.
  // Without this, `handle.commit()` finds the FSM in `arming` and
  // bails out of the `if (s.tag !== 'segmenting') return;` guard —
  // net effect: the user whistles and NOTHING plays. See the test
  // "whistle orchestrator end-to-end via subscribeMicFrame" added
  // alongside this change.
  if (unsubscribeFrame === null) {
    unsubscribeFrame = subscribeMicFrame((frame) => {
      if (handle !== null) {
        void Effect.runPromise(handle.feed(frame));
      }
    });
  }
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
    const instrument = opts.instrument ?? WHISTLE_INSTRUMENT;
    activeInstrument = instrument;
    yield* Effect.sync(() => {
      setWhistleError(null);
      setWhistleNotes(micPreviewNotes());
      setWhistleInstrument(instrument);
    });
    if (handle === null) {
      // Fallback path: orchestrator not yet built. Mirror the FSM
      // arming transition so the UI lights up; the live mic still
      // captures via micStore.startMic, but `commitWhistle` will be
      // a no-op (snippet-via-orchestrator requires the layer).
      yield* Effect.sync(() => {
        startMic({ keepBufferedNotes: hasBufferedNotes() });
        setWhistleState({ tag: 'arming' });
      });
      return;
    }
    // Surface `MicPermissionError` as a string error on the local
    // signal; the orchestrator's typed `MicBusyError | MicPermissionError`
    // doesn't match the public `MicBusyError` signature, so we
    // catchAll and degrade gracefully (the wavecode-MicPanel still
    // works through its own dedicated UI).
    yield* handle.start({ instrument }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          setWhistleError(err.message);
          setWhistleState({ tag: 'errored', error: err.message });
        }),
      ),
    );
  });

/**
 * Commit the buffered take. Two parallel effects:
 *   1. `handle.commit()` inside the orchestrator builds the snippet
 *      (notes + transients) and runs `AudioEngine.eval` so the user
 *      hears the result.
 *   2. This function additionally splices the SAME snippet into
 *      `appStore.score` so the editor mirrors what was whistled.
 *
 * Both sides call `micSnippetFromBuffers` — the one function that
 * turns the mic's two buffers into a Strudel snippet — so the
 * audition and the commit are the same string, and a tapped rhythm
 * (the transients) survives the trip into the score.
 *
 * Audio is intentionally NOT replayed here — the orchestrator already
 * drove `deps.audio.eval(snippet)`; a second eval would layer the
 * snippet on top of itself in Strudel and play it twice.
 */
export const commitWhistle = (): Effect.Effect<void, never, never> => {
  if (handle === null) {
    return Effect.sync(() => {
      const next: WhistleSessionState = { tag: 'idle' };
      setWhistleState(next);
    });
  }
  return Effect.gen(function* () {
    // Snapshot before the orchestrator's async eval resumes control:
    // `WhistleMiniFAB.releaseIfReal` fires commit + stop back-to-back
    // via two `Effect.runPromise` calls; in production both Effects
    // interleave at the first await point inside `audio.eval`, so a
    // later read of `micPreviewNotes()` could race with `stopMic`'s
    // `closeOpenNote` finalisation. Capturing now removes that
    // dependency — even if `stopMic` clears the live buffer first,
    // we still have the notes we observed at the start of commit.
    const notes = micPreviewNotes();
    // A whistle take is a MELODY. The percussive hits the detector
    // saw in the same take are the whistle's OWN onsets — feeding
    // them into the snippet sprouted a clap on every phrase (the
    // "a beat appears out of nowhere" complaint). Percussion has its
    // own recorder now (the «Ритм» button), which places the hits on
    // the grid instead of guessing where they belong.
    yield* handle!.commit();
    // The instrument of the TAKE (captured when it started), not the
    // live picker value: the notes are committed as one snippet, so
    // the timbre must not change under the user's feet.
    const snippet = micSnippetFromBuffers(notes, [], {
      instrument: activeInstrument,
    });
    if (snippet === null) return;
    const result = appendToTopStack(appStore.score, snippet);
    if (!result.ok) {
      consoleStore.pushToast({
        severity: 'warn',
        title: 'Не удалось вставить запись',
        body: 'В score незакрытая скобка stack(...) — исправьте синтаксис и повторите.',
      });
      return;
    }
    dispatch({ type: 'replaceScore', text: result.score });
    // The notes are in the score now. Leaving them in the segmenter's
    // buffer would make the NEXT whistle take inherit them — the
    // strip would show the old notes and «Применить» would splice
    // them a second time.
    clearPreview();
  });
};

/** Stop the session and release `mic-direct`. Idempotent.
 *
 *  The orchestrator owns the FSM's `recording → idle` transition;
 *  here we have to mirror it manually when `handle === null` (the
 *  test-and-degraded path where `WhistleMiniFAB` swallows the
 *  orchestrator). Without this, a release that happens before any
 *  orchestrator is wired leaves the FSM stuck on `arming`. The two
 *  paths produce the same observable state, so callers don't notice
 *  the difference. */
export const stopWhistle = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (handle === null) {
      yield* Effect.sync(() => {
        setWhistleState({ tag: 'idle' });
      });
    } else {
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

/**
 * Delete the recorded audio (the buffered notes), keep the panel open.
 *
 * This is the panel's «Удалить» button for the whistle path. The
 * whistle has no transcript of its own, so "keep the text" degenerates
 * to "keep the panel": the user stays where they are (the panel with
 * an empty note strip, ●REC ready for another take, «Применить»
 * disabled because there is nothing to apply) instead of being
 * dropped back to the editor with the panel gone.
 *
 * `stopWhistle` releases the mic and parks the FSM at `idle`; the
 * notes themselves live in `micStore`'s preview buffer, which
 * `clearPreview()` empties — including the segmenter's internal
 * state, so a fresh take cannot resurrect the deleted notes.
 */
export const discardWhistleTake = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* stopWhistle();
    yield* Effect.sync(() => {
      clearPreview();
      setWhistleNotes([]);
    });
    // Keep the panel on screen: the take is gone, the surface is not.
    requestWhistlePanelArmed();
  });

/** Test-only: install a custom handle. */
export const __setWhistleHandleForTests = (
  h: WhistleSessionHandle | null,
): void => {
  handle = h;
};

/** Test-only: reset module state. Also clears `micPreviewNotes` so
 *  leaks from a sibling test file (or a previous test in this file)
 *  do not pollute the orchestrator's commit path — without this
 *  reset, a stale note buffer from an earlier test would sneak into
 *  the dispatched score. Resets the mic mutex too so that a leaked
 *  acquire from an earlier test does not block this test's
 *  `startWhistle` (which would surface as a `MicBusyError`). */
export const __resetWhistleForTests = (): void => {
  if (unsubscribeFrame !== null) {
    unsubscribeFrame();
    unsubscribeFrame = null;
  }
  handle = null;
  activeSessionId = null;
  whistleSessionId = null;
  setWhistleState(initialWhistleSession());
  setWhistleNotes([]);
  setMicPreviewNotes([]);
  setWhistleError(null);
  setWhistleInstrument(WHISTLE_INSTRUMENT);
  setWhistlePanelArmed(false);
  resetMicMutexForTests();
};

onCleanup(() => {
  if (unsubscribeFrame !== null) {
    unsubscribeFrame();
    unsubscribeFrame = null;
  }
  activeSessionId = null;
  handle = null;
});
