import { describe, it, expect } from 'vitest';
import { computeFeatures } from './features';
import {
  fistHand,
  handAt,
  openHand,
  pinchHand,
  pointUpHand,
  scaleAboutWrist,
  toHandFrame,
} from './fixtures/handFixtures';

const frame = (landmarks: ReturnType<typeof openHand>, tsMs = 0) => toHandFrame(landmarks, { tsMs });

describe('computeFeatures', () => {
  it('puts the palm centre at the mean of the wrist and the four MCP knuckles', () => {
    const points = openHand();
    const features = computeFeatures(frame(points));
    const palmIndices = [0, 5, 9, 13, 17];
    const expectedX = palmIndices.reduce((sum, index) => sum + (points[index]?.x ?? 0), 0) / palmIndices.length;
    const expectedY = palmIndices.reduce((sum, index) => sum + (points[index]?.y ?? 0), 0) / palmIndices.length;

    expect(features.palmCenterX).toBeCloseTo(expectedX, 6);
    expect(features.palmCenterY).toBeCloseTo(expectedY, 6);
  });

  it('is invariant to the distance to the camera', () => {
    const base = computeFeatures(frame(openHand()));
    const scaled = computeFeatures(frame(scaleAboutWrist(openHand(), 2)));

    expect(scaled.openness).toBeCloseTo(base.openness, 6);
    expect(scaled.pinch).toBeCloseTo(base.pinch, 6);
    expect(scaled.raised).toEqual(base.raised);
  });

  it('measures closeness as 1 / palmSize, so a bigger hand means a smaller value', () => {
    const near = computeFeatures(frame(handAt(0.5, 0.5, 2)));
    const far = computeFeatures(frame(handAt(0.5, 0.5, 0.5)));

    expect(near.palmSize).toBeCloseTo(far.palmSize * 4, 6);
    expect(near.closeness).toBeCloseTo(far.closeness / 4, 6);
    // The contract names the field after the formula: closeness = 1 / palmSize,
    // so a LARGER number means a SMALLER hand, i.e. the hand is farther away.
    expect(far.closeness).toBeGreaterThan(near.closeness);
  });

  it('reads an open hand as fully open', () => {
    const features = computeFeatures(frame(openHand()));

    expect(features.openness).toBeCloseTo(1, 6);
    expect(features.pinch).toBeCloseTo(0, 6);
    expect(features.raised).toEqual([true, true, true, true, true]);
  });

  it('reads a fist as closed', () => {
    const features = computeFeatures(frame(fistHand()));

    expect(features.openness).toBeCloseTo(0, 6);
    expect(features.raised).toEqual([false, false, false, false, false]);
  });

  it('reads a pinch as a closed pinch', () => {
    const features = computeFeatures(frame(pinchHand()));

    expect(features.pinch).toBeCloseTo(1, 6);
    expect(features.openness).toBeCloseTo(1, 6);
  });

  it('reads a pointing hand as index only', () => {
    const features = computeFeatures(frame(pointUpHand()));

    expect(features.raised[1]).toBe(true);
    expect(features.raised[2]).toBe(false);
    expect(features.raised[3]).toBe(false);
    expect(features.raised[4]).toBe(false);
    expect(features.openness).toBeCloseTo(0.25, 6);
  });

  it('reports the roll of the hand in the image plane', () => {
    const features = computeFeatures(frame(openHand()));

    // The canonical hand points up, and y grows downwards.
    expect(features.rollDeg).toBeCloseTo(-90, 6);
  });

  it('survives a frame with missing landmarks', () => {
    const features = computeFeatures(frame(openHand().slice(0, 10)));

    expect(Number.isFinite(features.openness)).toBe(true);
    expect(Number.isFinite(features.pinch)).toBe(true);
    expect(Number.isFinite(features.palmSize)).toBe(true);
    expect(features.raised).toHaveLength(5);
  });
});
