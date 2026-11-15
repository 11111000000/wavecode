import { createSignal } from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine, type LiveParam, type LiveParamName } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import { computeFeatures } from '~/domain/gesture/features';
import { GestureDetector, type GestureDetectorOptions } from '~/domain/gesture/detector';
import { mapFeaturesToControls, CLOSENESS_RANGE, type AxisMapping } from '~/domain/gesture/mapping';
import { quantizeToCycle } from '~/domain/gesture/quantize';
import { OneEuroFilter } from '~/domain/gesture/oneEuro';
import type {
  ControlEvent,
  ContinuousParam,
  GestureFeatures,
  GestureName,
  HandFrame,
  Landmark,
} from '~/domain/gesture/types';
import {
  startGestureCapture,
  type GestureCaptureHandle,
  type GestureCaptureStatus,
} from '~/infrastructure/gesture/GestureCapture';
import {
  calibrationFromSamples,
  defaultCalibration,
  isCalibrated,
  normalizePalmSize,
  type GestureCalibration,
} from '~/infrastructure/gesture/gestureCalibration';
import { triggerHaptic } from '~/infrastructure/haptics';
import { previewSample, scheduleGridEdit } from './audioActions';
import { dispatch, appStore } from './appStore';
import { appendGridToScore } from './gridState';
import { editGridLayer } from '~/application/useCases/editGridLayer';
import {
  GRID_COLS,
  GRID_ROWS,
  type Grid,
  type GridRowSample,
} from '~/domain/music/gridTypes';
import {
  buildTermGrid as buildTermGridFromHits,
  isTermTarget,
  termSampleForGesture,
  TERM_TARGET_DEFAULT,
  type TermHit,
} from '~/domain/gesture/term';
import { cps } from './transportState';
import { logger } from '~/infrastructure/log';

/**
 * gestureStore — presentation-layer bridge between the camera capture and
 * the audio engine.
 *
 * PIPELINE (mirrors `docs/hand-gesture-control-design.md` §2)
 *
 *   capture → computeFeatures → 1 € filter → detector.update → mapping
 *          → ControlEvent → (continuous) AudioEngine.setLiveParam
 *                          → (discrete)   haptics + quantised drum hit
 *
 * Everything gesture-specific lives in `domain/gesture/**` (pure, testable
 * without a camera). This module only:
 *   - owns the Solid signals the panel renders,
 *   - owns the ONE-EURO smoothing instance (per feature axis),
 *   - translates `ControlEvent`s into calls on the `AudioEngine` service.
 *
 * WHY THE CAMERA IS NEVER STARTED ON BOOT
 * ---------------------------------------
 * `installGestureController()` only WIRES the pipeline — it never touches the
 * camera. The capture starts exclusively through `enableGestureControl()`,
 * which the panel calls from the «Управление руками» toggle (i.e. from a
 * real user gesture, so the browser permission prompt is not swallowed).
 *
 * LIVE-CAPABLE PARAMETERS (today)
 * -------------------------------
 * `AudioEngine.setLiveParam` accepts `gain | cutoff | hcutoff | room | speed`
 * on the master scope. What each of our parameters does with it:
 *
 *   | ContinuousParam | live call                        | audible today?      |
 *   |-----------------|----------------------------------|---------------------|
 *   | `volume`        | master `gain`, 0 .. 1.5          | YES — the master    |
 *   |                 |                                  | GainNode is live    |
 *   | `cutoff`        | master `cutoff`, 200 .. 12000 Hz  | no — accepted and   |
 *   |                 |                                  | clamped by the      |
 *   |                 |                                  | engine, but the     |
 *   |                 |                                  | per-voice FX is not |
 *   |                 |                                  | globally reachable  |
 *   | `room`          | master `room`, 0 .. 1            | no (same reason)    |
 *   | `speed`         | master `speed`, 0.5 .. 2         | no (same reason)    |
 *   | `pitch`         | — no live param: it is a SCORE    | n/a — UI / term-    |
 *   |                 | concept (a note to play)          | mode state only     |
 *   | `pan`           | — `LiveParamName` has no `pan`    | n/a — UI state only |
 *
 * The calls for `cutoff` / `room` / `speed` are still made: the engine
 * validates and clamps them, so they start working the moment the FX chain
 * becomes globally reachable.
 */

// ── constants ────────────────────────────────────────────────────────────────

/** How long a pinch buzzes (ms). 5 ms = the repo's standard "snap" tick. */
export const PINCH_HAPTIC_MS = 5;

/**
 * Same gesture repeated within this window is treated as the SAME event
 * (the detector and the mapping can both report a pinch for one frame).
 */
const DISCRETE_DEDUPE_MS = 60;

/**
 * Look-ahead for the rhythm quantiser: a hit is never scheduled earlier than
 * this, because the detector + filter + audio ramp already cost ~70-130 ms.
 */
export const QUANTIZE_LOOKAHEAD_MS = 120;

/**
 * Rhythm division used for the quantised hits.
 *
 * The wavecode grid is 8 columns per cycle (`GRID_COLS`), so the cycle is
 * divided into 8 — one subdivision per grid column. The audible hit and the
 * recorded cell therefore always land on the same tick.
 */
export const TERM_DIVISION = 8;

/** Master gain reset value (1.0 = unity). */
const NEUTRAL_GAIN = 1;

/** Master cutoff reset value — wide open (no filtering). */
const NEUTRAL_CUTOFF_HZ = 20000;

/** Master room reset value — dry. */
const NEUTRAL_ROOM = 0;

/** Master speed reset value — 1.0 = normal playback rate. */
const NEUTRAL_SPEED = 1;

/** Hand is considered LOST after this long without a frame (design §3.8). */
const HAND_LOST_MS = 1500;

/** Watchdog tick — how often the "hand lost" state is re-evaluated. */
const WATCHDOG_INTERVAL_MS = 500;

/** Sensitivity range for the 1 € filter `minCutoffHz` (design §3.3). */
export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 3;
export const SENSITIVITY_DEFAULT = 1;

// ── types ────────────────────────────────────────────────────────────────────

/** Lifecycle of the gesture feature as the panel sees it. */
export type GestureStatus =
  /** Camera off. */
  | 'idle'
  /** Permission prompt / tracker warm-up in progress. */
  | 'starting'
  /** Camera running, hand tracked. */
  | 'running'
  /** Camera running, but no hand in frame for > 1.5 s. */
  | 'no-hand'
  /** Permission denied / tracker failure. */
  | 'error';

/** Response curve of an axis. */
export type GestureCurve = 'linear' | 'log' | 'exp';

/**
 * One configurable row of the axis list.
 *
 * The domain mapping is PARAM-keyed (`AxisMapping` in
 * `domain/gesture/mapping.ts`): every continuous parameter has ONE fixed
 * source feature (pitch ← palm height, volume ← openness, pan ← palm X,
 * cutoff/room ← closeness, speed ← roll). The panel therefore presents one
 * row per parameter; the row's select can REASSIGN the row to another
 * parameter (the two rows swap) or switch it off.
 */
export type GestureAxisConfig = {
  /** The parameter this row drives — `null` = the row is off. */
  readonly param: ContinuousParam | null;
  readonly invert: boolean;
  readonly curve: GestureCurve;
};

/**
 * One recorded hit of the "терминовка" (term) mode.
 *
 * The shape lives in the domain (`domain/gesture/term`) — the store only
 * owns the signals; the alias keeps the store's public API stable.
 */
export type GestureTermHit = TermHit;

/** Calibration bookkeeping exposed to the panel. */
export type GestureCalibrationState = {
  /** `palmSize` sample the user showed while holding the hand close. */
  readonly nearSample: number | null;
  /** `palmSize` sample the user showed while holding the hand far. */
  readonly farSample: number | null;
  /** True once both samples produced a usable calibration. */
  readonly calibrated: boolean;
};

/** Options for `installGestureController`. */
export type GestureControllerOptions = {
  /**
   * Detector tuning. Tests use this to make the hold/throttle window
   * deterministic; production leaves it at the domain defaults.
   */
  readonly detectorOptions?: GestureDetectorOptions;
  /** Observer for every emitted control event (panel-free integrations). */
  readonly onControlEvent?: (event: ControlEvent) => void;
};

/** The handle returned by `installGestureController`. */
export type GestureController = {
  readonly enable: () => Promise<void>;
  readonly disable: () => void;
  readonly toggle: () => Promise<void>;
  /** Push the live params back to their neutral values. */
  readonly resetLiveParams: () => void;
  /** Stop the camera and release every resource. */
  readonly dispose: () => void;
};

// ── axis defaults ────────────────────────────────────────────────────────────

/**
 * Default polarity per parameter — mirrors the domain table in
 * `domain/gesture/mapping.ts` (`defaultInvert`). The panel always sends an
 * explicit `invert`, so the store has to know the defaults itself.
 */
const DEFAULT_INVERT: Readonly<Record<ContinuousParam, boolean>> = {
  pitch: true,
  volume: false,
  pan: false,
  cutoff: false,
  room: false,
  speed: false,
};

/**
 * Default rows: pitch (the musical axis), volume (the audible one) and
 * cutoff (brightness) are on; pan / room / speed start switched off so the
 * first camera session does not move more knobs than the user asked for.
 */
const DEFAULT_AXES: ReadonlyArray<GestureAxisConfig> = [
  { param: 'pitch', invert: true, curve: 'linear' },
  { param: 'volume', invert: false, curve: 'linear' },
  { param: 'cutoff', invert: false, curve: 'linear' },
  { param: null, invert: false, curve: 'linear' },
  { param: null, invert: false, curve: 'linear' },
  { param: null, invert: false, curve: 'linear' },
];

/** All parameters the UI can bind an axis to (`null` = off). */
export const GESTURE_PARAM_OPTIONS: ReadonlyArray<ContinuousParam> = [
  'pitch',
  'volume',
  'pan',
  'cutoff',
  'room',
  'speed',
];

/** Curves offered by the UI. */
export const GESTURE_CURVE_OPTIONS: ReadonlyArray<GestureCurve> = [
  'linear',
  'log',
  'exp',
];

// ── signals ──────────────────────────────────────────────────────────────────

/** Master toggle state (true = camera running). */
export const [gestureEnabled, setGestureEnabled] = createSignal(false);

/** Lifecycle status of the feature. */
export const [gestureStatus, setGestureStatus] = createSignal<GestureStatus>('idle');

/** Last error (permission denied, tracker failure, …). */
export const [gestureError, setGestureError] = createSignal<string | null>(null);

/** Latest (filtered) features of the tracked hand. */
export const [gestureFeatures, setGestureFeatures] = createSignal<GestureFeatures | null>(null);

/** Latest raw landmarks of the tracked hand — for the preview overlay. */
export const [gestureLandmarks, setGestureLandmarks] = createSignal<
  ReadonlyArray<Landmark> | null
>(null);

/** Currently recognised discrete gesture (null when none is held). */
export const [gestureActive, setGestureActive] = createSignal<GestureName | null>(null);

/** Current value per continuous parameter (normalised 0..1). */
export const [gestureLiveValues, setGestureLiveValues] = createSignal<
  Readonly<Record<string, number>>
>({});

/** Per-axis mapping configuration (one row per continuous parameter). */
export const [gestureAxes, setGestureAxes] = createSignal<
  ReadonlyArray<GestureAxisConfig>
>(DEFAULT_AXES);

/** 1 € filter `minCutoffHz` (Hz) — the "чувствительность" slider. */
export const [gestureSensitivity, setGestureSensitivitySignal] = createSignal<number>(
  SENSITIVITY_DEFAULT,
);

/** Active calibration pair. */
export const [gestureCalibration, setGestureCalibration] = createSignal<GestureCalibration>(
  defaultCalibration(),
);

/** Calibration bookkeeping (raw samples + calibrated flag). */
export const [gestureCalibrationState, setGestureCalibrationState] = createSignal<
  GestureCalibrationState
>({ nearSample: null, farSample: null, calibrated: false });

/** Track two hands at once. */
export const [gestureTwoHands, setGestureTwoHands] = createSignal(false);

/** «Режим терминовки» — collect discrete hits into a rhythm. */
export const [gestureTermMode, setGestureTermModeSignal] = createSignal(false);

/**
 * Target length of the term recording — the number of HITS the user
 * intends to play (4 / 8 / 16). See `domain/gesture/term`.
 */
export const [gestureTermTarget, setGestureTermTargetSignal] = createSignal<number>(
  TERM_TARGET_DEFAULT,
);

/** Hits collected in term mode. */
export const [gestureTermHits, setGestureTermHits] = createSignal<
  ReadonlyArray<GestureTermHit>
>([]);

/** The <video> element the panel renders — handed to the capture. */
export const [gestureVideoElement, setGestureVideoElement] = createSignal<
  HTMLVideoElement | null
>(null);

// ── axis defaults (moved above the signals — see the block below) ────────────

// ── live-parameter routing ───────────────────────────────────────────────────

type LiveTarget = {
  readonly param: LiveParamName;
  readonly rampMs: number;
};

/**
 * Which `ContinuousParam`s have a live counterpart in the audio engine.
 *
 * `pitch` is a SCORE concept (a note to play), not a DSP knob, and `pan` has
 * no entry in `LiveParamName` — both are pure UI / term-mode state.
 */
const LIVE_TARGETS: Readonly<Record<ContinuousParam, LiveTarget | null>> = {
  volume: { param: 'gain', rampMs: 80 },
  cutoff: { param: 'cutoff', rampMs: 100 },
  room: { param: 'room', rampMs: 120 },
  speed: { param: 'speed', rampMs: 60 },
  pitch: null,
  pan: null,
};

/**
 * Convert a normalised control value (0..1) into the unit the live engine
 * expects.
 *
 * `mapFeaturesToControls` returns NORMALISED values in 0..1 (the domain
 * mapping owns the curve / deadzone / inversion, not the units). The unit
 * conversion lives here, in the layer that knows what the engine takes.
 */
const toLiveValue = (param: ContinuousParam, normalized: number): number => {
  const v = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
  switch (param) {
    case 'volume':
      return v * 1.5;
    case 'cutoff':
      return 200 * Math.pow(12000 / 200, v);
    case 'room':
      return v;
    case 'speed':
      return 0.5 + v * 1.5;
    default:
      return v;
  }
};

// ── controller internals ─────────────────────────────────────────────────────

/** Per-axis 1 € filters (the design smooths FEATURES, not raw landmarks). */
type FilterBundle = {
  readonly x: OneEuroFilter;
  readonly y: OneEuroFilter;
  readonly closeness: OneEuroFilter;
  readonly openness: OneEuroFilter;
  readonly pinch: OneEuroFilter;
  readonly roll: OneEuroFilter;
};

/**
 * 1 € smoothing of the feature vector.
 *
 * The 1 € filter (Casiez et al., CHI 2012) is adaptive: it removes jitter on
 * slow movement without adding latency on fast movement. `minCutoffHz` is the
 * "чувствительность" slider (0.5 Hz = slow/smooth, 3 Hz = snappy).
 */
class FeatureSmoother {
  private readonly filters: FilterBundle;

  constructor(minCutoffHz: number) {
    const opts = { minCutoffHz, beta: 0.01 };
    this.filters = {
      x: new OneEuroFilter(opts),
      y: new OneEuroFilter(opts),
      closeness: new OneEuroFilter(opts),
      openness: new OneEuroFilter(opts),
      pinch: new OneEuroFilter(opts),
      roll: new OneEuroFilter(opts),
    };
  }

  apply(features: GestureFeatures): GestureFeatures {
    const tsMs = features.tsMs;
    return {
      ...features,
      palmCenterX: this.filters.x.filter(features.palmCenterX, tsMs),
      palmCenterY: this.filters.y.filter(features.palmCenterY, tsMs),
      closeness: this.filters.closeness.filter(features.closeness, tsMs),
      openness: this.filters.openness.filter(features.openness, tsMs),
      pinch: this.filters.pinch.filter(features.pinch, tsMs),
      rollDeg: this.filters.roll.filter(features.rollDeg, tsMs),
    };
  }

  reset(): void {
    this.filters.x.reset();
    this.filters.y.reset();
    this.filters.closeness.reset();
    this.filters.openness.reset();
    this.filters.pinch.reset();
    this.filters.roll.reset();
  }
}

const createController = (opts: GestureControllerOptions): GestureController => {
  let capture: GestureCaptureHandle | null = null;
  let detector: GestureDetector | null = null;
  let smoother: FeatureSmoother | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let lastFrameAtMs = 0;
  let lastDiscreteGesture: GestureName | null = null;
  let lastDiscreteAtMs = 0;

  // ── audio bridge ──────────────────────────────────────────────────────────

  const pushLiveParam = (param: LiveParam): void => {
    void Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        // `setLiveParam` is OPTIONAL on the service: an engine build without
        // the live-DSP path must not break the gesture pipeline.
        if (typeof audio.setLiveParam !== 'function') return;
        audio.setLiveParam(param);
      }).pipe(Effect.provide(AppLayer)),
    ).catch(() => undefined);
  };

  const applyContinuous = (param: ContinuousParam, value: number): void => {
    setGestureLiveValues((prev) => ({ ...prev, [param]: value }));
    const target = LIVE_TARGETS[param];
    // `pitch` / `pan` have no live counterpart — UI state only.
    if (target === null) return;
    pushLiveParam({
      scope: { scope: 'master' },
      param: target.param,
      value: toLiveValue(param, value),
      rampMs: target.rampMs,
    });
  };

  const resetLiveParams = (): void => {
    pushLiveParam({ scope: { scope: 'master' }, param: 'gain', value: NEUTRAL_GAIN, rampMs: 120 });
    pushLiveParam({ scope: { scope: 'master' }, param: 'cutoff', value: NEUTRAL_CUTOFF_HZ, rampMs: 120 });
    pushLiveParam({ scope: { scope: 'master' }, param: 'room', value: NEUTRAL_ROOM, rampMs: 120 });
    pushLiveParam({ scope: { scope: 'master' }, param: 'speed', value: NEUTRAL_SPEED, rampMs: 60 });
    setGestureLiveValues({});
  };

  // ── rhythm ────────────────────────────────────────────────────────────────

  /**
   * Read the current cycle position (0..1) from the audio engine.
   *
   * `getCycleProgress` is an Effect, so this is asynchronous — the caller
   * awaits it before quantising. When the engine was never started the
   * progress is 0, which still yields a valid (if arbitrary) grid position.
   */
  const readCycleProgress = async (): Promise<number> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        return yield* audio.getCycleProgress();
      }).pipe(Effect.provide(AppLayer)),
    ).catch(() => 0);

  /**
   * Schedule a drum hit on the next grid division and record its position.
   *
   * `quantizeToCycle` returns the ABSOLUTE scheduled time (`timeMs`) and the
   * offset INSIDE the target cycle (`offsetMs`); the delay is therefore
   * `timeMs - nowMs`.
   *
   * WHICH sample sounds depends on the mode:
   *   - in term mode the gesture's own row sounds (щипок → бочка, ладонь →
   *     хай-хэт, кулак → малый барабан, щелчок → хлоп) — the mapping lives
   *     in `domain/gesture/term`;
   *   - outside term mode only the щипок keeps its percussive preview — the
   *     behaviour the panel had before the term box existed.
   */
  const scheduleQuantizedHit = async (gesture: GestureName, tsMs: number): Promise<void> => {
    const nowMs = performance.now();
    const cycleProgress = await readCycleProgress();
    const quantized = quantizeToCycle({
      cycleProgress,
      cps: cps(),
      nowMs,
      lookaheadMs: QUANTIZE_LOOKAHEAD_MS,
      division: TERM_DIVISION,
    });

    const delayMs = Math.max(0, quantized.timeMs - nowMs);

    const sample = termSampleForGesture(gesture);
    const termMode = gestureTermMode();

    // The one-shot itself is fired by `previewSample` (the shared drum
    // preview path). It plays immediately when it is called, so we call it
    // after the quantised delay and keep the exact grid position for the
    // term-mode buffer.
    const audible: GridRowSample | null = termMode
      ? sample
      : gesture === 'pinch'
        ? 'bd'
        : null;
    if (audible !== null) {
      setTimeout(() => {
        previewSample(audible);
      }, delayMs);
    }

    if (!termMode) return;
    if (sample === null) return;

    const cycleDurationMs = 1000 / Math.max(0.01, cps());
    // `offsetMs` is the offset inside the target cycle → the grid column.
    const position = (quantized.offsetMs / cycleDurationMs) % 1;
    const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(position * GRID_COLS)));
    const hit: GestureTermHit = {
      sample,
      col,
      cycleIndex: quantized.cycleIndex,
      offsetMs: quantized.offsetMs,
      tsMs,
    };
    // The recording stops when the target length is reached — the box is
    // complete and the user decides what to do with it («готово» / «очистить»).
    setGestureTermHits((hits) => {
      if (hits.length >= gestureTermTarget()) return hits;
      return [...hits, hit];
    });
  };

  // ── events ────────────────────────────────────────────────────────────────

  const emitDiscrete = (gesture: GestureName, tsMs: number): void => {
    const now = performance.now();
    // The detector AND the mapping can report the same gesture for one
    // frame — collapse them into a single event.
    if (lastDiscreteGesture === gesture && now - lastDiscreteAtMs < DISCRETE_DEDUPE_MS) {
      return;
    }
    lastDiscreteGesture = gesture;
    lastDiscreteAtMs = now;

    setGestureActive(gesture);
    if (gesture === 'pinch') {
      triggerHaptic(PINCH_HAPTIC_MS);
    }
    // Every rhythmic gesture writes into the term box (the mapping lives in
    // `domain/gesture/term`). Outside term mode only the щипок keeps its
    // percussive preview — the rest stay silent until the box is armed.
    if (gesture === 'pinch' || gestureTermMode()) {
      if (termSampleForGesture(gesture) !== null) {
        void scheduleQuantizedHit(gesture, tsMs);
      }
    }
    opts.onControlEvent?.({ kind: 'discrete', gesture, tsMs });
  };

  /**
   * Apply the user's calibration to the `closeness` feature.
   *
   * `computeFeatures` reports `closeness = 1 / palmSize` (bigger = farther).
   * The domain mapping normalises that with the fixed `CLOSENESS_RANGE`
   * (4 .. 20, i.e. palmSize 0.25 .. 0.05). With a calibration the user tells
   * us which apparent sizes are "close" and "far" for THEIR camera, so the
   * calibrated closeness (1 = close) is mapped onto the SAME 4 .. 20 window —
   * the direction and the meaning of the feature stay untouched, only the
   * useful range changes.
   *
   * Without a calibration the raw feature is kept, so the default behaviour
   * is exactly the domain's.
   */
  const withCalibration = (features: GestureFeatures): GestureFeatures => {
    if (!gestureIsCalibrated()) return features;
    const closeness01 = normalizePalmSize(features.palmSize, gestureCalibration());
    const span = CLOSENESS_RANGE.max - CLOSENESS_RANGE.min;
    return {
      ...features,
      closeness: CLOSENESS_RANGE.max - closeness01 * span,
    };
  };

  const handleFrame = (frame: HandFrame): void => {
    lastFrameAtMs = performance.now();
    setGestureLandmarks(frame.landmarks);

    const raw = withCalibration(computeFeatures(frame));

    if (smoother === null) smoother = new FeatureSmoother(gestureSensitivity());
    const smooth = smoother.apply(raw);
    setGestureFeatures(smooth);

    if (gestureStatus() === 'no-hand') setGestureStatus('running');

    // Discrete gestures (detector: hysteresis + hold window).
    if (detector !== null) {
      const gesture = detector.update(smooth);
      if (gesture !== null) emitDiscrete(gesture, smooth.tsMs);
    }

    // Continuous axes (+ the mapping's own discrete events, if any).
    const events = mapFeaturesToControls(smooth, toDomainAxes(gestureAxes()));
    for (const event of events) {
      if (event.kind === 'continuous') {
        applyContinuous(event.param, event.value);
      } else {
        emitDiscrete(event.gesture, event.tsMs);
      }
    }
  };

  const statusFromCapture = (status: GestureCaptureStatus): GestureStatus => {
    const raw = typeof status === 'string' ? status.toLowerCase() : '';
    if (raw.includes('error')) return 'error';
    if (raw.includes('start')) return 'starting';
    if (raw.includes('run')) return 'running';
    return 'idle';
  };

  const handleCaptureStatus = (status: GestureCaptureStatus): void => {
    const next = statusFromCapture(status);
    if (next === 'idle') return;
    setGestureStatus(next);
  };

  const handleCaptureError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    setGestureError(message);
    setGestureStatus('error');
    setGestureEnabled(false);
  };

  // ── watchdog ──────────────────────────────────────────────────────────────

  const startWatchdog = (): void => {
    if (watchdog !== null) return;
    watchdog = setInterval(() => {
      if (capture === null) return;
      if (performance.now() - lastFrameAtMs > HAND_LOST_MS) {
        if (gestureStatus() === 'running') setGestureStatus('no-hand');
      }
    }, WATCHDOG_INTERVAL_MS);
  };

  const stopWatchdog = (): void => {
    if (watchdog === null) return;
    clearInterval(watchdog);
    watchdog = null;
  };

  // ── lifecycle ─────────────────────────────────────────────────────────────

  const enable = async (): Promise<void> => {
    if (capture !== null) return;
    setGestureStatus('starting');
    setGestureError(null);
    try {
      const handle = await startGestureCapture({
        onFrame: handleFrame,
        onStatus: handleCaptureStatus,
        onError: handleCaptureError,
        twoHands: gestureTwoHands(),
        videoElement: gestureVideoElement(),
      });
      capture = handle;
      detector = new GestureDetector(opts.detectorOptions ?? {});
      smoother = new FeatureSmoother(gestureSensitivity());
      lastFrameAtMs = performance.now();
      setGestureEnabled(true);
      setGestureStatus('running');
      startWatchdog();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.push(
        'warn',
        ['[wavecode/gestureStore] camera start failed:', message],
        'gestureStore.enable',
      );
      setGestureError(message);
      setGestureStatus('error');
      setGestureEnabled(false);
    }
  };

  const disable = (): void => {
    stopWatchdog();
    if (capture !== null) {
      try {
        capture.stop();
      } catch (error) {
        logger.push(
          'warn',
          ['[wavecode/gestureStore] capture stop failed:', String(error)],
          'gestureStore.disable',
        );
      }
      capture = null;
    }
    if (detector !== null) {
      detector.reset();
      detector = null;
    }
    if (smoother !== null) {
      smoother.reset();
      smoother = null;
    }
    lastDiscreteGesture = null;
    setGestureFeatures(null);
    setGestureLandmarks(null);
    setGestureActive(null);
    setGestureEnabled(false);
    setGestureStatus('idle');
    // Safety: never leave the master gain where the hand left it.
    resetLiveParams();
  };

  const toggle = async (): Promise<void> => {
    if (capture !== null) {
      disable();
      return;
    }
    await enable();
  };

  const dispose = (): void => {
    disable();
  };

  return { enable, disable, toggle, resetLiveParams, dispose };
};

// ── controller registry ──────────────────────────────────────────────────────

let activeController: GestureController | null = null;

/**
 * Install the gesture controller.
 *
 * WIRES the pipeline only — the camera stays OFF until the user flips the
 * «Управление руками» toggle. Calling it twice replaces the previous
 * controller (disposing the old one, which stops any running capture).
 */
export const installGestureController = (
  opts: GestureControllerOptions = {},
): GestureController => {
  activeController?.dispose();
  activeController = createController(opts);
  return activeController;
};

/** The currently installed controller (null when nothing is installed). */
export const getGestureController = (): GestureController | null => activeController;

/** Install a controller only if none is installed yet. */
export const ensureGestureController = (): GestureController => {
  if (activeController !== null) return activeController;
  return installGestureController();
};

// ── public actions ───────────────────────────────────────────────────────────

/** Start the camera (from a user gesture). */
export const enableGestureControl = async (): Promise<void> => {
  await ensureGestureController().enable();
};

/** Stop the camera and reset the live params. */
export const disableGestureControl = (): void => {
  activeController?.disable();
};

/** Toggle the camera on/off. */
export const toggleGestureControl = async (): Promise<void> => {
  await ensureGestureController().toggle();
};

/** Push the live params back to neutral (gain → 1). */
export const resetGestureLiveParams = (): void => {
  activeController?.resetLiveParams();
};

// ── axis configuration ───────────────────────────────────────────────────────

/**
 * Bind a row to a parameter (`null` = off).
 *
 * A parameter can only be driven once: when the requested parameter is
 * already used by another row, the two rows SWAP (the parameter keeps its
 * own inversion and curve, the row keeps its position).
 */
export const setGestureAxisParam = (
  index: number,
  param: ContinuousParam | null,
): void => {
  setGestureAxes((axes) => {
    const current = axes[index];
    if (current === undefined) return axes;
    if (param === null) {
      return axes.map((axis, i) => (i === index ? { ...axis, param: null } : axis));
    }
    const clashIndex = axes.findIndex((axis, i) => i !== index && axis.param === param);
    if (clashIndex < 0) {
      return axes.map((axis, i) =>
        i === index
          ? { param, invert: DEFAULT_INVERT[param], curve: 'linear' }
          : axis,
      );
    }
    const clash = axes[clashIndex];
    if (clash === undefined) return axes;
    // Swap the two rows entirely — the parameter carries its settings.
    return axes.map((axis, i) => {
      if (i === index) return { ...clash, param };
      if (i === clashIndex) return current;
      return axis;
    });
  });
};

/** Invert an axis. */
export const setGestureAxisInvert = (index: number, invert: boolean): void => {
  setGestureAxes((axes) =>
    axes.map((axis, i) => (i === index ? { ...axis, invert } : axis)),
  );
};

/** Change the response curve of an axis. */
export const setGestureAxisCurve = (index: number, curve: GestureCurve): void => {
  setGestureAxes((axes) =>
    axes.map((axis, i) => (i === index ? { ...axis, curve } : axis)),
  );
};

/** Restore the default axis configuration. */
export const resetGestureAxes = (): void => {
  setGestureAxes(DEFAULT_AXES);
};

/**
 * Convert the presentation axis configuration into the domain mapping shape.
 *
 * Only rows bound to a parameter are mapped (an unbound row produces no
 * control event at all).
 */
const toDomainAxes = (
  axes: ReadonlyArray<GestureAxisConfig>,
): ReadonlyArray<AxisMapping> => {
  const hasParam = (
    axis: GestureAxisConfig,
  ): axis is GestureAxisConfig & { readonly param: ContinuousParam } => axis.param !== null;
  return axes.filter(hasParam).map((axis) => ({
    param: axis.param,
    invert: axis.invert,
    curve: axis.curve,
  }));
};

// ── sensitivity ──────────────────────────────────────────────────────────────

/** Set the 1 € filter `minCutoffHz` (0.5 .. 3 Hz). */
export const setGestureSensitivity = (value: number): void => {
  if (!Number.isFinite(value)) return;
  const clamped = Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, value));
  setGestureSensitivitySignal(clamped);
};

// ── calibration ──────────────────────────────────────────────────────────────

/** Remember the current hand size as the CLOSE sample. */
export const calibrateNear = (): void => {
  const features = gestureFeatures();
  if (features === null) return;
  const state = gestureCalibrationState();
  setGestureCalibrationState({ ...state, nearSample: features.palmSize });
  applyCalibrationSamples(features.palmSize, state.farSample);
};

/** Remember the current hand size as the FAR sample. */
export const calibrateFar = (): void => {
  const features = gestureFeatures();
  if (features === null) return;
  const state = gestureCalibrationState();
  setGestureCalibrationState({ ...state, farSample: features.palmSize });
  applyCalibrationSamples(state.nearSample, features.palmSize);
};

/** Drop the calibration and fall back to the default scale. */
export const resetCalibration = (): void => {
  setGestureCalibrationState({ nearSample: null, farSample: null, calibrated: false });
  setGestureCalibration(defaultCalibration());
};

const applyCalibrationSamples = (
  nearSample: number | null,
  farSample: number | null,
): void => {
  if (nearSample === null || farSample === null) return;
  const next = calibrationFromSamples(nearSample, farSample);
  if (next === null) {
    // The user mixed up «близко» / «далеко» — keep the old scale.
    setGestureCalibrationState((state) => ({ ...state, calibrated: false }));
    return;
  }
  setGestureCalibration(next);
  setGestureCalibrationState((state) => ({ ...state, calibrated: true }));
};

// ── term mode ────────────────────────────────────────────────────────────────

/** Toggle «режим терминовки». */
export const setGestureTermMode = (enabled: boolean): void => {
  setGestureTermModeSignal(enabled);
  if (!enabled) setGestureTermHits([]);
};

/**
 * Choose the target length of the recording — the number of hits the user
 * intends to play (4 / 8 / 16). Values outside the offered set fall back to
 * the default.
 */
export const setGestureTermTarget = (target: number): void => {
  setGestureTermTargetSignal(isTermTarget(target) ? target : TERM_TARGET_DEFAULT);
};

/** Drop the collected hits without committing them. */
export const clearGestureTermHits = (): void => {
  setGestureTermHits([]);
};

/** Build the 4×8 grid from the collected hits (see `domain/gesture/term`). */
export const buildTermGrid = (
  hits: ReadonlyArray<GestureTermHit>,
): Grid => buildTermGridFromHits(hits);

/**
 * Play the recorded rhythm back — one cycle of the collected grid.
 *
 * Every active cell of the 4×8 grid sounds at its own position in the
 * cycle, so the user hears exactly what «готово» will write into the score.
 *
 * @returns `false` when there is nothing recorded yet.
 */
export const previewTermPattern = (): boolean => {
  const hits = gestureTermHits();
  if (hits.length === 0) return false;
  const grid = buildTermGridFromHits(hits);
  const cycleMs = 1000 / Math.max(0.01, cps());
  for (let row = 0; row < GRID_ROWS.length; row += 1) {
    const sample = GRID_ROWS[row];
    if (sample === undefined) continue;
    const cells = grid[row] ?? [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (cells[col] !== true) continue;
      const delayMs = (col / GRID_COLS) * cycleMs;
      setTimeout(() => {
        previewSample(sample);
      }, delayMs);
    }
  }
  return true;
};

/**
 * Commit the collected rhythm into the score.
 *
 * The pattern REPLACES the four `s("…")` drum rows of the current top-level
 * `stack(...)` (edit-grid semantics — see `editGridLayer`); when the score is
 * not a 4-layer stack the pattern is APPENDED as a new layer instead (the
 * sketch semantics — see `appendGridToScore`). Either way the new score is
 * dispatched to the editor and hot-swapped into the live scheduler through
 * the existing `scheduleGridEdit` path (50 ms debounce).
 *
 * Returns `false` when there is nothing to commit.
 */
export const commitTermPattern = (): boolean => {
  const hits = gestureTermHits();
  if (hits.length === 0) return false;
  const grid = buildTermGrid(hits);
  const score = appStore.score;
  const inPlace = editGridLayer(score, grid);
  const next = inPlace ?? appendGridToScore(score, grid);
  dispatch({ type: 'replaceScore', text: next });
  scheduleGridEdit(next, appStore.layerMix);
  setGestureTermHits([]);
  return true;
};

// ── derived helpers for the panel ────────────────────────────────────────────

/** Human-readable status label (Russian, matches the app's UI language). */
export const gestureStatusLabel = (): string => {
  switch (gestureStatus()) {
    case 'idle':
      return 'выключено';
    case 'starting':
      return 'запуск…';
    case 'running':
      return 'рука в кадре';
    case 'no-hand':
      return 'рука потеряна';
    case 'error':
      return 'ошибка';
  }
};

/** Is the current calibration pair usable? */
export const gestureIsCalibrated = (): boolean =>
  isCalibrated(gestureCalibration());
