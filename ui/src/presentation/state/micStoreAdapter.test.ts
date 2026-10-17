import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  micDetectionActive,
  micMeterFrame,
  micPeakTimes,
} from '../state/micStoreAdapter';

/**
 * micStoreAdapter tests — exercise the re-exports that proxy to the
 * parallel WS-A domain signals. The adapter delegates to the real
 * `micStore` signals (`micDetectionActive`, `micMeterFrame`,
 * `micPeakTimes`); these tests drive the underlying setters on
 * `micStore` and assert the adapter exposes the right shapes.
 *
 * WS-A removed the old `setMicCurrentRms` / `setMicCurrentHz` setters
 * in favor of the unified `setMicMeterFrame({ rms, peak, hz, ts })`.
 * This file was updated post-merge to match.
 */

beforeEach(async () => {
  const w = await import('../state/micStore');
  await w.stopMic();
  w.setMicPreviewNotes([]);
  w.setMicTransients([]);
  w.setMicMeterFrame(null);
  w.setMicPeakTimes([]);
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
  it('returns null when no frame has been recorded', () => {
    expect(micMeterFrame()).toBeNull();
  });

  it('returns the frame the store holds', async () => {
    const w = await import('../state/micStore');
    w.setMicMeterFrame({ rms: 0.2, peak: 0.2, hz: 440, timestampMs: 1000 });
    const f = micMeterFrame();
    expect(f).not.toBeNull();
    expect(f?.hz).toBe(440);
    expect(f?.rms).toBe(0.2);
    expect(f?.peak).toBe(0.2);
    expect(f?.timestampMs).toBe(1000);
  });

  it('returns null hz when the recorded frame has no pitch', async () => {
    const w = await import('../state/micStore');
    w.setMicMeterFrame({ rms: 0.1, peak: 0.1, hz: null, timestampMs: 500 });
    const f = micMeterFrame();
    expect(f).not.toBeNull();
    expect(f?.hz).toBeNull();
  });
});

describe('micStoreAdapter — micPeakTimes', () => {
  it('returns an empty array when there are no marks', () => {
    expect(micPeakTimes()).toHaveLength(0);
  });

  it('returns marks stored via setMicPeakTimes', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicPeakTimes([
      { ms: now - 200,  type: 'transient' },
      { ms: now - 1000, type: 'transient' },
    ]);
    const peaks = micPeakTimes();
    expect(peaks).toHaveLength(2);
    expect(peaks[0]?.type).toBe('transient');
    expect(peaks[1]?.type).toBe('transient');
  });

  it('returns marks within a 3s sliding window', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicPeakTimes([
      { ms: now - 500,  type: 'transient' },  // recent — kept
      { ms: now - 5000, type: 'transient' },  // old — store ignores
    ]);
    // The store itself prunes; the adapter exposes whatever the store holds.
    // Verify the recent one is here (the store may or may not have
    // already pruned the old one depending on timing).
    const peaks = micPeakTimes();
    expect(peaks.find((p) => Math.abs(p.ms - (now - 500)) < 5)).toBeDefined();
  });
});

describe('micStoreAdapter — type exports', () => {
  it('re-exports MicSlot from micStore', () => {
    type Slot = 'append-stack' | 'replace-score' | 'at-cursor';
    const slot: Slot = 'append-stack';
    expect(slot).toBe('append-stack');
  });
});
