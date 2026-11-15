import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from './oneEuro';

/** Deterministic pseudo-random noise (no Math.random, so the test is stable). */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const variance = (values: readonly number[]): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
};

describe('OneEuroFilter', () => {
  it('cuts the variance of a noisy constant signal', () => {
    const filter = new OneEuroFilter();
    const random = lcg(12345);
    const frameMs = 1000 / 60;

    const raw: number[] = [];
    const filtered: number[] = [];

    for (let index = 0; index < 120; index += 1) {
      const noisy = 0.5 + (random() - 0.5) * 0.2;
      const output = filter.filter(noisy, index * frameMs);
      if (index >= 10) {
        // Skip the settling frames: the first sample is passed through.
        raw.push(noisy);
        filtered.push(output);
      }
    }

    expect(variance(filtered)).toBeLessThan(variance(raw) / 5);
    // The mean must survive the filtering.
    const mean = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
  });

  it('tracks a fast step within 100 ms at 60 fps', () => {
    // A responsive configuration: the default cutoff (1 Hz) is meant for slow
    // drift, a gesture that has to be caught now needs a higher cutoff.
    const filter = new OneEuroFilter({ minCutoffHz: 3, beta: 1 });
    const frameMs = 1000 / 60;

    let stepAt = -1;
    let settledAt = -1;

    for (let index = 0; index < 40; index += 1) {
      const tsMs = index * frameMs;
      const target = index >= 10 ? 1 : 0;
      if (index === 10) stepAt = tsMs;
      const output = filter.filter(target, tsMs);
      if (stepAt >= 0 && settledAt < 0 && Math.abs(output - 1) <= 0.1) settledAt = tsMs;
    }

    expect(stepAt).toBeGreaterThanOrEqual(0);
    expect(settledAt).toBeGreaterThanOrEqual(0);
    expect(settledAt - stepAt).toBeLessThanOrEqual(100);
  });

  it('ignores a non-positive time step without corrupting the state', () => {
    const filter = new OneEuroFilter({ minCutoffHz: 3, beta: 1 });

    expect(filter.filter(0, 0)).toBe(0);
    // The second sample is filtered, not passed through.
    const second = filter.filter(1, 100);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThanOrEqual(1);

    // Same timestamp: no new information, the last value is returned.
    expect(filter.filter(5, 100)).toBe(second);
    expect(filter.filter(5, 50)).toBe(second);

    // The state survived: the next proper sample continues from there.
    const next = filter.filter(1, 200);
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeGreaterThan(second);
    expect(next).toBeLessThanOrEqual(1);
  });

  it('ignores non-finite samples', () => {
    const filter = new OneEuroFilter({ minCutoffHz: 3, beta: 1 });

    expect(filter.filter(0.25, 0)).toBe(0.25);
    expect(filter.filter(Number.NaN, 16)).toBe(0.25);
    expect(filter.filter(Number.POSITIVE_INFINITY, 32)).toBe(0.25);

    // A NaN must not poison the filter.
    const next = filter.filter(0.25, 48);
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeGreaterThan(0);
  });

  it('starts from the first sample after a reset', () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(0.5, 0)).toBe(0.5);
    filter.reset();
    expect(filter.filter(0.8, 0)).toBe(0.8);
  });
});
