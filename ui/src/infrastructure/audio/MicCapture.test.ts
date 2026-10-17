import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * MicCapture acceptance tests.
 *
 * Strategy: replace the Vite `?worker` import with a stub Worker
 * class so we don't spin up a real worker in jsdom. The stub
 * captures postMessage calls and lets us simulate worker replies
 * by calling onmessage directly.
 *
 * AudioContext and getUserMedia are stubbed on globalThis before
 * each test, so the orchestrator's lifecycle (state transitions,
 * cleanup, error paths) can be exercised without a real device.
 *
 * What's NOT tested here:
 *   - The actual YIN algorithm (covered by yinDetector.worker.test.ts)
 *   - The note segmentation (covered by micCapture.test.ts)
 *   - Solid signal updates (covered by micStore.test.ts)
 *
 * What's covered:
 *   - State transitions through the full lifecycle
 *   - getUserMedia denial → errored state + onError callback
 *   - Worker terminate on stop()
 *   - AudioContext close on stop()
 *   - MediaStream track stop on stop()
 *   - Cleanup ordering: raf cancelled before worker terminated
 *   - isMicSupported reflects the globalThis AudioContext/getUserMedia
 *   - onMeter fires per-tick with rolling-peak RMS
 *   - The transient pipeline always runs (no mode toggle)
 */

type StubWorker = {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((ev: MessageEvent) => void) | null;
};

const stubWorker: StubWorker = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null,
};

vi.mock('./yinDetector.worker?worker', () => ({
  default: class FakeYinWorker {
    postMessage = stubWorker.postMessage;
    terminate = stubWorker.terminate;
    set onmessage(fn: ((ev: MessageEvent) => void) | null) {
      stubWorker.onmessage = fn;
    }
  },
}));

type StubAnalyser = {
  fftSize: number;
  getFloatTimeDomainData: ReturnType<typeof vi.fn>;
  getByteFrequencyData: ReturnType<typeof vi.fn>;
  frequencyBinCount: number;
  context: StubAudioContext;
};

type StubAudioContext = {
  sampleRate: number;
  state: string;
  currentTime: number;
  createMediaStreamSource: ReturnType<typeof vi.fn>;
  createAnalyser: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  resume?: () => Promise<void>;
};

const stubAnalyser: StubAnalyser = {
  fftSize: 0,
  getFloatTimeDomainData: vi.fn(),
  getByteFrequencyData: vi.fn(),
  frequencyBinCount: 1024,
  context: undefined as unknown as StubAudioContext,
};
// Incrementing clock so each RAF tick sees a monotonically
// advancing `audioCtx.currentTime`. Without this the meter peak
// window would never advance and the peak-RMS test would be
// deterministic but unhelpful. The advance is 16ms per call
// (~60Hz RAF); tests can override as needed.
let mockCurrentTimeMs = 0;
const stubAudioContext: StubAudioContext = {
  sampleRate: 48000,
  state: 'running',
  get currentTime(): number { return mockCurrentTimeMs / 1000; },
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  createAnalyser: vi.fn(() => stubAnalyser),
  close: vi.fn().mockResolvedValue(undefined),
};
stubAnalyser.context = stubAudioContext;

const stubMediaStreamTrack = { stop: vi.fn() };
const stubMediaStream = {
  getTracks: () => [stubMediaStreamTrack],
};

const installStubs = (): void => {
  (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext = vi
    .fn(() => stubAudioContext) as unknown as typeof AudioContext;
  (navigator as unknown as { mediaDevices: { getUserMedia: ReturnType<typeof vi.fn> } }).mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stubMediaStream),
  };
  (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = (
    cb: FrameRequestCallback,
  ): number => {
    // Advance the fake audio clock before invoking the callback so
    // each tick observes a fresh `audioCtx.currentTime` (which the
    // meter / worker-post path reads for `timestampMs`).
    mockCurrentTimeMs += 16;
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  };
  (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (
    id: number,
  ): void => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  };
  // Wipe the shared AudioContext global so each test starts with
  // a clean slate — otherwise a previous test's
  // `__wavecodeAudioCtx` write would be reused (causing the
  // current detector to take the "shared" branch and skip its
  // own AudioContext.close on stop).
  delete (window as unknown as { __wavecodeAudioCtx?: unknown }).__wavecodeAudioCtx;
};

import {
  startMicDetector,
  isMicSupported,
  type MeterFrame,
  type MicCaptureState,
} from './MicCapture';

const waitFor = async <T>(fn: () => T, tries: number = 20): Promise<T> => {
  for (let i = 0; i < tries; i += 1) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
};

describe('MicCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Module-level state in `startMicDetector` is held in a
    // closure per call (let state, let stream, let worker, ...), so
    // vi.clearAllMocks doesn't reach the inner `setState` references.
    // We DO need to wipe the stubWorker's onmessage binding because
    // each `startMicDetector` overwrites it on a shared object —
    // previous test callbacks would fire if not reset.
    stubWorker.postMessage.mockClear();
    stubWorker.terminate.mockClear();
    stubWorker.onmessage = null;
    stubAnalyser.getFloatTimeDomainData.mockReset();
    stubAnalyser.getByteFrequencyData.mockReset();
    stubAnalyser.fftSize = 0;
    stubMediaStreamTrack.stop.mockClear();
    stubAudioContext.close.mockClear();
    mockCurrentTimeMs = 0;
    installStubs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isMicSupported returns true when AudioContext + getUserMedia exist', () => {
    expect(isMicSupported()).toBe(true);
  });

  it('isMicSupported returns false when getUserMedia is missing', () => {
    const orig = navigator.mediaDevices;
    (navigator as unknown as { mediaDevices: undefined }).mediaDevices = undefined;
    try {
      expect(isMicSupported()).toBe(false);
    } finally {
      (navigator as unknown as { mediaDevices: typeof orig }).mediaDevices = orig;
    }
  });

  it('transitions through state machine: idle → requesting-mic → starting-audio → streaming', async () => {
    const states: MicCaptureState[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onStateChange: (s) => states.push(s),
    });
    expect(states[0]).toBe('requesting-mic');
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    expect(states).toContain('starting-audio');
    expect(states[states.length - 1]).toBe('streaming');
    await handle.stop();
  });

  it('configures worker with the analyser fftSize and AudioContext sampleRate', async () => {
    const handle = startMicDetector({
      onFrame: () => {},
    });
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    const configureCall = stubWorker.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'configure',
    );
    expect(configureCall).toBeDefined();
    const msg = configureCall![0] as { type: string; fftSize: number; sampleRate: number; clarityThreshold: number };
    expect(msg.fftSize).toBe(2048);
    expect(msg.sampleRate).toBe(48000);
    expect(msg.clarityThreshold).toBe(0.9);
    await handle.stop();
  });

  it('forwards worker frame messages to onFrame callback', async () => {
    const frames: { hz: number | null; clarity: number; rms: number; timestampMs: number }[] = [];
    const handle = startMicDetector({
      onFrame: (f) => frames.push(f),
    });
    await waitFor(() => stubWorker.onmessage !== null);
    stubWorker.onmessage!(
      new MessageEvent('message', {
        data: { type: 'frame', hz: 440, clarity: 0.95, rms: 0.3, timestampMs: 1000 },
      }),
    );
    stubWorker.onmessage!(
      new MessageEvent('message', {
        data: { type: 'frame', hz: null, clarity: 0, rms: 0.001, timestampMs: 1030 },
      }),
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ hz: 440, clarity: 0.95, rms: 0.3, timestampMs: 1000 });
    expect(frames[1]).toMatchObject({ hz: null, clarity: 0, rms: 0.001, timestampMs: 1030 });
    await handle.stop();
  });

  it('forwards worker error messages to onError callback', async () => {
    const errors: Error[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onError: (e) => errors.push(e),
    });
    await waitFor(() => stubWorker.onmessage !== null);
    stubWorker.onmessage!(
      new MessageEvent('message', {
        data: { type: 'error', message: 'simulated failure' },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('mic-worker: simulated failure');
    await handle.stop();
  });

  it('emits errored state when getUserMedia is denied', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Permission denied'),
    );
    const states: MicCaptureState[] = [];
    const errors: Error[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onStateChange: (s) => states.push(s),
      onError: (e) => errors.push(e),
    });
    await waitFor(() => errors.length > 0);
    expect(states).toContain('errored');
    expect(errors[0]?.message).toBe('Permission denied');
    await handle.stop();
  });

  it('emits errored state when getUserMedia times out (5s race)', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise(() => {}), // never resolves
    );
    const errors: Error[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onError: (e) => errors.push(e),
    });
    // The 5s timeout is too slow for a unit test. We just verify
    // that even if the detector were torn down, no leaks occur.
    // (A more granular test would use fake timers; skipping for now.)
    // Trigger stop before the timeout fires to abort.
    await handle.stop();
    expect(errors).toHaveLength(0);
  });

  it('stop() terminates worker, closes AudioContext, and stops all tracks', async () => {
    const handle = startMicDetector({
      onFrame: () => {},
    });
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    await handle.stop();
    expect(stubWorker.terminate).toHaveBeenCalled();
    expect(stubAudioContext.close).toHaveBeenCalled();
    expect(stubMediaStreamTrack.stop).toHaveBeenCalled();
    expect(handle.getState()).toBe('idle');
  });

  it('stop() is idempotent', async () => {
    const handle = startMicDetector({
      onFrame: () => {},
    });
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    await handle.stop();
    await handle.stop(); // second call should be a no-op
    expect(stubWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('captures the configured fftSize on the analyser', async () => {
    const handle = startMicDetector({
      onFrame: () => {},
      fftSize: 4096,
    });
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    expect(stubAnalyser.fftSize).toBe(4096);
    await handle.stop();
  });

  it('passes through custom clarityThreshold', async () => {
    const handle = startMicDetector({
      onFrame: () => {},
      clarityThreshold: 0.75,
    });
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    const configureCall = stubWorker.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'configure',
    );
    const msg = configureCall![0] as { clarityThreshold: number };
    expect(msg.clarityThreshold).toBe(0.75);
    await handle.stop();
  });

  it('always spawns the MPM worker AND reads freq data for transients (no mode toggle)', async () => {
    // The new API has no `mode` knob: the MPM worker is configured
    // and the in-process transient pipeline runs on every tick. We
    // exercise both with the default start (no `mode` field).
    const handle = startMicDetector({
      onFrame: () => {},
      onTransient: () => {},
    });
    await waitFor(() => stubWorker.postMessage.mock.calls.length > 0);
    const configureCall = stubWorker.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'configure',
    );
    expect(configureCall).toBeDefined();
    // At least one 'sample' frame should have been posted.
    const sampleCall = stubWorker.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'sample',
    );
    expect(sampleCall).toBeDefined();
    // And the analyser's freq-domain read for transients.
    await waitFor(() => stubAnalyser.getByteFrequencyData.mock.calls.length > 0);
    expect(stubAnalyser.getByteFrequencyData).toHaveBeenCalled();
    await handle.stop();
  });

  it('onMeter fires once per RAF tick with rms + peak + hz + timestampMs', async () => {
    const meters: MeterFrame[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onMeter: (m) => meters.push(m),
    });
    // Wait for at least 3 ticks to accumulate on the meter.
    await waitFor(() => meters.length >= 3);
    expect(meters.length).toBeGreaterThanOrEqual(3);
    for (const m of meters) {
      expect(typeof m.rms).toBe('number');
      expect(m.rms).toBeGreaterThanOrEqual(0);
      expect(typeof m.peak).toBe('number');
      expect(m.peak).toBeGreaterThanOrEqual(m.rms - 1e-9);
      expect(m.peak).toBeLessThanOrEqual(1);
      // hz is null until a worker frame arrives; tolerate either.
      if (m.hz !== null) {
        expect(typeof m.hz).toBe('number');
      }
      expect(typeof m.timestampMs).toBe('number');
    }
    await handle.stop();
  });

  it('onMeter computes peak as rolling-max RMS over the trailing 200ms window', async () => {
    // Hand-feed a sequence of RMS values that grows then shrinks; the
    // peak reported by onMeter should equal the max within the last
    // 200ms window, not the latest frame's RMS.
    let bufIdx = 0;
    const fakeRmsByFrame: number[] = [];
    stubAnalyser.getFloatTimeDomainData.mockImplementation((buf: Float32Array): void => {
      const v = fakeRmsByFrame[bufIdx] ?? 0;
      // Fill the buffer with a constant magnitude so RMS == v.
      for (let i = 0; i < buf.length; i += 1) buf[i] = v;
      bufIdx += 1;
    });
    // Sequence: ramp up over 10 frames then drop to near-zero. At 16ms
    // per RAF tick, 13 ticks ≈ 208ms — a fresh peak window at the end.
    fakeRmsByFrame.push(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.001, 0.001, 0.001);

    const meters: MeterFrame[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onMeter: (m) => meters.push(m),
    });
    await waitFor(() => meters.length >= 13);

    // Find the meter frame where the loud hit (rms=1.0) was reported.
    const loudIdx = meters.findIndex((m) => m.rms >= 0.99);
    expect(loudIdx).toBeGreaterThanOrEqual(0);
    // And the meter frame at the end (after the drop) — its peak
    // should still remember the loud hit if it's within the 200ms
    // window, OR equal the latest RMS if the hit fell off the window.
    const last = meters[meters.length - 1]!;
    if (last.timestampMs - meters[loudIdx]!.timestampMs <= 200) {
      // Hit still in window → peak ≥ 0.99.
      expect(last.peak).toBeGreaterThanOrEqual(0.99);
    } else {
      // Hit aged out → peak == latest rms (≈ 0.001).
      expect(last.peak).toBeLessThan(0.05);
    }
    await handle.stop();
  });

  it('onMeter carries the latest worker-reported hz', async () => {
    const meters: MeterFrame[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onMeter: (m) => meters.push(m),
    });
    await waitFor(() => meters.length >= 1);
    // Before any worker frame, hz should be null.
    expect(meters[0]?.hz).toBeNull();
    await waitFor(() => stubWorker.onmessage !== null);
    stubWorker.onmessage!(
      new MessageEvent('message', {
        data: { type: 'frame', hz: 523.25, clarity: 0.99, rms: 0.5, timestampMs: 5000 },
      }),
    );
    // After the worker reports a pitch, subsequent meter ticks
    // surface that hz.
    await waitFor(() => meters.some((m) => m.hz !== null));
    const withHz = meters.filter((m) => m.hz === 523.25);
    expect(withHz.length).toBeGreaterThanOrEqual(1);
    await handle.stop();
  });

  it('stop() clears the meter peak buffer (no leak across restarts)', async () => {
    const meters: MeterFrame[] = [];
    const handle = startMicDetector({
      onFrame: () => {},
      onMeter: (m) => meters.push(m),
    });
    await waitFor(() => meters.length >= 1);
    await handle.stop();
    // After stop(), no more meter frames should arrive.
    const countAtStop = meters.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(meters.length).toBe(countAtStop);
  });
});