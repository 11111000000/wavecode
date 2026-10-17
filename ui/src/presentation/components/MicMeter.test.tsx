import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { MicMeter } from './MicMeter';

/**
 * MicMeter tests.
 *
 * The meter reads from `micStoreAdapter` (`micMeterFrame` and
 * `micPeakTimes`), both of which are derived from `micStore` signals.
 * We drive the underlying signals directly to exercise the render
 * branches:
 *
 *   - `setMicCurrentRms` / `setMicCurrentHz` change what
 *     `micMeterFrame()` returns.
 *   - `setMicTransients` / `setMicListening` change both frame and
 *     peaks.
 *
 * State-leak avoidance: module-level signals from `micStore` persist
 * across tests. We can't use `vi.resetModules()` because MicMeter is
 * imported at module-load time (above this file's body) — a reset
 * would orphan the MicMeter's reference to a stale `micStoreAdapter`
 * and the meter would always read default signals. Instead we
 * explicitly reset the relevant signals in beforeEach and stopMic()
 * any time we started one.
 *
 * The adapter is NOT mocked — we want the real derivation path so a
 * bug in the shim surfaces here, not at integration time.
 */

beforeEach(async () => {
  const w = await import('../state/micStore');
  await w.stopMic();
  w.setMicCurrentRms(0);
  w.setMicCurrentHz(null);
  w.setMicTransients([]);
});

vi.mock('~/infrastructure/audio/./MicCapture', () => ({
  startMicDetector: () => ({
    getState: () => 'streaming',
    stop: async () => {},
  }),
  isMicSupported: () => true,
}));

afterEach(async () => {
  const w = await import('../state/micStore');
  await w.stopMic();
  cleanup();
});

describe('MicMeter — empty/idle', () => {
  it('renders the meter row container', () => {
    const { container } = render(() => <MicMeter />);
    expect(container.querySelector('.mic-ux-row-meter')).not.toBeNull();
    expect(container.querySelector('.mic-ux-meter')).not.toBeNull();
    expect(container.querySelector('.mic-ux-meter-readout')).not.toBeNull();
  });

  it('reads "0.00" RMS when the mic is not listening', () => {
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const rmsRow = rows[0];
    expect(rmsRow?.textContent).toContain('0.00');
  });

  it('reads "— Hz" when no pitch is detected', () => {
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const hzRow = rows[1];
    expect(hzRow?.textContent).toContain('— Hz');
  });

  it('bar data-listening flag is false when not listening', () => {
    const { container } = render(() => <MicMeter />);
    const bar = container.querySelector<HTMLDivElement>('.mic-ux-meter-bar');
    expect(bar?.getAttribute('data-listening')).toBe('false');
  });
});

describe('MicMeter — when mic is listening', () => {
  it('shows Hz when hz is non-null', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicCurrentHz(440);
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const hzRow = rows[1];
    expect(hzRow?.textContent).toContain('440 Hz');
    await w.stopMic();
  });

  it('shows RMS value (formatted to 2 decimals) when frame is non-null', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicCurrentRms(0.123);
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const rmsRow = rows[0];
    expect(rmsRow?.textContent).toContain('0.12');
    await w.stopMic();
  });

  it('bar data-listening flag flips to true when listening', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    const { container } = render(() => <MicMeter />);
    const bar = container.querySelector<HTMLDivElement>('.mic-ux-meter-bar');
    expect(bar?.getAttribute('data-listening')).toBe('true');
    await w.stopMic();
  });

  it('bar width is a percentage string', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicCurrentRms(0.15);
    const { container } = render(() => <MicMeter />);
    const bar = container.querySelector<HTMLDivElement>('.mic-ux-meter-bar');
    expect(bar?.style.width).toMatch(/%$/);
    await w.stopMic();
  });
});

describe('MicMeter — onset spike markers', () => {
  it('renders no spike markers when the transient buffer is empty', () => {
    const { container } = render(() => <MicMeter />);
    expect(container.querySelectorAll('.mic-ux-meter-spike')).toHaveLength(0);
  });

  it('renders one spike marker per recent transient', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicTransients([
      { type: 'kick',  startMs: now - 100,  amplitude: 0.8, spectralCentroidHz: 100,  envelopeMs: 80 },
      { type: 'snare', startMs: now - 600,  amplitude: 0.7, spectralCentroidHz: 1500, envelopeMs: 90 },
      { type: 'hat',   startMs: now - 1500, amplitude: 0.6, spectralCentroidHz: 4500, envelopeMs: 50 },
    ]);
    const { container } = render(() => <MicMeter />);
    const spikes = container.querySelectorAll('.mic-ux-meter-spike');
    expect(spikes).toHaveLength(3);
  });

  it('each spike carries data-peak-type="transient"', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicTransients([
      { type: 'kick',  startMs: now - 100, amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 },
    ]);
    const { container } = render(() => <MicMeter />);
    const spike = container.querySelector<HTMLSpanElement>('.mic-ux-meter-spike');
    expect(spike?.getAttribute('data-peak-type')).toBe('transient');
  });

  it('drops transients older than the 3 s window', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.setMicTransients([
      { type: 'kick', startMs: now - 500,    amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 }, // kept
      { type: 'kick', startMs: now - 2900,   amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 }, // kept
      { type: 'kick', startMs: now - 3500,   amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 }, // dropped
      { type: 'kick', startMs: now - 10_000, amplitude: 0.8, spectralCentroidHz: 100, envelopeMs: 80 }, // dropped
    ]);
    const { container } = render(() => <MicMeter />);
    const spikes = container.querySelectorAll('.mic-ux-meter-spike');
    expect(spikes).toHaveLength(2);
  });
});

describe('MicMeter — accessibility', () => {
  it('has a descriptive role + aria-label on the row', () => {
    const { container } = render(() => <MicMeter />);
    const row = container.querySelector<HTMLDivElement>('.mic-ux-row-meter');
    expect(row?.getAttribute('role')).toBe('group');
    expect(row?.getAttribute('aria-label')).toContain('mic meter');
  });

  it('has aria-live on the read-out', () => {
    const { container } = render(() => <MicMeter />);
    const readout = container.querySelector<HTMLDivElement>('.mic-ux-meter-readout');
    expect(readout?.getAttribute('aria-live')).toBe('polite');
  });
});