import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startGestureCapture, type GestureCaptureOptions } from './GestureCapture';

/**
 * GestureCapture acceptance tests.
 *
 * Strategy:
 *   - `@mediapipe/tasks-vision` is mocked, so no wasm runtime and no
 *     model download are needed. The fake landmarker records the
 *     timestamps it was called with and returns a canned result.
 *   - `navigator.mediaDevices.getUserMedia` is stubbed with a fake
 *     MediaStream whose tracks record `stop()` calls.
 *   - `requestAnimationFrame` is replaced with a manual queue, so the
 *     test decides exactly when a frame is delivered (no sleeping,
 *     no flaky timing).
 *   - `performance.now()` is a manual clock and
 *     `HTMLMediaElement.prototype.currentTime` is a manual value, so
 *     "the camera delivered a new frame" is an explicit test input.
 *   - `HTMLMediaElement.play()/pause()` are stubbed: jsdom does not
 *     implement media playback.
 *
 * What's covered:
 *   - status transitions idle -> starting -> running -> stopped
 *   - result -> HandFrame mapping (landmarks, worldLandmarks,
 *     handedness, tsMs)
 *   - detectForVideo receives strictly increasing timestamps
 *   - a frame is skipped when video.currentTime did not advance
 *   - stop() stops every track, closes the landmarker and cancels rAF
 *   - getUserMedia rejection -> clear error + status 'error'
 *   - the camera is never opened twice
 *
 * What's NOT tested here:
 *   - the actual MediaPipe inference (that is MediaPipe's job)
 *   - gesture classification (domain/gesture)
 */

/** MediaPipe result shape as produced by the fake landmarker. */
type FakeLandmark = { x: number; y: number; z: number; visibility?: number };
type FakeResult = {
  landmarks: FakeLandmark[][];
  worldLandmarks: FakeLandmark[][];
  handedness: Array<Array<{ categoryName: string; score: number }>>;
};

const EMPTY_RESULT: FakeResult = {
  landmarks: [],
  worldLandmarks: [],
  handedness: [],
};

// `vi.mock` factories are hoisted above the imports, so the spies have
// to live in a `vi.hoisted` block to be reachable from the factory.
const mocks = vi.hoisted(() => ({
  detectForVideo: vi.fn(),
  close: vi.fn(),
  createFromOptions: vi.fn(),
  forVisionTasks: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: mocks.forVisionTasks,
  },
  HandLandmarker: {
    createFromOptions: mocks.createFromOptions,
  },
}));

/** Frame type, derived from the capture API (no direct domain import). */
type CapturedFrame = Parameters<GestureCaptureOptions['onFrame']>[0];

type FakeTrack = { kind: string; stop: ReturnType<typeof vi.fn> };

type FakeStream = {
  stream: MediaStream;
  tracks: FakeTrack[];
};

const createFakeStream = (trackCount = 2): FakeStream => {
  const tracks: FakeTrack[] = Array.from({ length: trackCount }, () => ({
    kind: 'video',
    stop: vi.fn(),
  }));
  const stream = {
    getTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks };
};

let getUserMedia: ReturnType<typeof vi.fn>;
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId: number;
let nowMs: number;
let videoTime: number;
let originalCurrentTime: PropertyDescriptor | undefined;

/** Deliver one animation frame to whatever is queued. */
const flushFrame = (): void => {
  const pending = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of pending) cb(nowMs);
};

const startedHandles: Array<{ stop: () => void }> = [];

const start = async (
  overrides: Partial<GestureCaptureOptions> = {},
): Promise<{ stop: () => void; status: () => string }> => {
  const handle = await startGestureCapture({
    onFrame: () => {},
    onStatus: () => {},
    onError: () => {},
    ...overrides,
  });
  startedHandles.push(handle);
  return handle;
};

beforeEach(() => {
  mocks.detectForVideo.mockReset();
  mocks.detectForVideo.mockReturnValue(EMPTY_RESULT);
  mocks.close.mockReset();
  mocks.createFromOptions.mockReset();
  mocks.createFromOptions.mockResolvedValue({
    detectForVideo: mocks.detectForVideo,
    close: mocks.close,
  });
  mocks.forVisionTasks.mockReset();
  mocks.forVisionTasks.mockResolvedValue({
    wasmLoaderPath: '/mediapipe/wasm/vision_wasm_internal.js',
    wasmBinaryPath: '/mediapipe/wasm/vision_wasm_internal.wasm',
  });

  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  rafCallbacks = new Map();
  nextRafId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafCallbacks.delete(id);
  });

  nowMs = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

  videoTime = 0;
  originalCurrentTime = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'currentTime',
  );
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => videoTime,
    set: () => {},
  });

  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const handle of startedHandles) {
    try {
      handle.stop();
    } catch {
      /* already stopped */
    }
  }
  startedHandles.length = 0;
  if (originalCurrentTime !== undefined) {
    Object.defineProperty(
      HTMLMediaElement.prototype,
      'currentTime',
      originalCurrentTime,
    );
  } else {
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).currentTime;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startGestureCapture', () => {
  it('reports idle -> starting -> running and stops to stopped', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    const statuses: string[] = [];
    const handle = await start({ onStatus: (s) => statuses.push(s) });

    expect(statuses).toEqual(['idle', 'starting', 'running']);
    expect(handle.status()).toBe('running');

    handle.stop();
    expect(statuses).toEqual(['idle', 'starting', 'running', 'stopped']);
    expect(handle.status()).toBe('stopped');
  });

  it('opens the camera once with the configured constraints', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    await start({
      config: { camera: { width: 800, height: 600, frameRate: 24 } },
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { width: 800, height: 600, frameRate: 24 },
    });
  });

  it('maps a MediaPipe result to HandFrames', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    mocks.detectForVideo.mockReturnValue({
      landmarks: [[{ x: 0.1, y: 0.2, z: 0.3, visibility: 1 }]],
      worldLandmarks: [[{ x: -0.01, y: 0.02, z: 0.03, visibility: 1 }]],
      handedness: [[{ categoryName: 'Right', score: 0.98 }]],
    } satisfies FakeResult);

    const frames: CapturedFrame[] = [];
    await start({ onFrame: (frame) => frames.push(frame) });

    nowMs += 40;
    videoTime = 0.5;
    flushFrame();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      tsMs: 1040,
      handedness: 'Right',
      landmarks: [{ x: 0.1, y: 0.2, z: 0.3 }],
      worldLandmarks: [{ x: -0.01, y: 0.02, z: 0.03 }],
    });
  });

  it('emits one frame per detected hand', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    mocks.detectForVideo.mockReturnValue({
      landmarks: [
        [{ x: 1, y: 2, z: 3 }],
        [{ x: 4, y: 5, z: 6 }],
      ],
      worldLandmarks: [
        [{ x: 0.1, y: 0.2, z: 0.3 }],
        [{ x: 0.4, y: 0.5, z: 0.6 }],
      ],
      handedness: [
        [{ categoryName: 'Left', score: 0.9 }],
        [{ categoryName: 'Right', score: 0.9 }],
      ],
    } satisfies FakeResult);

    const frames: CapturedFrame[] = [];
    await start({ onFrame: (frame) => frames.push(frame) });

    nowMs += 40;
    videoTime = 0.5;
    flushFrame();

    expect(frames.map((f) => f.handedness)).toEqual(['Left', 'Right']);
  });

  it('passes strictly increasing timestamps to detectForVideo', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    await start();

    nowMs += 40;
    videoTime = 0.1;
    flushFrame();
    nowMs += 40;
    videoTime = 0.2;
    flushFrame();
    nowMs += 40;
    videoTime = 0.3;
    flushFrame();

    const stamps = mocks.detectForVideo.mock.calls.map((call) => call[1] as number);
    expect(stamps).toHaveLength(3);
    expect(stamps[0]).toBeLessThan(stamps[1] as number);
    expect(stamps[1]).toBeLessThan(stamps[2] as number);
  });

  it('skips a frame when the camera delivered no new picture', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    await start();

    nowMs += 40;
    videoTime = 0.1;
    flushFrame();
    expect(mocks.detectForVideo).toHaveBeenCalledTimes(1);

    // Same video.currentTime -> nothing new to look at.
    nowMs += 40;
    flushFrame();
    expect(mocks.detectForVideo).toHaveBeenCalledTimes(1);

    // New picture -> detection resumes.
    nowMs += 40;
    videoTime = 0.2;
    flushFrame();
    expect(mocks.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it('stops every track, closes the landmarker and cancels rAF on stop()', async () => {
    const { stream, tracks } = createFakeStream(3);
    getUserMedia.mockResolvedValue(stream);

    const handle = await start();
    expect(rafCallbacks.size).toBeGreaterThan(0);

    handle.stop();

    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(rafCallbacks.size).toBe(0);

    // No further detections after stop().
    const callsAfterStop = mocks.detectForVideo.mock.calls.length;
    nowMs += 40;
    videoTime = 1;
    flushFrame();
    expect(mocks.detectForVideo.mock.calls.length).toBe(callsAfterStop);
  });

  it('maps a rejected getUserMedia to a clear error and status error', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

    const statuses: string[] = [];
    const errors: Error[] = [];

    await expect(
      startGestureCapture({
        onFrame: () => {},
        onStatus: (s) => statuses.push(s),
        onError: (e) => errors.push(e),
      }),
    ).rejects.toThrow(/camera permission/i);

    expect(statuses).toEqual(['idle', 'starting', 'error']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/camera permission/i);
  });

  it('never opens the camera twice', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    const handle = await start();

    // A second concurrent capture is refused — one webcam, one prompt.
    await expect(
      startGestureCapture({
        onFrame: () => {},
        onStatus: () => {},
        onError: () => {},
      }),
    ).rejects.toThrow(/already running/i);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // After stop() a new capture is allowed again.
    handle.stop();
    await start();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('drives a caller-supplied video element and leaves it in the DOM', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    const video = document.createElement('video');
    document.body.appendChild(video);

    const handle = await start({ videoElement: video });
    expect(video.srcObject).toBe(stream);

    handle.stop();
    expect(video.srcObject).toBe(null);
    expect(document.body.contains(video)).toBe(true);
    video.remove();
  });

  it('maps the twoHands toggle onto numHands', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    const first = await start({ twoHands: false });
    expect(mocks.createFromOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ numHands: 1, runningMode: 'VIDEO' }),
    );
    first.stop();

    mocks.createFromOptions.mockClear();
    await start({ twoHands: true });
    expect(mocks.createFromOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ numHands: 2 }),
    );
  });

  it('lets an explicit config.numHands win over the twoHands toggle', async () => {
    const { stream } = createFakeStream();
    getUserMedia.mockResolvedValue(stream);

    await start({ twoHands: false, config: { numHands: 2 } });
    expect(mocks.createFromOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ numHands: 2 }),
    );
  });
});
