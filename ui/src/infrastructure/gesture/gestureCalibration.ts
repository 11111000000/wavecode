/**
 * gestureCalibration — near/far calibration for the camera hand-gesture
 * feature.
 *
 * WHY THIS EXISTS
 * ---------------
 * MediaPipe does not give an absolute depth: `worldLandmarks` are the hand
 * geometry in metres relative to the palm centre and `z` is measured from the
 * wrist. The only depth proxy that survives perspective noise is the
 * APPARENT SIZE of the hand in the frame — `palmSize` (the wrist → middle-MCP
 * distance in normalised frame units). A hand close to the camera covers more
 * pixels than a hand far away, so `palmSize` is a monotonic proxy for distance.
 *
 * The absolute value of `palmSize` depends on the camera, the FOV and the
 * user's arm length, so we cannot hard-code a threshold that works for
 * everybody. The user calibrates once: they show their hand CLOSE (we store
 * that `palmSize` as `near`) and FAR (we store it as `far`). Everything in
 * between is mapped to a normalised 0..1 "closeness" with a smoothstep curve
 * (soft at both ends, steep in the middle — the curve the design doc asks
 * for in §3.5).
 *
 * LAYER RULES
 * ------------
 * This module lives in `infrastructure/` and is deliberately dependency-free:
 * no DOM, no storage, no framework. Persistence (IndexedDB) is NOT done here
 * — `idb-keyval` is banned in `presentation/` and a calibration store does not
 * belong in the audio/camera infrastructure either. For this phase the
 * calibration is kept in-memory by `presentation/state/gestureStore.ts`.
 * FOLLOW-UP: persist the calibration pair through the `Repo` service
 * (`domain/services.ts`) so it survives a reload.
 */

/**
 * Near/far calibration pair.
 *
 * `nearPalmSize` — the `palmSize` the user showed while holding their hand
 * CLOSE to the camera. Because a close hand covers more of the frame, this is
 * the LARGER of the two numbers.
 *
 * `farPalmSize` — the `palmSize` the user showed while holding their hand
 * FAR from the camera. The SMALLER of the two.
 */
export type GestureCalibration = {
  readonly nearPalmSize: number;
  readonly farPalmSize: number;
};

/**
 * Fallback calibration used before the user calibrates (and whenever the
 * stored pair is unusable).
 *
 * The numbers are a rough average for a 640×480 webcam frame with a hand at
 * arm's length; they only need to give a usable, monotonic 0..1 signal until
 * the real calibration arrives.
 */
export const DEFAULT_CALIBRATION: GestureCalibration = {
  nearPalmSize: 0.18,
  farPalmSize: 0.06,
};

/** Fresh copy of the default calibration (never mutate the shared object). */
export const defaultCalibration = (): GestureCalibration => ({
  nearPalmSize: DEFAULT_CALIBRATION.nearPalmSize,
  farPalmSize: DEFAULT_CALIBRATION.farPalmSize,
});

/** Clamp to 0..1; non-finite input collapses to 0. */
export const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

/**
 * Classic smoothstep `3t² − 2t³` on the clamped input.
 *
 * Used for the far→near interpolation: the ends of the range stay flat (a
 * hand held very close does not keep pushing the parameter) and the middle
 * is steep (the interesting range of the gesture).
 */
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Is this a usable calibration pair?
 *
 * Requirements: both numbers finite, `far > 0` (a zero-size hand would make
 * the normalisation explode) and `near > far` (a close hand MUST look bigger
 * than a far one — if the user mixed up the buttons, the pair is rejected
 * instead of inverting the control).
 */
export const isCalibrated = (
  calibration: GestureCalibration | null | undefined,
): calibration is GestureCalibration => {
  if (calibration === null || calibration === undefined) return false;
  const { nearPalmSize, farPalmSize } = calibration;
  if (!Number.isFinite(nearPalmSize) || !Number.isFinite(farPalmSize)) return false;
  if (farPalmSize <= 0) return false;
  return nearPalmSize > farPalmSize;
};

/**
 * Build a calibration from the two raw samples the user showed.
 *
 * Returns `null` when the pair is unusable (see `isCalibrated`) — the caller
 * keeps the previous calibration and reports the problem to the user instead
 * of installing a broken scale.
 */
export const calibrationFromSamples = (
  nearPalmSize: number,
  farPalmSize: number,
): GestureCalibration | null => {
  const candidate: GestureCalibration = { nearPalmSize, farPalmSize };
  if (!isCalibrated(candidate)) return null;
  return candidate;
};

/**
 * Map a raw `palmSize` to a normalised closeness in 0..1.
 *
 *   - `palmSize <= far` → 0 (hand at the far end / barely visible)
 *   - `palmSize >= near` → 1 (hand right in front of the lens)
 *   - in between → smoothstep
 *
 * When the calibration is missing or invalid the DEFAULT pair is used, so the
 * feature still works (just with the rough scale) before calibration.
 */
export const normalizePalmSize = (
  palmSize: number,
  calibration?: GestureCalibration | null,
): number => {
  const cal = isCalibrated(calibration) ? calibration : DEFAULT_CALIBRATION;
  if (!Number.isFinite(palmSize) || palmSize <= 0) return 0;
  const span = cal.nearPalmSize - cal.farPalmSize;
  const t = (palmSize - cal.farPalmSize) / span;
  return smoothstep(t);
};
