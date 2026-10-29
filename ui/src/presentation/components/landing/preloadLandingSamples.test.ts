import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * preloadLandingSamples — fire-and-forget sample-bank preload
 * triggered by the Landing page mount.
 *
 * The test mocks `~/infrastructure/audio/SampleLoader` and asserts
 * the helper invokes `loadAllSamples()` exactly once per call.
 * No Landing component mount is required — the helper is a
 * one-liner module-level side effect.
 *
 * The idempotency property lives in SampleLoader (per
 * `SampleLoader.test.ts:401-407`), not in this helper: SampleLoader
 * short-circuits on already-loaded banks. The helper is a dumb
 * pipe by design.
 */

const loadAllSamplesMock = vi.fn().mockResolvedValue(undefined);

vi.mock('~/infrastructure/audio/SampleLoader', () => ({
  loadAllSamples: loadAllSamplesMock,
}));

beforeEach(() => {
  loadAllSamplesMock.mockClear();
});

describe('preloadLandingSamples — landing-page sample preload', () => {
  it('invokes SampleLoader.loadAllSamples() exactly once per call', async () => {
    const { preloadLandingSamples } = await import('./preloadLandingSamples');
    preloadLandingSamples();
    // The dynamic import resolves on a microtask; let it settle.
    // Several ticks because the dynamic import may span the
    // module-resolution boundary (transform + import).
    for (let i = 0; i < 10; i += 1) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    expect(loadAllSamplesMock).toHaveBeenCalledTimes(1);
  });

  it('is fire-and-forget: returns void synchronously (no awaited Promise)', async () => {
    const { preloadLandingSamples } = await import('./preloadLandingSamples');
    const out = preloadLandingSamples();
    expect(out).toBeUndefined();
  });

  it('does not throw when called without an awaiting consumer', () => {
    return import('./preloadLandingSamples').then(({ preloadLandingSamples }) => {
      expect(() => preloadLandingSamples()).not.toThrow();
    });
  });

  it('does not require any arguments (signature is `() => void`)', async () => {
    const { preloadLandingSamples } = await import('./preloadLandingSamples');
    expect(preloadLandingSamples.length).toBe(0);
  });
});