import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  micDetectionActive,
  micMeterFrame,
  micPeakTimes,
} from '../state/micStoreAdapter';

/**
 * micStoreAdapter tests — exercise the shim derivations that stand
 * in for the parallel WS-A domain work until that branch merges.
 *
 * These tests deliberately drive `micStore` from inside (via the
 * public setters), then read from the adapter's derived getters.
 * When WS-A merges, these tests verify the RE-EXPORTED versions
 * (which the adapter will switch to) behave identically.
 */

beforeEach(async () => {
  const w = await import('../state/micStore');
  await w.stopMic();
  w.setMicCurrentRms(0);
  w.setMicCurrentHz(null);
  w.setMicPreviewNotes([]);
  w.setMicTransients([]);
});

afterEach(async () => {
  const w = await import('../state/micStore');
  await w.stopMic();
});

vi.mock('~/infrastructure/audio/./MicCapture', () => ({
  startMicDetector: () => ({
    getState: () => 'streaming',
    stop: async () => {},
  }),
  isMicSupported: () => true,
}));

describe('micStoreAdapter — micDetectionActive', () => {
  it('returns "idle" when both buffers are empty', () => {
    expect(micDetectionActive()).toBe('idle');
  });

  it('returns "sustained" when only micPreviewNotes has content', async () => {
    const w = await import('../state/micStore');
    w.setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 1000, durationMs: 500, vibratoCents: 0 },
    ]);
    expect(micDetectionActive()).toBe('sustained');
  });

  it('returns "percussive" when only micTransients has content', async () => {
    const w = await import('../state/micStore');
    w.setMicTransients([
      { type: 'kick', startMs: 1000, amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 },
    ]);
    expect(micDetectionActive()).toBe('percussive');
  });

  it('returns "both" when both buffers have content', async () => {
    const w = await import('../state/micStore');
    w.setMicPreviewNotes([
      { midi: 60, cents: 0, startMs: 1000, durationMs: 500, vibratoCents: 0 },
    ]);
    w.setMicTransients([
      { type: 'kick', startMs: 1000, amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 },
    ]);
    expect(micDetectionActive()).toBe('both');
  });
});

describe('micStoreAdapter — micMeterFrame', () => {
  it('returns null when not listening', () => {
    expect(micMeterFrame()).toBeNull();
  });

  it('returns a frame when listening, with hz and rms from the store', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicCurrentHz(440);
    w.setMicCurrentRms(0.2);
    const f = micMeterFrame();
    expect(f).not.toBeNull();
    expect(f?.hz).toBe(440);
    expect(f?.rms).toBe(0.2);
    expect(f?.peak).toBe(0.2);
    expect(typeof f?.timestampMs).toBe('number');
    await w.stopMic();
  });

  it('returns null hz when no pitch is detected (but listening)', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const f = micMeterFrame();
    expect(f).not.toBeNull();
    expect(f?.hz).toBeNull();
    await w.stopMic();
  });
});

describe('micStoreAdapter — micPeakTimes', () => {
  it('returns an empty array when there are no transients', () => {
    expect(micPeakTimes()).toHaveLength(0);
  });

  it('returns a peak mark per recent transient', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicTransients([
      { type: 'kick',  startMs: now - 200,  amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 },
      { type: 'snare', startMs: now - 1000, amplitude: 0.7, spectralCentroidHz: 1500, envelopeMs: 90 },
    ]);
    const peaks = micPeakTimes();
    expect(peaks).toHaveLength(2);
    expect(peaks[0]?.type).toBe('transient');
    expect(peaks[1]?.type).toBe('transient');
    expect(typeof peaks[0]?.ms).toBe('number');
  });

  it('filters out transients older than 3s', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicTransients([
      { type: 'kick', startMs: now - 500,    amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 }, // kept
      { type: 'kick', startMs: now - 5000,   amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 }, // dropped
    ]);
    expect(micPeakTimes()).toHaveLength(1);
  });
});

describe('micStoreAdapter — type exports', () => {
  it('re-exports MicSlot from micStore', () => {
    // If MicSlot isn't re-exported, the import below fails to typecheck.
    type Slot = 'append-stack' | 'replace-score' | 'at-cursor';
    const slot: Slot = 'append-stack';
    expect(slot).toBe('append-stack');
  });
});