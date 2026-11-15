/**
 * Discrete gesture recognition: rules + hysteresis + hold.
 *
 * Every gesture has an *enter* threshold (when the gesture starts) and an
 * *exit* threshold (when the gesture is released). While the gesture is held,
 * the exit threshold is used, so the score has to fall clearly below the enter
 * threshold before the gesture can fire again — that is the hysteresis that
 * keeps a wavering hand from machine-gunning the detector.
 *
 * On top of that a gesture must satisfy its condition for `holdFrames`
 * consecutive frames (default 3) before it is emitted, and two emissions of
 * the same gesture must be at least `minHoldMs` apart (default 200 ms).
 *
 * At most one gesture is emitted per `update()` call — the winner is the
 * first one in the priority order that passes the min-hold gate.
 */

import type { GestureFeatures, GestureName } from './types';

export type GestureThreshold = {
  /** Score at which the gesture starts. */
  readonly enter: number;
  /** Score at which the gesture is released (below this the gesture ends). */
  readonly exit: number;
};

export type GestureDetectorOptions = {
  /** Consecutive frames the condition must hold before the gesture fires. */
  readonly holdFrames?: number;
  /** Minimum time between two emissions of the same gesture, in ms. */
  readonly minHoldMs?: number;
  /** Per-gesture threshold overrides. */
  readonly thresholds?: Partial<Record<GestureName, GestureThreshold>>;
};

/** Default number of frames the condition has to hold. */
export const DEFAULT_HOLD_FRAMES = 3;

/** Default minimum time between two emissions of the same gesture, in ms. */
export const DEFAULT_MIN_HOLD_MS = 200;

/**
 * Default thresholds.
 *
 * - `pinch`   — pinch score, 0..1. Enter at 0.75, release below 0.55.
 * - `openPalm` — openness, 0..1. Enter at 0.80, release below 0.60.
 * - `fist`    — openness, 0..1, but the comparison is inverted: the gesture
 *                is entered while openness is *at or below* 0.20 and released
 *                as soon as openness climbs above 0.40. The numbers are on the
 *                openness scale on purpose, so the table reads like the
 *                design doc ("fist: openness < 0.2").
 * - `pointUp` — driven purely by the `raised` flags, so the numeric
 *                thresholds are unused (kept at 1/1 so the record is total).
 * - `snap`    — `enter` is the minimum openness drop per frame (0.8) that
 *                counts as a snap, `exit` is the openness level the hand has
 *                to be above before the drop (0.6).
 */
export const DEFAULT_GESTURE_THRESHOLDS: Readonly<Record<GestureName, GestureThreshold>> = {
  pinch: { enter: 0.75, exit: 0.55 },
  openPalm: { enter: 0.8, exit: 0.6 },
  fist: { enter: 0.2, exit: 0.4 },
  pointUp: { enter: 1, exit: 1 },
  snap: { enter: 0.8, exit: 0.6 },
};

/**
 * Emission priority — the first gesture in this list that is ready wins.
 *
 * `pinch` and `snap` come first because they are the deliberate, fast
 * gestures; `pointUp` before `fist` because a pointing hand is more specific
 * than a closed one; `openPalm` last because it is the resting state.
 */
const PRIORITY: readonly GestureName[] = ['pinch', 'snap', 'pointUp', 'fist', 'openPalm'];

type GestureState = {
  /** True while the gesture is held (its condition is satisfied). */
  in: boolean;
  /** Consecutive frames the condition has held. */
  hold: number;
  /** Timestamp of the last emission of this gesture. */
  lastEmitMs: number | undefined;
};

const newState = (): GestureState => ({ in: false, hold: 0, lastEmitMs: undefined });

export class GestureDetector {
  private readonly holdFrames: number;
  private readonly minHoldMs: number;
  private readonly thresholds: Record<GestureName, GestureThreshold>;
  private readonly states: Record<GestureName, GestureState>;

  /** Openness of the previous frame — the snap detector needs the delta. */
  private prevOpenness: number | undefined = undefined;
  /** Remaining frames the snap condition stays true after an impulse. */
  private snapLatch = 0;

  constructor(opts?: GestureDetectorOptions) {
    this.holdFrames = Math.max(1, Math.floor(opts?.holdFrames ?? DEFAULT_HOLD_FRAMES));
    this.minHoldMs = Math.max(0, opts?.minHoldMs ?? DEFAULT_MIN_HOLD_MS);

    const custom = opts?.thresholds;
    this.thresholds = {
      pinch: custom?.pinch ?? DEFAULT_GESTURE_THRESHOLDS.pinch,
      openPalm: custom?.openPalm ?? DEFAULT_GESTURE_THRESHOLDS.openPalm,
      fist: custom?.fist ?? DEFAULT_GESTURE_THRESHOLDS.fist,
      pointUp: custom?.pointUp ?? DEFAULT_GESTURE_THRESHOLDS.pointUp,
      snap: custom?.snap ?? DEFAULT_GESTURE_THRESHOLDS.snap,
    };

    this.states = {
      pinch: newState(),
      openPalm: newState(),
      fist: newState(),
      pointUp: newState(),
      snap: newState(),
    };
  }

  /**
   * Feed one frame of features.
   *
   * @returns the emitted gesture, or `null` when nothing fired.
   */
  update(features: GestureFeatures): GestureName | null {
    const conditions = this.evaluate(features);

    for (const name of PRIORITY) {
      this.advance(name, conditions[name]);
    }

    // The gestures whose condition held long enough, in priority order.
    const candidates = PRIORITY.filter((name) => {
      const state = this.states[name];
      return !state.in && state.hold >= this.holdFrames;
    });
    const winner = candidates[0];
    if (winner === undefined) return null;

    const state = this.states[winner];
    const last = state.lastEmitMs;
    if (last !== undefined && features.tsMs - last < this.minHoldMs) {
      // Too soon after the previous emission of this gesture. The gesture
      // stays armed and is emitted as soon as the window has passed, so the
      // event is delayed instead of being dropped. A lower-priority gesture
      // does not jump the queue while the winner waits.
      return null;
    }

    // The winner fires; the other candidates lost the contest and are
    // resolved, so they do not fire a frame later.
    for (const name of candidates) {
      this.states[name].in = true;
    }
    state.lastEmitMs = features.tsMs;
    return winner;
  }

  /** Forget every gesture state (used when tracking is lost or restarted). */
  reset(): void {
    for (const name of PRIORITY) {
      this.states[name] = newState();
    }
    this.prevOpenness = undefined;
    this.snapLatch = 0;
  }

  /**
   * Per-gesture condition for this frame.
   *
   * `openPalm` deserves a note: the literal rule "openness high and no
   * finger raised except the thumb" cannot be satisfied together with
   * `raised[i] = extension ratio >= 0.7`. `openness` is the mean of the four
   * extension ratios, so `openness >= 0.8` forces the mean ratio to be at
   * least 0.8, while "no finger raised" forces every ratio below 0.7 — the
   * two conditions contradict each other and the gesture could never fire.
   *
   * The implemented rule is the satisfiable equivalent of the same intent:
   * an open palm is a hand whose four fingers are extended (raised) and which
   * is not pinching (the pinch gesture has its own, higher priority).
   */
  private evaluate(features: GestureFeatures): Record<GestureName, boolean> {
    const pinchThreshold = this.states.pinch.in
      ? this.thresholds.pinch.exit
      : this.thresholds.pinch.enter;
    const pinch = features.pinch >= pinchThreshold;

    const openThreshold = this.states.openPalm.in
      ? this.thresholds.openPalm.exit
      : this.thresholds.openPalm.enter;
    const fingersExtended =
      features.raised[1] === true &&
      features.raised[2] === true &&
      features.raised[3] === true &&
      features.raised[4] === true;
    const openPalm =
      features.openness >= openThreshold &&
      fingersExtended &&
      features.pinch < this.thresholds.pinch.enter;

    // The fist is the one gesture where a *low* score means "yes".
    const fistThreshold = this.states.fist.in
      ? this.thresholds.fist.exit
      : this.thresholds.fist.enter;
    const fist = features.openness <= fistThreshold;

    const pointUp =
      features.raised[1] === true &&
      features.raised[2] !== true &&
      features.raised[3] !== true &&
      features.raised[4] !== true;

    // The snap is an impulse: the openness has to drop fast while the hand
    // was open. The condition is latched for `holdFrames` frames so it can
    // pass through the very same hold machinery as the other gestures (a
    // one-frame impulse could never reach `holdFrames` on its own).
    const snapThreshold = this.thresholds.snap;
    const previous = this.prevOpenness;
    let snap = false;
    if (previous !== undefined && previous > snapThreshold.exit && previous - features.openness >= snapThreshold.enter) {
      this.snapLatch = this.holdFrames;
    }
    if (this.snapLatch > 0) {
      this.snapLatch -= 1;
      snap = true;
    }
    this.prevOpenness = features.openness;

    return { pinch, openPalm, fist, pointUp, snap };
  }

  /**
   * Advance the hold counter of one gesture.
   *
   * The gesture becomes a candidate as soon as the condition held for
   * `holdFrames` consecutive frames; the emission itself is decided by
   * `update()` (priority and the min-hold gate).
   */
  private advance(name: GestureName, satisfied: boolean): void {
    const state = this.states[name];

    if (!satisfied) {
      state.hold = 0;
      state.in = false;
      return;
    }

    if (state.in) {
      // Already fired and still held — no second event.
      return;
    }

    state.hold = Math.min(state.hold + 1, this.holdFrames);
  }
}
