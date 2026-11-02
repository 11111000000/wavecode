/**
 * rhythmStore — presentation-layer state + actions for the rhythm
 * recorder (the «Ритм» mini-FAB).
 *
 * What it does
 * ------------
 * The user taps a rhythm into the microphone; the hits are placed on
 * the app's step grid (16 sixteenths per bar, the transport's tempo)
 * and committed into the score as a drum pattern.
 *
 * How it differs from the whistle
 * -------------------------------
 * The whistle records a MELODY: sustained pitches become notes, and
 * the percussive hits the detector saw in the same take are the
 * whistle's own attacks — including them made every phrase sprout a
 * stray clap. The two flows are therefore strictly separate:
 *
 *   - whistle → `micPreviewNotes()`  → `note("c4@0.5").s("piano")`
 *   - rhythm  → `micTransients()`    → `s("drums_bd ~ ~ ~ …")`
 *
 * The rhythm recorder clears the hit buffer when it starts (so a
 * previous take's hits never leak in) and keeps the NOTE buffer
 * alone (so a whistle that is paused with its notes in the buffer
 * does not lose them).
 *
 * Layering
 * --------
 * Like `micStore.applyToScore`, this store is the only writer of
 * `appStore.score` in its flow — the arithmetic lives in
 * `domain/audio/rhythmGrid.ts`, the mic in `micStore`, and the
 * presentation layer only wires them together and dispatches.
 */

import { createSignal, onCleanup } from 'solid-js';
import * as Context from 'effect/Context';
import { Effect, Layer } from 'effect';
import type { Transient } from '~/domain/audio/transient';
import {
  quantizeHitsToGrid,
  rhythmGridToSnippet,
  stepMsForCps,
  estimateTapTempoBpm,
  type RhythmGrid,
} from '~/domain/audio/rhythmGrid';
import { appendToTopStack } from '~/domain/strudel';
import { AudioEngine } from '~/domain/services';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import {
  startMic,
  stopMic,
  micTransients,
  clearMicTransients,
  subscribeMicTransient,
} from './micStore';
import { acquireMic, releaseMic, resetMicMutexForTests } from './micMutexStore';
import { dispatch, appStore } from './appStore';
import { consoleStore } from '~/presentation/components/consoleStore';

/** Lifecycle of a rhythm take. */
export type RhythmPhase = 'idle' | 'recording';

export const [rhythmPhase, setRhythmPhase] = createSignal<RhythmPhase>('idle');

export const [rhythmError, setRhythmError] = createSignal<string | null>(null);

/**
 * The panel stays open after the take is paused so the user can press
 * «Применить» (the same contract as the whistle's armed flag).
 */
export const [rhythmPanelArmed, setRhythmPanelArmed] = createSignal<boolean>(
  false,
);

/**
 * The take's hits, mirrored out of the mic store's transient buffer.
 *
 * The mirror exists so the panel and the commit path read a value
 * that belongs to THIS take: `startRhythm` clears the shared buffer
 * and re-fills the mirror from then on.
 */
export const [rhythmHits, setRhythmHits] = createSignal<ReadonlyArray<Transient>>(
  [],
);

/**
 * The hits placed on the grid — the preview of what «Применить» will
 * write into the score. `null` until there is at least one hit.
 */
export const [rhythmGrid, setRhythmGrid] = createSignal<RhythmGrid | null>(null);

/**
 * The tempo the user tapped at, in BPM. Purely informational: the
 * pattern is always placed on the TRANSPORT's grid, not on this one.
 */
export const [rhythmTapBpm, setRhythmTapBpm] = createSignal<number | null>(null);

/** The tempo of the grid the hits are placed on, in BPM.
 *
 *  The app's convention: 1 cycle = 1 bar = 4 beats, and `cps` is
 *  cycles per second. So BPM = cps * 240 (0.5 cps → 120 BPM).
 */
export const gridBpm = (): number => appStore.transportState.cps * 240;

/** Duration of one step (a 16th note) at the transport's tempo. */
export const gridStepMs = (): number => stepMsForCps(appStore.transportState.cps);

/**
 * The rhythm session id, shared by every surface that can start a
 * take (the mini-FAB toggle and the panel's ●REC).
 *
 * One id, not one per surface: the mic mutex releases by session id
 * (`releaseMic(sessionId)` drops every channel that id owns), so a
 * take started by the FAB and stopped by the panel must speak the
 * same id — otherwise the device would stay claimed.
 */
let rhythmSessionId: string | null = null;

export const ensureRhythmSessionId = (): string => {
  if (rhythmSessionId === null) {
    rhythmSessionId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `rhythm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return rhythmSessionId;
};

let activeSessionId: string | null = null;

/* ── the audio handle (audition) ─────────────────────────────────── */

let audio: Context.Tag.Service<typeof AudioEngine> | null = null;

/**
 * Materialise the `AudioEngine` handle used to audition the recorded
 * rhythm. Mirrors `whistleStore.initWhistle`: the layer is built
 * once and cached, and the audition failures are swallowed (the
 * score splice is the thing that matters).
 */
export const initRhythm = (deps: {
  readonly audioLayer: Layer.Layer<AudioEngine, never, never>;
}): void => {
  if (audio !== null) return;
  const builtProgram = Effect.gen(function* () {
    const builtEnv = yield* Layer.build(deps.audioLayer).pipe(Effect.scoped);
    return Context.get(
      builtEnv as Context.Context<AudioEngine>,
      AudioEngine,
    );
  });
  audio = Effect.runSync(builtProgram);
};

/* ── the take ────────────────────────────────────────────────────── */

/**
 * Recompute the grid preview from the hits currently in the buffer.
 * Called on every hit and whenever the transport tempo changes.
 */
const refreshPreview = (hits: ReadonlyArray<Transient>): void => {
  setRhythmHits(hits);
  setRhythmTapBpm(estimateTapTempoBpm(hits));
  setRhythmGrid(quantizeHitsToGrid(hits, { stepMs: gridStepMs() }));
};

/**
 * Subscribe to the mic's hit stream so the preview follows the take
 * while it is running. Installed once, on the first start — the hits
 * live in the mic store's buffer, so the subscription only refreshes
 * the mirror.
 */
let unsubscribeHits: (() => void) | null = null;

const ensureHitSubscription = (): void => {
  if (unsubscribeHits !== null) return;
  unsubscribeHits = subscribeMicTransient(() => {
    refreshPreview(micTransients());
  });
};

/**
 * Start a rhythm take: claim the mic, clear the hit buffer, open the
 * capture. The NOTE buffer is left alone — a paused whistle take must
 * not lose its notes because the user went to record a rhythm.
 *
 * A mic-direct channel held by another owner surfaces as a typed
 * `MicBusyError`.
 */
export const startRhythm = (
  opts: { readonly sessionId: string },
): Effect.Effect<void, MicBusyError, never> =>
  Effect.gen(function* () {
    const claimed = acquireMic({
      kind: 'mic-direct',
      owner: { kind: 'rhythm', sessionId: opts.sessionId },
      sessionId: opts.sessionId,
    });
    if (!claimed.ok) {
      yield* Effect.fail(claimed.error);
      return;
    }
    activeSessionId = opts.sessionId;
    yield* Effect.sync(() => {
      setRhythmError(null);
      clearMicTransients();
      refreshPreview([]);
      ensureHitSubscription();
      // `keepBufferedNotes: true` — the whistle's notes survive.
      startMic({ keepBufferedNotes: true });
      setRhythmPhase('recording');
    });
  });

/**
 * Stop the take and release the mic. The hits stay in the buffer so
 * «Применить» can still commit them, and the panel is ARMED — a
 * paused take that takes the panel off screen together with the
 * hits can never be committed.
 */
export const stopRhythm = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      stopMic();
      setRhythmPhase('idle');
      refreshPreview(micTransients());
      setRhythmPanelArmed(true);
    });
    const sid = activeSessionId;
    if (sid !== null) {
      yield* Effect.sync(() => releaseMic(sid));
    }
    activeSessionId = null;
  });

/**
 * Commit the take: place the hits on the grid, audition the pattern
 * and splice it into the score.
 *
 * The snippet is written with `appendToTopStack` — the same slot the
 * whistle and the mic panel use — so the rhythm joins the existing
 * composition instead of replacing it.
 */
export const commitRhythm = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const hits = micTransients();
    const grid = quantizeHitsToGrid(hits, { stepMs: gridStepMs() });
    if (grid === null) {
      yield* Effect.sync(() => {
        consoleStore.pushToast({
          severity: 'warn',
          title: 'Ритм',
          body: 'Ни одного удара не поймано — постучите ещё раз.',
        });
      });
      return;
    }
    const snippet = rhythmGridToSnippet(grid);
    if (snippet === null) return;

    // Audition: the user must hear the quantised pattern, not the raw
    // timing they tapped. The score splice is a separate step — the
    // audition replaces the REPL pattern, the splice rewrites the
    // source.
    if (audio !== null) {
      yield* audio.eval(snippet).pipe(Effect.catchAll(() => Effect.void));
    }

    const result = appendToTopStack(appStore.score, snippet);
    if (!result.ok) {
      yield* Effect.sync(() => {
        consoleStore.pushToast({
          severity: 'warn',
          title: 'Не удалось вставить ритм',
          body: 'В score незакрытая скобка stack(...) — исправьте синтаксис и повторите.',
        });
      });
      return;
    }
    yield* Effect.sync(() => {
      dispatch({ type: 'replaceScore', text: result.score });
      clearMicTransients();
      refreshPreview([]);
      setRhythmPanelArmed(false);
    });
  });

/**
 * Throw the take away: stop the capture, drop the hits, keep the
 * panel open so the user can record again.
 */
export const discardRhythm = (): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* stopRhythm();
    yield* Effect.sync(() => {
      clearMicTransients();
      refreshPreview([]);
      setRhythmPanelArmed(false);
    });
  });

/**
 * Refresh the grid preview — called by the panel when the transport
 * tempo changes, because the same hits land on different steps at a
 * different tempo.
 */
export const refreshRhythmPreview = (): void => {
  refreshPreview(micTransients());
};

/** Test-only: reset the module state. */
export const __resetRhythmForTests = (): void => {
  rhythmSessionId = null;
  activeSessionId = null;
  audio = null;
  if (unsubscribeHits !== null) {
    unsubscribeHits();
    unsubscribeHits = null;
  }
  setRhythmPhase('idle');
  setRhythmError(null);
  setRhythmPanelArmed(false);
  setRhythmHits([]);
  setRhythmGrid(null);
  setRhythmTapBpm(null);
  resetMicMutexForTests();
};

onCleanup(() => {
  activeSessionId = null;
  if (unsubscribeHits !== null) {
    unsubscribeHits();
    unsubscribeHits = null;
  }
});
