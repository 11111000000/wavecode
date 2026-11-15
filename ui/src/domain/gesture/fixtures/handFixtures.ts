/**
 * SYNTHETIC hand fixtures.
 *
 * ⚠️ These are **synthetic** landmarks, hand-built from a canonical template.
 * No real capture is available in the repo yet (there is no camera code in
 * wavecode at all), so the fixtures were drawn to exercise the *contract* of
 * the feature extractor: an open hand, a fist, a pinch and a pointing hand.
 *
 * They must be replaced by frames captured from a real MediaPipe session
 * (see `docs/hand-gesture-control-design.md` §7) as soon as such a capture
 * exists — the synthetic geometry is plausible, not measured.
 *
 * Geometry of the canonical hand (image coordinates, y grows downwards):
 *
 * - the palm spans wrist (0.50, 0.90) to the middle MCP (0.50, 0.70), so
 *   `palmSize = 0.2` and `closeness = 5`;
 * - extended fingers point up, the ratio |tip - pip| / |mcp - pip| is ~1.3
 *   (clamped to 1);
 * - a curled finger folds its tip back onto the PIP joint, so the ratio drops
 *   to ~0.15 — that is what makes a fist read as "closed" for the openness
 *   metric;
 * - the world landmarks are the same points, centred on the palm and scaled
 *   to metres (a real palm is ~0.09 m long).
 */

import type { HandFrame, Handedness, Landmark } from '../types';

/** |P9 - P0| of the canonical hand, in normalised image units. */
const BASE_PALM_SIZE = 0.2;

/** Real length of a palm, in metres — used to scale the world landmarks. */
const PALM_SIZE_METERS = 0.09;

/** Metres per normalised image unit. */
const WORLD_SCALE = PALM_SIZE_METERS / BASE_PALM_SIZE;

/** Landmark indices of the palm joints: wrist + the four MCP knuckles. */
const PALM_INDICES: readonly number[] = [0, 5, 9, 13, 17];

/**
 * The canonical hand: an open, upright right hand.
 * Index map: 0 wrist, 1..4 thumb, 5..8 index, 9..12 middle, 13..16 ring,
 * 17..20 pinky.
 */
const CANONICAL: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.9], // 0  wrist
  [0.4, 0.855], // 1  thumb CMC
  [0.34, 0.82], // 2  thumb MCP
  [0.285, 0.755], // 3  thumb IP
  [0.23, 0.69], // 4  thumb TIP (abducted, out of the palm)
  [0.44, 0.72], // 5  index MCP
  [0.44, 0.65], // 6  index PIP
  [0.435, 0.6], // 7  index DIP
  [0.43, 0.56], // 8  index TIP
  [0.5, 0.7], // 9  middle MCP
  [0.5, 0.62], // 10 middle PIP
  [0.5, 0.565], // 11 middle DIP
  [0.5, 0.52], // 12 middle TIP
  [0.56, 0.71], // 13 ring MCP
  [0.565, 0.635], // 14 ring PIP
  [0.57, 0.585], // 15 ring DIP
  [0.575, 0.545], // 16 ring TIP
  [0.62, 0.74], // 17 pinky MCP
  [0.635, 0.675], // 18 pinky PIP
  [0.645, 0.635], // 19 pinky DIP
  [0.65, 0.605], // 20 pinky TIP
];

/** Curled fingers (index excluded): the tip folds back onto the PIP joint. */
const CURL_OVERRIDES: Readonly<Record<number, readonly [number, number]>> = {
  11: [0.508, 0.66],
  12: [0.505, 0.628],
  15: [0.573, 0.672],
  16: [0.57, 0.643],
  19: [0.643, 0.708],
  20: [0.64, 0.682],
};

/** The index finger curled as well — that plus the tucked thumb makes a fist. */
const CURLLED_INDEX_OVERRIDES: Readonly<Record<number, readonly [number, number]>> = {
  7: [0.455, 0.69],
  8: [0.45, 0.655],
};

/** A tucked thumb, folded across the palm. */
const TUCKED_THUMB_OVERRIDES: Readonly<Record<number, readonly [number, number]>> = {
  3: [0.35, 0.845],
  4: [0.38, 0.855],
};

/** A pinching thumb: the tip touches the index tip (landmark 8). */
const PINCH_OVERRIDES: Readonly<Record<number, readonly [number, number]>> = {
  3: [0.39, 0.69],
  4: [0.43, 0.56],
};

const toPoints = (source: ReadonlyArray<readonly [number, number]>): ReadonlyArray<Landmark> =>
  source.map(([x, y]) => ({ x, y, z: 0 }));

const applyOverrides = (
  base: ReadonlyArray<Landmark>,
  overrides: Readonly<Record<number, readonly [number, number]>>,
): ReadonlyArray<Landmark> =>
  base.map((point, index) => {
    const override = overrides[index];
    return override ? { x: override[0], y: override[1], z: point.z } : point;
  });

/** Mean of the palm joints — the anchor of the world landmarks. */
export const palmCenterOf = (points: ReadonlyArray<Landmark>): { readonly x: number; readonly y: number } => {
  let x = 0;
  let y = 0;
  for (const index of PALM_INDICES) {
    const point = points[index] ?? { x: 0, y: 0, z: 0 };
    x += point.x;
    y += point.y;
  }
  return { x: x / PALM_INDICES.length, y: y / PALM_INDICES.length };
};

/** Scale every point around the wrist — used to test scale invariance. */
export const scaleAboutWrist = (points: ReadonlyArray<Landmark>, factor: number): ReadonlyArray<Landmark> => {
  const wrist = points[0] ?? { x: 0, y: 0, z: 0 };
  return points.map((point) => ({
    x: wrist.x + (point.x - wrist.x) * factor,
    y: wrist.y + (point.y - wrist.y) * factor,
    z: wrist.z * factor,
  }));
};

/** Translate / scale / rotate a set of landmarks around the palm centre. */
export const transformHand = (
  points: ReadonlyArray<Landmark>,
  transform: {
    readonly translateX?: number;
    readonly translateY?: number;
    readonly scale?: number;
    readonly rotateDeg?: number;
  },
): ReadonlyArray<Landmark> => {
  const center = palmCenterOf(points);
  const scale = transform.scale ?? 1;
  const radians = ((transform.rotateDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return points.map((point) => {
    const dx = (point.x - center.x) * scale;
    const dy = (point.y - center.y) * scale;
    return {
      x: dx * cos - dy * sin + center.x + (transform.translateX ?? 0),
      y: dx * sin + dy * cos + center.y + (transform.translateY ?? 0),
      z: point.z * scale,
    };
  });
};

/** An open, upright hand — the canonical template. */
export const openHand = (): ReadonlyArray<Landmark> => toPoints(CANONICAL);

/** A closed fist: every fingertip is folded back onto its PIP joint. */
export const fistHand = (): ReadonlyArray<Landmark> =>
  applyOverrides(
    applyOverrides(applyOverrides(toPoints(CANONICAL), CURL_OVERRIDES), CURLLED_INDEX_OVERRIDES),
    TUCKED_THUMB_OVERRIDES,
  );

/** A pinch: the thumb tip touches the index tip, the other fingers stay open. */
export const pinchHand = (): ReadonlyArray<Landmark> => applyOverrides(toPoints(CANONICAL), PINCH_OVERRIDES);

/** A pointing hand: only the index finger is extended. */
export const pointUpHand = (): ReadonlyArray<Landmark> =>
  applyOverrides(toPoints(CANONICAL), CURL_OVERRIDES);

/**
 * The canonical hand placed at (x, y) with the given scale.
 *
 * The scale multiplies the apparent size of the hand, i.e. it moves the hand
 * closer to (scale > 1) or farther from (scale < 1) the camera.
 */
export const handAt = (x: number, y: number, scale = 1): ReadonlyArray<Landmark> => {
  const base = openHand();
  const center = palmCenterOf(base);
  return base.map((point) => ({
    x: (point.x - center.x) * scale + x,
    y: (point.y - center.y) * scale + y,
    z: point.z * scale,
  }));
};

/** World landmarks: the same points, centred on the palm, in metres. */
const toWorldLandmarks = (points: ReadonlyArray<Landmark>): ReadonlyArray<Landmark> => {
  const center = palmCenterOf(points);
  return points.map((point) => ({
    x: (point.x - center.x) * WORLD_SCALE,
    y: (point.y - center.y) * WORLD_SCALE,
    z: point.z * WORLD_SCALE,
  }));
};

/** Wrap a set of landmarks into a `HandFrame`. */
export const toHandFrame = (
  landmarks: ReadonlyArray<Landmark>,
  opts?: { readonly tsMs?: number; readonly handedness?: Handedness },
): HandFrame => ({
  tsMs: opts?.tsMs ?? 0,
  handedness: opts?.handedness ?? 'Right',
  landmarks,
  worldLandmarks: toWorldLandmarks(landmarks),
});

/**
 * A short movement sequence: the hand travels from left to right.
 * Useful for the smoothing and mapping tests.
 */
export const movingHandSequence = (opts?: {
  readonly frames?: number;
  readonly stepMs?: number;
  readonly fromX?: number;
  readonly toX?: number;
  readonly y?: number;
  readonly scale?: number;
}): ReadonlyArray<HandFrame> => {
  const frames = Math.max(1, opts?.frames ?? 10);
  const stepMs = opts?.stepMs ?? 33;
  const fromX = opts?.fromX ?? 0.35;
  const toX = opts?.toX ?? 0.65;
  const y = opts?.y ?? 0.5;
  const scale = opts?.scale ?? 1;

  const result: HandFrame[] = [];
  for (let index = 0; index < frames; index += 1) {
    const progress = frames === 1 ? 0 : index / (frames - 1);
    const x = fromX + (toX - fromX) * progress;
    result.push(toHandFrame(handAt(x, y, scale), { tsMs: index * stepMs }));
  }
  return result;
};

/**
 * A short sequence that starts open and ends in a pinch — the gesture a snap
 * detector has to catch.
 */
export const pinchSequence = (opts?: {
  readonly openFrames?: number;
  readonly pinchFrames?: number;
  readonly stepMs?: number;
}): ReadonlyArray<HandFrame> => {
  const openFrames = opts?.openFrames ?? 3;
  const pinchFrames = opts?.pinchFrames ?? 3;
  const stepMs = opts?.stepMs ?? 33;

  const result: HandFrame[] = [];
  for (let index = 0; index < openFrames; index += 1) {
    result.push(toHandFrame(openHand(), { tsMs: index * stepMs }));
  }
  for (let index = 0; index < pinchFrames; index += 1) {
    result.push(toHandFrame(pinchHand(), { tsMs: (openFrames + index) * stepMs }));
  }
  return result;
};

/**
 * A short sequence that starts open and closes into a fist.
 *
 * The snap detector watches the *openness* drop, so the snap is the open ->
 * fist transition (the fingers snapping shut), not the open -> pinch one.
 */
export const snapSequence = (opts?: {
  readonly openFrames?: number;
  readonly closedFrames?: number;
  readonly stepMs?: number;
}): ReadonlyArray<HandFrame> => {
  const openFrames = opts?.openFrames ?? 3;
  const closedFrames = opts?.closedFrames ?? 4;
  const stepMs = opts?.stepMs ?? 33;

  const result: HandFrame[] = [];
  for (let index = 0; index < openFrames; index += 1) {
    result.push(toHandFrame(openHand(), { tsMs: index * stepMs }));
  }
  for (let index = 0; index < closedFrames; index += 1) {
    result.push(toHandFrame(fistHand(), { tsMs: (openFrames + index) * stepMs }));
  }
  return result;
};
