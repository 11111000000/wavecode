/**
 * Beat quantisation for rhythmic gestures.
 *
 * A gesture arrives late (camera + inference + smoothing cost 70..130 ms), so
 * a rhythmic hit is *scheduled* on the grid instead of being played when it
 * happened.
 *
 * Math (all times in ms):
 *
 *   cycleMs     = 1000 / cps                       — length of one cycle
 *   cycleStart  = nowMs - cycleProgress * cycleMs  — start of the current cycle
 *   stepMs      = cycleMs / division               — length of one subdivision
 *   threshold   = nowMs + lookaheadMs              — the earliest playable time
 *   steps       = ceil((threshold - cycleStart) / stepMs)
 *
 * `steps` counts the subdivisions from the start of the current cycle; the
 * target time is `cycleStart + steps * stepMs`, which is the first grid
 * boundary that is at least `lookaheadMs` in the future. The subdivision
 * index inside the target cycle is `steps % division` and the number of whole
 * cycles to wait is `floor(steps / division)`.
 *
 * `cycleIndex` is therefore relative to the cycle that contains `nowMs`
 * (0 = the current cycle, 1 = the next one, ...). The absolute cycle counter
 * of the transport is not part of the inputs; a caller that knows it adds it.
 */

export type QuantizeArgs = {
  /** Progress inside the current cycle, 0..1. */
  readonly cycleProgress: number;
  /** Cycles per second (tempo). */
  readonly cps: number;
  /** Current wall-clock time, in ms. */
  readonly nowMs: number;
  /** How far ahead the event has to be scheduled, in ms. */
  readonly lookaheadMs: number;
  /** Subdivisions per cycle (4 = quarter notes). */
  readonly division: number;
};

export type QuantizedTime = {
  /** Target cycle, relative to the current one (0 = current cycle). */
  readonly cycleIndex: number;
  /** Offset inside the target cycle, in ms. */
  readonly offsetMs: number;
  /** Absolute scheduled time, in ms. */
  readonly timeMs: number;
};

/** Small epsilon that keeps an exactly-on-the-boundary threshold on it. */
const BOUNDARY_EPSILON = 1e-9;

export const quantizeToCycle = (args: QuantizeArgs): QuantizedTime => {
  const { cps, nowMs, division } = args;

  // Defensive: without a tempo there is no grid to hit.
  if (!Number.isFinite(cps) || cps <= 0 || !Number.isFinite(nowMs)) {
    return { cycleIndex: 0, offsetMs: 0, timeMs: Number.isFinite(nowMs) ? nowMs : 0 };
  }

  const subdivisions = Number.isFinite(division) && division >= 1 ? Math.floor(division) : 1;
  const cycleMs = 1000 / cps;
  const stepMs = cycleMs / subdivisions;

  const rawProgress = Number.isFinite(args.cycleProgress) ? args.cycleProgress : 0;
  // A progress of exactly 1 means the cycle just ended: the next cycle starts
  // now, so the anchor is `nowMs`.
  const progress = rawProgress >= 1 ? 0 : rawProgress < 0 ? 0 : rawProgress;
  const cycleStartMs = nowMs - progress * cycleMs;

  const lookaheadMs = Number.isFinite(args.lookaheadMs) && args.lookaheadMs > 0 ? args.lookaheadMs : 0;
  const thresholdMs = nowMs + lookaheadMs;

  const steps = Math.max(0, Math.ceil((thresholdMs - cycleStartMs) / stepMs - BOUNDARY_EPSILON));
  const cycleIndex = Math.floor(steps / subdivisions);
  const stepInCycle = steps - cycleIndex * subdivisions;

  return {
    cycleIndex,
    offsetMs: stepInCycle * stepMs,
    timeMs: cycleStartMs + steps * stepMs,
  };
};
