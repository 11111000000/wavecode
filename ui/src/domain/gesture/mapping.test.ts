import { describe, it, expect } from 'vitest';
import { mapFeatureToControl, mapFeaturesToControls, normalizeCloseness, normalizeRoll } from './mapping';
import type { GestureFeatures } from './types';

const CURVES = ['linear', 'log', 'exp'] as const;

const sample = (from: number, to: number, step: number): number[] => {
  const values: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) values.push(value);
  return values;
};

const features: GestureFeatures = {
  tsMs: 1234,
  palmCenterX: 0.25,
  palmCenterY: 0.75,
  palmSize: 0.1,
  closeness: 10,
  openness: 0.6,
  pinch: 0.2,
  rollDeg: 0,
  raised: [true, true, false, false, false],
};

describe('mapFeatureToControl', () => {
  it('is monotonic for every curve', () => {
    for (const curve of CURVES) {
      const values = sample(0, 1, 0.05).map((value) =>
        mapFeatureToControl(value, { param: 'volume', curve }),
      );
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
      }
    }
  });

  it('inverts the axis', () => {
    expect(mapFeatureToControl(0.25, { param: 'volume', invert: true })).toBeCloseTo(
      mapFeatureToControl(0.75, { param: 'volume' }),
      6,
    );
  });

  it('collapses the deadzone around the centre', () => {
    expect(mapFeatureToControl(0.5, { param: 'volume' })).toBe(0.5);
    expect(mapFeatureToControl(0.51, { param: 'volume', deadzone: 0.02 })).toBe(0.5);
    expect(mapFeatureToControl(0.49, { param: 'volume', deadzone: 0.02 })).toBe(0.5);
    expect(mapFeatureToControl(0.6, { param: 'volume', deadzone: 0.02 })).not.toBe(0.5);
  });

  it('scales into the configured range', () => {
    const axis = { param: 'cutoff' as const, min: 200, max: 12000 };
    expect(mapFeatureToControl(0, axis)).toBe(200);
    expect(mapFeatureToControl(1, axis)).toBe(12000);
    expect(mapFeatureToControl(0.5, axis)).toBeCloseTo(6100, 6);
  });

  it('keeps every curve inside 0..1 and centred', () => {
    for (const curve of CURVES) {
      for (const value of sample(0, 1, 0.05)) {
        const mapped = mapFeatureToControl(value, { param: 'volume', curve, deadzone: 0 });
        expect(mapped).toBeGreaterThanOrEqual(0);
        expect(mapped).toBeLessThanOrEqual(1);
      }
      expect(mapFeatureToControl(0.5, { param: 'volume', curve, deadzone: 0 })).toBeCloseTo(0.5, 6);
    }
  });

  it('treats a non-finite feature as the neutral position', () => {
    expect(mapFeatureToControl(Number.NaN, { param: 'volume' })).toBe(0.5);
  });
});

describe('normalizeCloseness / normalizeRoll', () => {
  it('maps the plausible closeness range into 0..1', () => {
    expect(normalizeCloseness(4)).toBe(0);
    expect(normalizeCloseness(20)).toBe(1);
    expect(normalizeCloseness(12)).toBeCloseTo(0.5, 6);
    expect(normalizeCloseness(100)).toBe(1);
    expect(normalizeCloseness(1)).toBe(0);
  });

  it('maps the roll angle into 0..1', () => {
    expect(normalizeRoll(-180)).toBe(0);
    expect(normalizeRoll(0)).toBe(0.5);
    expect(normalizeRoll(180)).toBe(1);
  });
});

describe('mapFeaturesToControls', () => {
  it('returns one continuous event per axis', () => {
    const events = mapFeaturesToControls(features, [
      { param: 'pitch' },
      { param: 'volume' },
      { param: 'pan' },
      { param: 'cutoff' },
      { param: 'room' },
      { param: 'speed' },
    ]);

    expect(events).toHaveLength(6);
    expect(events.map((event) => (event.kind === 'continuous' ? event.param : null))).toEqual([
      'pitch',
      'volume',
      'pan',
      'cutoff',
      'room',
      'speed',
    ]);
    for (const event of events) {
      expect(event.kind).toBe('continuous');
      if (event.kind === 'continuous') {
        expect(event.tsMs).toBe(1234);
        expect(event.value).toBeGreaterThanOrEqual(0);
        expect(event.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('drives the pitch axis from the vertical palm position, inverted', () => {
    const [event] = mapFeaturesToControls(features, [{ param: 'pitch' }]);
    expect(event?.kind).toBe('continuous');
    if (event?.kind === 'continuous') {
      // palmCenterY = 0.75, inverted -> 0.25.
      expect(event.value).toBeCloseTo(0.25, 6);
    }
  });

  it('drives the volume axis from the openness', () => {
    const [event] = mapFeaturesToControls(features, [{ param: 'volume' }]);
    if (event?.kind === 'continuous') {
      expect(event.value).toBeCloseTo(0.6, 6);
    }
  });

  it('honours an explicit inversion over the default one', () => {
    const [event] = mapFeaturesToControls(features, [{ param: 'pitch', invert: false }]);
    if (event?.kind === 'continuous') {
      expect(event.value).toBeCloseTo(0.75, 6);
    }
  });
});
