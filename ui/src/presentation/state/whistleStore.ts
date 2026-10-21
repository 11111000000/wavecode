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
 * orchestrator AND splices the same snippet into `appStore.score`
 * via a presentation-layer dispatch — the orchestrator (application
 * layer) does not touch the editor, mirroring
 * `micStore.applyToScore` and `pianoRecStore.applyToScore`.
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
import { notesToSnippet } from '~/domain/audio/micCapture';
import { appendToTopStack } from '~/domain/strudel';
import { AudioEngine } from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import {
  createWhistleSession,
  type MicCaptureLike,
  type WhistleSessionHandle,
} from '~/application/voice/WhistleSession';
import { startMic, stopMic, micPreviewNotes, setMicPreviewNotes, subscribeMicFrame } from './micStore';
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
 * The Strudel sample a whistle session commits its notes to. There is
 * deliberately no selector for it — the mini-FAB dropped piano/synth/
 * drums to make whistle a one-gesture action — so this constant is the
 * only place the choice is written down. `startWhistle` forwards it to
 * the orchestrator and both surfaces that mention the timbre
 * (`WhistleMiniFAB`'s hint chip, `RecordingPanel`'s whistle body) read
 * `whistleInstrumentLabel()` rather than restating the name; a second
 * hardcoded copy in a component is how the label starts lying about
 * what `notesToSnippet` actually emits.
 */
export const WHISTLE_INSTRUMENT = 'piano';

/** Instrument of the session that is running right now. A signal and
 *  not a plain constant because `startWhistle` accepts an override —
 *  the UI must show what was committed, not what we default to. */
export const [whistleInstrument, setWhistleInstrument] = createSignal<string>(
  WHISTLE_INSTRUMENT,
);

/** Russian instrument names for the hint chips. Covers the whole
 *  `PianoInstrument` union even though whistle has no selector today,
 *  so an override passed to `startWhistle` still renders a name. */
const INSTRUMENT_LABEL: Readonly<Record<string, string>> = {
  piano: 'пианино',
  casio: 'казино',
  guitar: 'гитара',
  synth: 'синтезатор',
  triangle: 'треугольник',
  sine: 'синус',
  sawtooth: 'пила',
  square: 'меандр',
};

/** Display name of the instrument the session will commit to. Falls
 *  through to the raw name for an unknown instrument rather than
 *  rendering `undefined` into the chip. */
export const whistleInstrumentLabel = (): string =>
  INSTRUMENT_LABEL[whistleInstrument()] ?? whistleInstrument();

/** Options for `startWhistle`. */
export type WhistleStartOpts = {
  readonly sessionId: string;
  /** Defaults to `'piano'`. Forwarded into `notesToSnippet`. */
  readonly instrument?: string;
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
    yield* Effect.sync(() => {
      setWhistleError(null);
      setWhistleNotes(micPreviewNotes());
      setWhistleInstrument(opts.instrument ?? WHISTLE_INSTRUMENT);
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
    yield* handle.start({ instrument: opts.instrument ?? WHISTLE_INSTRUMENT }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          setWhistleError(err.message);
          setWhistleState({ tag: 'errored', error: err.message });
        }),
      ),
    );
  });

/** Default instrument forwarded to `notesToSnippet`. Mirrors the
 *  default in `startWhistle` (kept here as a single source of truth
 *  for the commit path because the orchestrator's `instrumentRef`
 *  is private to the application layer). */
const WHISTLE_DEFAULT_INSTRUMENT = 'piano';

/**
 * Commit the buffered notes. Two parallel effects:
 *   1. `handle.commit()` inside the orchestrator runs
 *      `notesToSnippet` + `AudioEngine.eval` so the user hears
 *      the result.
 *   2. This function additionally splices the same snippet into
 *      `appStore.score` so the editor mirrors what was whistled.
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
    yield* handle!.commit();
    if (notes.length === 0) return;
    const snippet = notesToSnippet(notes, {
      instrument: WHISTLE_DEFAULT_INSTRUMENT,
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
