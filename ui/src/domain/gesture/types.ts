/**
 * Domain contract for the hand-gesture feature.
 *
 * Everything in `domain/gesture/` is pure: no camera, no audio, no Solid, no
 * Strudel. The infrastructure layer produces `HandFrame`s, the domain turns
 * them into `GestureFeatures` / `ControlEvent`s, and the presentation layer
 * consumes the events.
 *
 * MediaPipe hand-landmark index map (21 points):
 *
 *   0        wrist
 *   1..4     thumb  (CMC, MCP, IP, TIP)
 *   5..8     index  (MCP, PIP, DIP, TIP)
 *   9..12    middle (MCP, PIP, DIP, TIP)
 *   13..16   ring   (MCP, PIP, DIP, TIP)
 *   17..20   pinky  (MCP, PIP, DIP, TIP)
 *
 * Image coordinates are normalized to the frame: x in 0..1 across the width,
 * y in 0..1 down the height, z relative to the wrist (smaller = closer).
 * World coordinates are in metres with the hand centre as the origin.
 */

export type Handedness = 'Left' | 'Right';

export type Landmark = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** One tracked frame of one hand. */
export type HandFrame = {
  readonly tsMs: number;
  readonly handedness: Handedness;
  /** 21 points, normalized to the image. */
  readonly landmarks: ReadonlyArray<Landmark>;
  /** 21 points, in metres, hand-centre origin. */
  readonly worldLandmarks: ReadonlyArray<Landmark>;
};

/** Scale-normalised features derived from one hand frame. */
export type GestureFeatures = {
  readonly tsMs: number;
  /** Palm centre, 0..1 of the frame width. */
  readonly palmCenterX: number;
  /** Palm centre, 0..1 of the frame height. */
  readonly palmCenterY: number;
  /** |P9 - P0| in frame units (wrist -> middle MCP). */
  readonly palmSize: number;
  /** 1 / palmSize — monotonic "closeness" proxy (bigger number = smaller hand = farther away). */
  readonly closeness: number;
  /** 0..1 — how open the hand is. */
  readonly openness: number;
  /** 0..1, 1 = thumb tip touches index tip. */
  readonly pinch: number;
  /** Tilt of the hand in the image plane, in degrees. */
  readonly rollDeg: number;
  /** 5 booleans: thumb, index, middle, ring, pinky. */
  readonly raised: readonly boolean[];
};

export type GestureName = 'pinch' | 'openPalm' | 'fist' | 'pointUp' | 'snap';

export type ContinuousParam = 'pitch' | 'volume' | 'pan' | 'cutoff' | 'room' | 'speed';

export type ControlEvent =
  | { readonly kind: 'continuous'; readonly param: ContinuousParam; readonly value: number; readonly tsMs: number }
  | { readonly kind: 'discrete'; readonly gesture: GestureName; readonly tsMs: number };
