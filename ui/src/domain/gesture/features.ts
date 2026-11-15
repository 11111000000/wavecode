/**
 * Hand landmarks -> scale-normalised features.
 *
 * Landmark index map (MediaPipe hand landmarks, 21 points):
 *
 *   0        wrist
 *   1..4     thumb  (CMC, MCP, IP, TIP)
 *   5..8     index  (MCP, PIP, DIP, TIP)
 *   9..12    middle (MCP, PIP, DIP, TIP)
 *   13..16   ring   (MCP, PIP, DIP, TIP)
 *   17..20   pinky  (MCP, PIP, DIP, TIP)
 *
 * Design rules (see `docs/hand-gesture-control-design.md` §3.2):
 *
 * - `palmSize = |P9 - P0|` is the base unit. Every distance that describes a
 *   *pose* is divided by the palm size (or by another length that scales with
 *   it), so the pose features do not depend on the distance to the camera.
 * - `openness` is the mean extension ratio of the four fingers; the thumb is
 *   excluded from it (a thumb has no MCP/PIP chain in the same sense) and is
 *   reported through `raised[0]` only.
 * - `pinch` is 1 when the thumb tip touches the index tip.
 */

import type { GestureFeatures, HandFrame, Landmark } from './types';

/** Fallback point for frames that carry fewer than 21 landmarks. */
const ZERO_LANDMARK: Landmark = { x: 0, y: 0, z: 0 };

/** Guard against a degenerate (zero-length) palm. */
const MIN_PALM_SIZE = 1e-6;

/**
 * Extension ratio below which a finger counts as fully curled: the ratio is
 * collapsed to 0 so a relaxed hand does not read as "half open".
 */
const FINGER_CURL_THRESHOLD = 0.35;

/** Extension ratio at which a finger counts as raised (straight). */
const FINGER_RAISED_THRESHOLD = 0.7;

/** |P4 - P2| / palmSize above which the thumb counts as "out". */
const THUMB_OUT_RATIO = 0.8;

/** The pinch distance is measured against this multiple of the palm size. */
const PINCH_SCALE = 0.6;

/** Finger chains as [mcp, pip, tip] landmark indices. */
const FINGER_CHAINS: ReadonlyArray<readonly [number, number, number]> = [
  [5, 6, 8], // index
  [9, 10, 12], // middle
  [13, 14, 16], // ring
  [17, 18, 20], // pinky
];

/** Palm joints: wrist + the four MCP knuckles. */
const PALM_INDICES: readonly number[] = [0, 5, 9, 13, 17];

const at = (points: ReadonlyArray<Landmark>, index: number): Landmark => points[index] ?? ZERO_LANDMARK;

const distance2d = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y);

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

/**
 * Extension ratio of one finger: |tip - pip| / |mcp - pip|, clamped to 0..1.
 *
 * A straight finger has a ratio above 1 (the tip is two segments away from the
 * PIP joint while the MCP is one segment away), a curled finger has a ratio
 * close to 0 (the tip folds back onto the PIP joint).
 */
const extensionRatio = (points: ReadonlyArray<Landmark>, chain: readonly [number, number, number]): number => {
  const [mcpIndex, pipIndex, tipIndex] = chain;
  const mcp = at(points, mcpIndex);
  const pip = at(points, pipIndex);
  const tip = at(points, tipIndex);
  const denominator = distance2d(mcp, pip);
  if (!Number.isFinite(denominator) || denominator < MIN_PALM_SIZE) return 0;
  return clamp01(distance2d(tip, pip) / denominator);
};

export const computeFeatures = (frame: HandFrame): GestureFeatures => {
  const points = frame.landmarks;

  const wrist = at(points, 0);
  const middleMcp = at(points, 9);

  // Base unit: wrist -> middle MCP. Guarded against a zero-length palm.
  const palmSize = Math.max(distance2d(middleMcp, wrist), MIN_PALM_SIZE);

  // Palm centre: mean of the wrist and the four MCP knuckles.
  let centerX = 0;
  let centerY = 0;
  for (const index of PALM_INDICES) {
    const point = at(points, index);
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= PALM_INDICES.length;
  centerY /= PALM_INDICES.length;

  // Finger extension: raw ratio (for `raised`) and the curled-collapsed ratio
  // (for `openness`).
  const rawRatios = FINGER_CHAINS.map((chain) => extensionRatio(points, chain));
  const opennessRatios = rawRatios.map((ratio) => (ratio < FINGER_CURL_THRESHOLD ? 0 : ratio));
  const openness = opennessRatios.reduce((sum, ratio) => sum + ratio, 0) / opennessRatios.length;

  // Thumb: "out" when the tip is far enough from the thumb MCP. The thumb
  // does not contribute to `openness` (it has no MCP/PIP chain).
  const thumbOut = distance2d(at(points, 4), at(points, 2)) / palmSize > THUMB_OUT_RATIO;

  const raised: readonly boolean[] = [
    thumbOut,
    rawRatios[0] !== undefined && rawRatios[0] >= FINGER_RAISED_THRESHOLD,
    rawRatios[1] !== undefined && rawRatios[1] >= FINGER_RAISED_THRESHOLD,
    rawRatios[2] !== undefined && rawRatios[2] >= FINGER_RAISED_THRESHOLD,
    rawRatios[3] !== undefined && rawRatios[3] >= FINGER_RAISED_THRESHOLD,
  ];

  // Pinch: thumb tip to index tip, measured in palm sizes.
  const pinchDistance = distance2d(at(points, 4), at(points, 8)) / (PINCH_SCALE * palmSize);
  const pinch = 1 - clamp01(pinchDistance);

  // Roll: direction of the wrist -> middle MCP vector in the image plane.
  const rollDeg = (Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180) / Math.PI;

  return {
    tsMs: frame.tsMs,
    palmCenterX: centerX,
    palmCenterY: centerY,
    palmSize,
    // The contract defines closeness as 1 / palmSize: a *bigger* number means
    // a *smaller* hand, i.e. the hand is farther from the camera.
    closeness: 1 / palmSize,
    openness,
    pinch,
    rollDeg,
    raised,
  };
};
