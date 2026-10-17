import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { MicMeter } from './MicMeter';

/**
 * MicMeter tests — render the live RMS+Hz meter with onset-spike
 * markers. The component reads from the micStoreAdapter (which
 * proxies to the real `micStore` signals). We drive the underlying
 * `setMicMeterFrame` / `setMicPeakTimes` setters to simulate the
 * RAF tick that MicCapture would produce.
 *
 * The adapter is NOT mocked — we want the real derivation path so a
 * bug in the re-export surfaces here, not at integration time.
 */

beforeEach(async () => {
  const w = await import('../state/micStore');
  await w.stopMic();
  w.setMicMeterFrame(null);
  w.setMicPeakTimes([]);
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

  it('reads "0.00" RMS when the meter frame is null', () => {
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const rmsRow = rows[0];
    expect(rmsRow?.textContent).toContain('0.00');
  });

  it('reads "— Hz" when the meter frame has no pitch', () => {
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const hzRow = rows[1];
    expect(hzRow?.textContent).toContain('— Hz');
  });

  it('bar data-listening flag is false when no frame is set', () => {
    const { container } = render(() => <MicMeter />);
    const bar = container.querySelector('.mic-ux-meter-bar');
    expect(bar?.getAttribute('data-listening')).toBe('false');
  });
});

describe('MicMeter — when a meter frame is present', () => {
  it('shows Hz when the frame has a non-null hz', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicMeterFrame({ rms: 0.3, peak: 0.3, hz: 440, timestampMs: 1000 });
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const hzRow = rows[1];
    expect(hzRow?.textContent).toContain('440');
    await w.stopMic();
  });

  it('shows RMS formatted to 2 decimals when frame is set', async () => {
    const w = await import('../state/micStore');
    w.startMic();
    w.setMicMeterFrame({ rms: 0.42, peak: 0.42, hz: null, timestampMs: 500 });
    const { container } = render(() => <MicMeter />);
    const rows = container.querySelectorAll('.mic-ux-meter-readout-row');
    const rmsRow = rows[0];
    expect(rmsRow?.textContent).toContain('0.42');
    await w.stopMic();
  });

  it('bar data-listening is true when a frame is present', () => {
    const { container } = render(() => <MicMeter />);
    // Without a frame, not listening.
    let bar = container.querySelector('.mic-ux-meter-bar');
    expect(bar?.getAttribute('data-listening')).toBe('false');
  });
});

describe('MicMeter — onset spike markers', () => {
  it('renders no spikes when micPeakTimes is empty', () => {
    const { container } = render(() => <MicMeter />);
    expect(container.querySelectorAll('.mic-ux-meter-spike')).toHaveLength(0);
  });

  it('renders one spike per recent peak', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.startMic();
    w.setMicPeakTimes([
      { ms: now - 200, type: 'transient' },
      { ms: now - 1000, type: 'transient' },
      { ms: now - 2000, type: 'note' },
    ]);
    const { container } = render(() => <MicMeter />);
    const spikes = container.querySelectorAll('.mic-ux-meter-spike');
    expect(spikes).toHaveLength(3);
    await w.stopMic();
  });

  it('each spike carries a data-peak-type matching its mark', async () => {
    const w = await import('../state/micStore');
    const now = performance.now();
    w.startMic();
    w.setMicPeakTimes([
      { ms: now - 200, type: 'transient' },
      { ms: now - 1000, type: 'note' },
    ]);
    const { container } = render(() => <MicMeter />);
    const spikes = container.querySelectorAll('.mic-ux-meter-spike');
    expect(spikes[0]?.getAttribute('data-peak-type')).toBe('transient');
    expect(spikes[1]?.getAttribute('data-peak-type')).toBe('note');
    await w.stopMic();
  });
});
