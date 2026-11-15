import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ControlEvent, HandFrame, Landmark } from '~/domain/gesture/types';
import type { GestureCaptureOptions } from '~/infrastructure/gesture/GestureCapture';

/**
 * gestureStore — the camera → features → mapping → audio bridge.
 *
 * The camera is mocked (`~/infrastructure/gesture/GestureCapture`) so the
 * test can push synthetic frames by hand; the audio engine is mocked through
 * the composition root (`~/infrastructure/composition`) so `setLiveParam` is
 * observable.
 */

const mocks = vi.hoisted(() => ({
  startGestureCapture: vi.fn(),
  setLiveParam: vi.fn(),
  triggerHaptic: vi.fn(),
  previewSample: vi.fn(),
}));

vi.mock('~/infrastructure/gesture/GestureCapture', () => ({
  startGestureCapture: mocks.startGestureCapture,
}));

vi.mock('~/infrastructure/haptics', () => ({
  triggerHaptic: mocks.triggerHaptic,
  triggerSnapPulse: vi.fn(),
  cancelHaptic: vi.fn(),
}));

vi.mock('./audioActions', () => ({
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

import {
  installGestureController,
  gestureStatus,
  gestureEnabled,
  gestureLiveValues,
  gestureTermHits,
  setGestureTermMode,
  type GestureController,
} from './gestureStore';

/** Options the mocked capture was called with — the frame sink of the test. */
let captureOptions: GestureCaptureOptions | null = null;

/**
 * Build a synthetic 21-landmark hand.
 *
 * The geometry is chosen so the domain features are predictable:
 *   - `palmSize = |P9 - P0| = 0.2` → `closeness = 1 / 0.2 = 5`
 *   - every finger gets the SAME extension ratio → `openness = extension`
 *   - `pinch` puts the thumb tip exactly on the index tip → `pinch = 1`
 */
const makeHand = (opts: { extension: number; pinch: boolean; tsMs: number }): HandFrame => {
  const point = (x: number, y: number): Landmark => ({ x, y, z: 0 });
  const extension = opts.extension;
  const landmarks: Landmark[] = [
    point(0.5, 0.8), // 0  wrist
    point(0.46, 0.78), // 1  thumb CMC
    point(0.43, 0.72), // 2  thumb MCP
    point(0.41, 0.67), // 3  thumb IP
    point(0.38, 0.62), // 4  thumb TIP (replaced below when pinching)
    point(0.42, 0.62), // 5  index MCP
    point(0.42, 0.57), // 6  index PIP
    point(0.42, 0.57 - 0.03 * extension), // 7  index DIP
    point(0.42, 0.57 - 0.05 * extension), // 8  index TIP
    point(0.5, 0.6), // 9  middle MCP
    point(0.5, 0.55), // 10 middle PIP
    point(0.5, 0.55 - 0.03 * extension), // 11 middle DIP
    point(0.5, 0.55 - 0.05 * extension), // 12 middle TIP
    point(0.58, 0.62), // 13 ring MCP
    point(0.58, 0.57), // 14 ring PIP
    point(0.58, 0.57 - 0.03 * extension), // 15 ring DIP
    point(0.58, 0.57 - 0.05 * extension), // 16 ring TIP
    point(0.66, 0.64), // 17 pinky MCP
    point(0.66, 0.59), // 18 pinky PIP
    point(0.66, 0.59 - 0.03 * extension), // 19 pinky DIP
    point(0.66, 0.59 - 0.05 * extension), // 20 pinky TIP
  ];
  if (opts.pinch) {
    const indexTip = landmarks[8];
    if (indexTip !== undefined) landmarks[4] = indexTip;
  }
  return {
    tsMs: opts.tsMs,
    handedness: 'Right',
    landmarks,
    worldLandmarks: [],
  };
};

/** Push one synthetic frame into the mocked capture. */
const pushFrame = (frame: HandFrame): void => {
  captureOptions?.onFrame(frame);
};

/**
 * Flush the microtask queue.
 *
 * `pushLiveParam` and the cycle-progress read go through `Effect.runPromise`,
 * so the call lands a microtask later. `advanceTimersByTimeAsync(0)` drains
 * the microtask queue without moving the clock.
 */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('gestureStore', () => {
  let controller: GestureController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    captureOptions = null;
    mocks.startGestureCapture.mockImplementation(async (options: GestureCaptureOptions) => {
      captureOptions = options;
      return { stop: vi.fn(), status: () => 'running' as const };
    });
    controller = installGestureController({
      detectorOptions: { holdFrames: 1, minHoldMs: 0 },
    });
  });

  afterEach(() => {
    controller.disable();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not start the camera until the feature is enabled', async () => {
    expect(mocks.startGestureCapture).not.toHaveBeenCalled();
    expect(gestureEnabled()).toBe(false);
    expect(gestureStatus()).toBe('idle');

    await controller.enable();

    expect(mocks.startGestureCapture).toHaveBeenCalledTimes(1);
    expect(gestureEnabled()).toBe(true);
    expect(gestureStatus()).toBe('running');
  });

  it('pushes a continuous event to the live audio engine with a clamped value', async () => {
    await controller.enable();

    pushFrame(makeHand({ extension: 0.5, pinch: false, tsMs: 1000 }));
    await flush();

    const gainCalls = mocks.setLiveParam.mock.calls.filter(
      (call) => (call[0] as { param: string }).param === 'gain',
    );
    expect(gainCalls.length).toBeGreaterThan(0);

    const lastGain = gainCalls[gainCalls.length - 1]?.[0] as {
      scope: { scope: string };
      param: string;
      value: number;
      rampMs: number;
    };
    expect(lastGain.scope.scope).toBe('master');
    expect(lastGain.value).toBeGreaterThanOrEqual(0);
    expect(lastGain.value).toBeLessThanOrEqual(1.5);
    expect(lastGain.rampMs).toBeGreaterThan(0);

    // The normalised value is tracked for the panel as well.
    expect(gestureLiveValues().volume).toBeCloseTo(0.5, 2);
  });

  it('emits exactly one discrete event and one haptic tick for a pinch', async () => {
    const events: ControlEvent[] = [];
    controller = installGestureController({
      detectorOptions: { holdFrames: 1, minHoldMs: 0 },
      onControlEvent: (event) => events.push(event),
    });
    await controller.enable();

    pushFrame(makeHand({ extension: 0.5, pinch: true, tsMs: 1000 }));
    pushFrame(makeHand({ extension: 0.5, pinch: true, tsMs: 1040 }));
    pushFrame(makeHand({ extension: 0.5, pinch: true, tsMs: 1080 }));
    await flush();

    const discrete = events.filter((event) => event.kind === 'discrete');
    expect(discrete).toHaveLength(1);
    expect(discrete[0]).toMatchObject({ kind: 'discrete', gesture: 'pinch' });
    expect(mocks.triggerHaptic).toHaveBeenCalledTimes(1);
    expect(mocks.triggerHaptic).toHaveBeenCalledWith(5);
  });

  it('plays the drum sample on the quantised grid position', async () => {
    await controller.enable();

    pushFrame(makeHand({ extension: 0.5, pinch: true, tsMs: 1000 }));
    await flush();

    // The hit is scheduled on the next 1/8 of the cycle (cps = 0.5 → a
    // 2 s cycle), so it fires within the next cycle at the latest.
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.previewSample).toHaveBeenCalledWith('bd');
  });

  it('records the hits in term mode and commits them into the grid', async () => {
    setGestureTermMode(true);
    await controller.enable();

    pushFrame(makeHand({ extension: 0.5, pinch: true, tsMs: 1000 }));
    await flush();

    expect(gestureTermHits()).toHaveLength(1);
    expect(gestureTermHits()[0]).toMatchObject({ sample: 'bd' });
    expect(gestureTermHits()[0]?.col).toBeGreaterThanOrEqual(0);
    expect(gestureTermHits()[0]?.col).toBeLessThan(8);
  });

  it('resets the master gain to 1 when the feature is disabled', async () => {
    await controller.enable();
    pushFrame(makeHand({ extension: 0.5, pinch: false, tsMs: 1000 }));
    await flush();

    controller.disable();
    await flush();

    const gainCalls = mocks.setLiveParam.mock.calls.filter(
      (call) => (call[0] as { param: string }).param === 'gain',
    );
    const lastGain = gainCalls[gainCalls.length - 1]?.[0] as { value: number };
    expect(lastGain.value).toBe(1);
    expect(gestureEnabled()).toBe(false);
    expect(gestureStatus()).toBe('idle');
  });

  it('reports the camera error when the capture cannot be started', async () => {
    mocks.startGestureCapture.mockRejectedValueOnce(
      new Error('Доступ к камере запрещён (camera permission denied)'),
    );

    await controller.enable();

    expect(gestureStatus()).toBe('error');
    expect(gestureEnabled()).toBe(false);
  });
});
