import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import type { HandFrame, Landmark } from '~/domain/gesture/types';
import type { GestureCaptureOptions } from '~/infrastructure/gesture/GestureCapture';

/**
 * GesturePanel — the «управление руками» sheet.
 *
 * The camera is mocked, so the test can flip the master toggle and check
 * that (a) nothing happens before the toggle is flipped and (b) the capture
 * starts when it is. The status / gesture texts are read back from the store
 * signals, which the panel renders.
 */

const mocks = vi.hoisted(() => ({
  startGestureCapture: vi.fn(),
  setLiveParam: vi.fn(),
  triggerHaptic: vi.fn(),
  previewSample: vi.fn(),
}));

// jsdom has no 2D canvas: stub it so the overlay drawing is a no-op instead of
// emitting a "Not implemented" error for every render.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

vi.mock('~/infrastructure/gesture/GestureCapture', () => ({
  startGestureCapture: mocks.startGestureCapture,
}));

vi.mock('~/infrastructure/haptics', () => ({
  triggerHaptic: mocks.triggerHaptic,
  triggerSnapPulse: vi.fn(),
  cancelHaptic: vi.fn(),
}));

vi.mock('../state/audioActions', () => ({
  previewSample: mocks.previewSample,
  scheduleGridEdit: vi.fn(),
}));

vi.mock('~/infrastructure/composition', async () => {
  const { Effect, Layer } = await import('effect');
  const { AudioEngine } = await import('~/domain/services');
  return {
    AppLayer: Layer.succeed(AudioEngine, {
      eval: () => Effect.void,
      stop: () => Effect.void,
      compileAndQuery: () => Effect.succeed([]),
      setCps: () => Effect.void,
      setLayerMix: () => Effect.void,
      setScore: () => Effect.void,
      setLiveParam: mocks.setLiveParam,
      getCycleProgress: () => Effect.succeed(0),
      getCyclePosition: () => Effect.succeed(0),
      getActiveHaps: () => Effect.succeed([]),
      recordLive: () => Effect.die('not used'),
      renderOffline: () => Effect.die('not used'),
    }),
  };
});

import { GesturePanel } from './GesturePanel';
import { installGestureController } from '../state/gestureStore';

let captureOptions: GestureCaptureOptions | null = null;

/** A synthetic pinch frame (thumb tip on the index tip). */
const pinchFrame = (tsMs: number): HandFrame => {
  const point = (x: number, y: number): Landmark => ({ x, y, z: 0 });
  const landmarks: Landmark[] = [
    point(0.5, 0.8),
    point(0.46, 0.78),
    point(0.43, 0.72),
    point(0.41, 0.67),
    point(0.42, 0.545),
    point(0.42, 0.62),
    point(0.42, 0.57),
    point(0.42, 0.555),
    point(0.42, 0.545),
    point(0.5, 0.6),
    point(0.5, 0.55),
    point(0.5, 0.535),
    point(0.5, 0.525),
    point(0.58, 0.62),
    point(0.58, 0.57),
    point(0.58, 0.555),
    point(0.58, 0.545),
    point(0.66, 0.64),
    point(0.66, 0.59),
    point(0.66, 0.575),
    point(0.66, 0.565),
  ];
  return { tsMs, handedness: 'Right', landmarks, worldLandmarks: [] };
};

describe('GesturePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureOptions = null;
    mocks.startGestureCapture.mockImplementation(async (options: GestureCaptureOptions) => {
      captureOptions = options;
      return { stop: vi.fn(), status: () => 'running' as const };
    });
    installGestureController({ detectorOptions: { holdFrames: 1, minHoldMs: 0 } });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the master toggle, switched off, and does not start the camera', () => {
    const { container } = render(() => <GesturePanel />);

    const toggle = container.querySelector<HTMLButtonElement>('[data-cta="toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(mocks.startGestureCapture).not.toHaveBeenCalled();

    // The status line starts at "выключено".
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('выключено');
  });

  it('starts the camera when the toggle is clicked', async () => {
    const { container } = render(() => <GesturePanel />);

    const toggle = container.querySelector<HTMLButtonElement>('[data-cta="toggle"]');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.startGestureCapture).toHaveBeenCalledTimes(1);
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the status and the recognised gesture from the store', async () => {
    const { container } = render(() => <GesturePanel />);

    const toggle = container.querySelector<HTMLButtonElement>('[data-cta="toggle"]');
    fireEvent.click(toggle as HTMLButtonElement);
    await Promise.resolve();
    await Promise.resolve();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('рука в кадре');

    captureOptions?.onFrame(pinchFrame(1000));
    await Promise.resolve();

    const readout = container.querySelector('[data-readout="gesture"]');
    expect(readout?.textContent).toContain('pinch');
  });

  it('exposes the axis list, the calibration buttons and the term-mode switch', () => {
    const { container } = render(() => <GesturePanel />);

    expect(container.querySelector('[data-axis-select]')).not.toBeNull();
    expect(container.querySelector('[data-axis-invert]')).not.toBeNull();
    expect(container.querySelector('[data-axis-curve]')).not.toBeNull();
    expect(container.querySelector('[data-cta="sensitivity"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="calibrate-near"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="calibrate-far"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="calibrate-reset"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="two-hands"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="term-mode"]')).not.toBeNull();
    expect(container.querySelector('[data-cta="term-commit"]')).not.toBeNull();
  });
});
