import { describe, it, expect } from 'vitest';
import { GestureDetector } from './detector';
import { computeFeatures } from './features';
import type { GestureFeatures } from './types';
import { fistHand, openHand, pinchHand, pointUpHand, snapSequence, toHandFrame } from './fixtures/handFixtures';

const featuresOf = (landmarks: ReturnType<typeof openHand>, tsMs: number): GestureFeatures =>
  computeFeatures(toHandFrame(landmarks, { tsMs }));

const manualFeatures = (overrides: Partial<GestureFeatures>): GestureFeatures => ({
  tsMs: 0,
  palmCenterX: 0.5,
  palmCenterY: 0.5,
  palmSize: 0.2,
  closeness: 5,
  openness: 0,
  pinch: 0,
  rollDeg: -90,
  raised: [false, false, false, false, false],
  ...overrides,
});

describe('GestureDetector', () => {
  it('emits a pinch exactly once after three frames of holding', () => {
    const detector = new GestureDetector();
    const results = [0, 1, 2, 3, 4].map((index) =>
      detector.update(featuresOf(pinchHand(), index * 33)),
    );

    expect(results).toEqual([null, null, 'pinch', null, null]);
  });

  it('emits again after the gesture was released and the min-hold window passed', () => {
    const detector = new GestureDetector();

    expect(detector.update(featuresOf(pinchHand(), 0))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 33))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 66))).toBe('pinch');

    // Release.
    expect(detector.update(featuresOf(openHand(), 100))).toBe(null);

    // Re-pinch, but inside the min-hold window: the event is delayed, not
    // dropped — it is emitted as soon as the window has passed.
    expect(detector.update(featuresOf(pinchHand(), 133))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 166))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 199))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 232))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 266))).toBe('pinch');

    // A new hold cycle after a release fires again.
    expect(detector.update(featuresOf(openHand(), 300))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 600))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 633))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 666))).toBe('pinch');
  });

  it('never emits the same gesture twice inside the min-hold window', () => {
    const detector = new GestureDetector();

    expect(detector.update(featuresOf(pinchHand(), 0))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 33))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 66))).toBe('pinch');

    // Release and re-pinch right away.
    expect(detector.update(featuresOf(openHand(), 90))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 120))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 150))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 180))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 210))).toBe(null);
    // 210 - 66 = 144 ms < 200 ms: still inside the window.
    expect(detector.update(featuresOf(pinchHand(), 240))).toBe(null);
    // 266 - 66 = 200 ms: the window has passed.
    expect(detector.update(featuresOf(pinchHand(), 266))).toBe('pinch');
  });

  it('emits nothing for a flickering signal', () => {
    const detector = new GestureDetector();
    const results = Array.from({ length: 12 }, (_, index) =>
      detector.update(
        featuresOf(index % 2 === 0 ? pinchHand() : openHand(), index * 33),
      ),
    );

    expect(results.every((result) => result === null)).toBe(true);
  });

  it('never emits two gestures in the same update', () => {
    const detector = new GestureDetector();
    // A closed, pointing hand satisfies both the fist and the pointUp rule.
    const features = manualFeatures({
      tsMs: 0,
      openness: 0.1,
      raised: [true, true, false, false, false],
    });

    const results = [0, 1, 2, 3].map((index) =>
      detector.update({ ...features, tsMs: index * 33 }),
    );

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    // The priority order decides: the more specific gesture wins.
    expect(results[2]).toBe('pointUp');
  });

  it('recognises the open palm, the fist and the pointing hand', () => {
    const openDetector = new GestureDetector();
    const openResults = [0, 1, 2].map((index) => openDetector.update(featuresOf(openHand(), index * 33)));
    expect(openResults[2]).toBe('openPalm');

    const fistDetector = new GestureDetector();
    const fistResults = [0, 1, 2].map((index) => fistDetector.update(featuresOf(fistHand(), index * 33)));
    expect(fistResults[2]).toBe('fist');

    const pointDetector = new GestureDetector();
    const pointResults = [0, 1, 2].map((index) => pointDetector.update(featuresOf(pointUpHand(), index * 33)));
    expect(pointResults[2]).toBe('pointUp');
  });

  it('catches a snap when the hand closes quickly', () => {
    const detector = new GestureDetector();
    const frames = snapSequence({ openFrames: 3, closedFrames: 4, stepMs: 33 });

    const results = frames.map((frame) => detector.update(computeFeatures(frame)));

    // The snap wins over the fist: it is the more specific gesture.
    expect(results).toContain('snap');
    expect(results.filter((result) => result === 'snap')).toHaveLength(1);
    // The open hand in front of the snap is a legitimate open palm, but the
    // closed hand must not be reported as a fist.
    expect(results).not.toContain('fist');
  });

  it('forgets everything on reset', () => {
    const detector = new GestureDetector();
    expect(detector.update(featuresOf(pinchHand(), 0))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 33))).toBe(null);
    detector.reset();
    // The hold counter started over, so the first frame after the reset does
    // not fire.
    expect(detector.update(featuresOf(pinchHand(), 66))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 99))).toBe(null);
    expect(detector.update(featuresOf(pinchHand(), 132))).toBe('pinch');
  });
});
