/**
 * Features -> normalised control values.
 *
 * `mapFeatureToControl` turns a normalised 0..1 feature into a control value:
 *
 *   1. clamp the feature into 0..1
 *   2. invert it when the axis asks for it
 *   3. collapse the deadzone: values within +/- `deadzone` of the centre
 *      become exactly 0.5 (the neutral position), so micro-movements do not
 *      drag the parameter around
 *   4. apply the response curve
 *   5. scale into [min, max]
 *
 * The curves are symmetric around 0.5, so the centre stays the centre:
 *
 * - `linear` — the identity.
 * - `log`    — resolution is spent at the ends (v = 0.25 -> 0.21).
 * - `exp`    — resolution is spent in the middle (v = 0.25 -> 0.36).
 *
 * `mapFeaturesToControls` knows which feature drives which audio parameter.
 */

import type { ContinuousParam, ControlEvent, GestureFeatures } from './types';

export type AxisMapping = {
  readonly param: ContinuousParam;
  /** Flip the axis (e.g. pitch: up = higher). */
  readonly invert?: boolean;
  /** Lower bound of the control range. Default 0. */
  readonly min?: number;
  /** Upper bound of the control range. Default 1. */
  readonly max?: number;
  /** Response curve. Default `linear`. */
  readonly curve?: 'linear' | 'log' | 'exp';
  /** Half-width of the neutral zone around 0.5, in normalised units. Default 0.02. */
  readonly deadzone?: number;
};

/** Default half-width of the neutral zone around the centre. */
export const DEFAULT_DEADZONE = 0.02;

/**
 * Apparent-size range used to normalise `closeness` into 0..1.
 *
 * `closeness = 1 / palmSize`, so it is not a 0..1 quantity: a hand that fills
 * a tenth of the frame has `palmSize = 0.1` and `closeness = 10`. The range
 * below covers the plausible apparent sizes of a hand in a 640x480 frame
 * (`palmSize` from 0.05 to 0.25, i.e. `closeness` from 20 down to 4).
 */
export const CLOSENESS_RANGE = { min: 4, max: 20 } as const;

/** Normalise `closeness` (1 / palmSize) into 0..1. */
export const normalizeCloseness = (closeness: number): number => {
  if (!Number.isFinite(closeness)) return 0;
  const span = CLOSENESS_RANGE.max - CLOSENESS_RANGE.min;
  const normalized = (closeness - CLOSENESS_RANGE.min) / span;
  return normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
};

/** Normalise the roll angle (-180..180 degrees) into 0..1. */
export const normalizeRoll = (rollDeg: number): number => {
  if (!Number.isFinite(rollDeg)) return 0.5;
  const normalized = (rollDeg + 180) / 360;
  return normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

/**
 * Response curve. All curves map 0..1 onto 0..1 and keep 0.5 -> 0.5.
 */
const applyCurve = (value: number, curve: 'linear' | 'log' | 'exp'): number => {
  if (curve === 'linear') return value;

  // Symmetric coordinate around the centre: -1..1, 0 at the centre.
  const centred = 2 * value - 1;
  const sign = centred < 0 ? -1 : 1;
  const magnitude = Math.abs(centred);

  if (curve === 'log') {
    return clamp01(0.5 + 0.5 * sign * Math.log2(1 + magnitude));
  }

  const k = 2;
  const shaped = (Math.exp(k * magnitude) - 1) / (Math.exp(k) - 1);
  return clamp01(0.5 + 0.5 * sign * shaped);
};

/**
 * Map one normalised feature onto the range of one axis.
 *
 * @param feature normalised value in 0..1 (a non-finite value is treated as
 *   the neutral 0.5)
 * @param axis the axis configuration
 * @returns the control value; with the default `min`/`max` it stays in 0..1
 */
export const mapFeatureToControl = (feature: number, axis: AxisMapping): number => {
  const min = axis.min ?? 0;
  const max = axis.max ?? 1;

  let value = Number.isFinite(feature) ? clamp01(feature) : 0.5;
  if (axis.invert === true) value = 1 - value;

  const deadzone = Math.max(0, axis.deadzone ?? DEFAULT_DEADZONE);
  if (Math.abs(value - 0.5) <= deadzone) value = 0.5;

  value = applyCurve(value, axis.curve ?? 'linear');

  return min + value * (max - min);
};

/** Which feature drives which audio parameter. */
const featureForParam: Record<ContinuousParam, (features: GestureFeatures) => number> = {
  // Higher on screen = higher pitch, so the vertical axis is inverted.
  pitch: (features) => features.palmCenterY,
  volume: (features) => features.openness,
  pan: (features) => features.palmCenterX,
  cutoff: (features) => normalizeCloseness(features.closeness),
  room: (features) => normalizeCloseness(features.closeness),
  speed: (features) => normalizeRoll(features.rollDeg),
};

/** Default axis polarity per parameter (an explicit `invert` always wins). */
const defaultInvert: Record<ContinuousParam, boolean> = {
  pitch: true,
  volume: false,
  pan: false,
  cutoff: false,
  room: false,
  speed: false,
};

/**
 * Map a feature frame onto one continuous control event per configured axis.
 */
export const mapFeaturesToControls = (
  features: GestureFeatures,
  axes: ReadonlyArray<AxisMapping>,
): ControlEvent[] => {
  const events: ControlEvent[] = [];
  for (const axis of axes) {
    const raw = featureForParam[axis.param](features);
    const value = mapFeatureToControl(raw, { ...axis, invert: axis.invert ?? defaultInvert[axis.param] });
    events.push({ kind: 'continuous', param: axis.param, value, tsMs: features.tsMs });
  }
  return events;
};
