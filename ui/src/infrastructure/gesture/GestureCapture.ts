import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandFrame } from '~/domain/gesture/types';
import {
  resolveGestureConfig,
  type GestureCaptureConfig,
  type ResolvedGestureCaptureConfig,
} from './gestureConfig';

/**
 * GestureCapture — webcam hand-gesture capture.
 *
 * Responsibilities (thin by design):
 *   1. `getUserMedia({ video })` with the configured constraints
 *   2. a hidden <video> element fed by that stream
 *   3. a lazily imported MediaPipe Hand Landmarker (wasm + model are
 *      served from our own origin — see `gestureConfig.ts`)
 *   4. a requestAnimationFrame loop that runs the landmarker in VIDEO
 *      mode and maps every detected hand to a `HandFrame`
 *   5. lifetime: `stop()` releases the camera, the video element and
 *      the landmarker. The camera indicator MUST go dark when the
 *      feature is switched off, so teardown is unconditional.
 *
 * What's NOT here:
 *   - gesture classification (fist / pinch / point) — that lives in
 *     `domain/gesture`
 *   - any UI state — `presentation/`
 *
 * MediaPipe specifics worth knowing
 * ---------------------------------
 *   - There is NO async "live stream" mode in the browser API: the
 *     task runs in IMAGE or VIDEO mode. VIDEO mode takes the
 *     timestamp from the caller and requires it to be STRICTLY
 *     increasing, so the timestamps are bumped when the clock has not
 *     moved (`Math.max(now, lastTsMs + 1)`).
 *   - The official web pattern skips a frame when
 *     `video.currentTime` did not advance — the camera delivers ~30
 *     new frames per second while rAF fires ~60 times per second, so
 *     half of the ticks have nothing new to look at.
 *   - `detectForVideo` is synchronous, so a slow device stalls the
 *     main thread for the duration of one inference. The delegate
 *     (CPU/GPU) is therefore a measured knob, not a preference — see
 *     the note in `gestureConfig.ts`.
 *
 * Error contract
 * --------------
 * `startGestureCapture` REJECTS when the capture cannot be started
 * (camera denied, model missing, wasm unreachable). The rejection
 * carries the same `Error` that is passed to `onError`, and the
 * status goes to 'error'. Runtime failures inside the detection loop
 * are reported through `onError` only — the promise has already
 * resolved by then.
 *
 * The camera is opened at most once per capture, and a second
 * concurrent capture is refused: one webcam, one prompt, one stream.
 */

/** Lifecycle of a capture. */
export type GestureCaptureStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

/** Callbacks and overrides handed to `startGestureCapture`. */
export type GestureCaptureOptions = {
  /** Called once per detected hand, per detection. */
  readonly onFrame: (frame: HandFrame) => void;
  /** Called on every status transition. */
  readonly onStatus: (status: GestureCaptureStatus) => void;
  /** Called with every error (startup failure or runtime failure). */
  readonly onError: (error: Error) => void;
  /** Overrides for the capture configuration. */
  readonly config?: Partial<GestureCaptureConfig>;
  /**
   * Convenience toggle: `false` tracks a single hand, `true` (the
   * default) tracks two. Equivalent to `config.numHands`, but it is
   * what a "две руки" UI switch can hand over directly. An explicit
   * `config.numHands` wins over this flag.
   */
  readonly twoHands?: boolean;
  /**
   * A <video> element owned by the CALLER (e.g. the camera preview
   * in the gesture panel). The capture feeds it with the camera
   * stream and leaves it in the DOM when it stops — the caller stays
   * responsible for showing and hiding it. When omitted, the capture
   * creates its own hidden element and removes it on stop().
   */
  readonly videoElement?: HTMLVideoElement | null;
};

/** Handle returned by a successful `startGestureCapture`. */
export type GestureCaptureHandle = {
  /** Release the camera, the video element and the landmarker. Idempotent. */
  stop: () => void;
  /** Current status of the capture. */
  readonly status: () => GestureCaptureStatus;
};

/**
 * Module-level guard: one webcam, one capture. Set synchronously
 * when a capture starts and released when it stops or fails, so a
 * second concurrent start is refused instead of opening a second
 * stream behind the user's back.
 */
let captureActive = false;

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

/**
 * The camera error the user actually needs to see: what failed, and
 * what to do about it.
 */
const cameraPermissionError = (err: unknown): Error => {
  const name = err instanceof Error ? err.name : '';
  const detail = err instanceof Error ? err.message : String(err);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new Error(
      'Доступ к камере запрещён (camera permission denied) — '
        + 'разрешите использование камеры в настройках браузера и повторите попытку.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new Error(
      'Камера не найдена или не поддерживает запрошенный режим '
        + `(camera not available: ${detail}).`,
    );
  }
  return new Error(
    `Не удалось включить камеру (camera permission / device error: ${detail}).`,
  );
};

/**
 * Create the hidden <video> element.
 *
 * The element stays in the DOM but is visually hidden (1x1, opacity
 * 0) instead of `display: none`: a `display: none` video can stop
 * decoding frames in some browsers, which would silently freeze the
 * landmarker on a frozen image.
 */
const createHiddenVideo = (): HTMLVideoElement => {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  video.style.position = 'fixed';
  video.style.top = '0';
  video.style.left = '0';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  const host = document.body ?? document.documentElement;
  host.appendChild(video);
  return video;
};

/**
 * Start a webcam hand-gesture capture.
 *
 * Resolves with a handle once the camera is live and the landmarker
 * is ready (status 'running'). Rejects with a descriptive `Error` if
 * the capture cannot be started.
 */
export const startGestureCapture = async (
  options: GestureCaptureOptions,
): Promise<GestureCaptureHandle> => {
  if (captureActive) {
    throw new Error(
      'Захват жестов уже запущен (gesture capture already running) — '
        + 'сначала остановите предыдущий.',
    );
  }
  captureActive = true;

  const config: ResolvedGestureCaptureConfig = resolveGestureConfig(options.config);

  // An explicit `config.numHands` wins over the `twoHands` toggle.
  const numHands: number = options.config?.numHands
    ?? (options.twoHands === false ? 1 : 2);

  let status: GestureCaptureStatus = 'idle';
  const setStatus = (next: GestureCaptureStatus): void => {
    status = next;
    options.onStatus(next);
  };

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  /** True when the <video> element was created by us (and must be removed). */
  let ownsVideo = false;
  let landmarker: HandLandmarker | null = null;
  let rafId: number | null = null;
  let stopped = false;

  // Detection bookkeeping.
  let lastVideoTime = -1;
  let lastTsMs = -1;
  let lastDetectAtMs = Number.NEGATIVE_INFINITY;
  const minIntervalMs = config.targetFps > 0 ? 1000 / config.targetFps : 0;

  /**
   * Release everything the capture holds. Called on stop() AND on
   * the error path — a capture that failed halfway must not leave the
   * camera indicator burning.
   */
  const teardown = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (stream !== null) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      stream = null;
    }
    if (video !== null) {
      try {
        video.pause();
      } catch {
        /* nothing to pause */
      }
      video.srcObject = null;
      // A caller-owned element stays in the DOM — the caller decides
      // what to show. Ours is removed with the capture.
      if (ownsVideo) {
        video.remove();
      }
      video = null;
    }
    if (landmarker !== null) {
      try {
        landmarker.close();
      } catch {
        /* already closed */
      }
      landmarker = null;
    }
    captureActive = false;
  };

  /** Tear down and report a fatal error. */
  const fail = (err: unknown): Error => {
    const error = toError(err);
    // The capture is dead from here on: no stray tick may resume it.
    stopped = true;
    teardown();
    setStatus('error');
    options.onError(error);
    return error;
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    teardown();
    setStatus('stopped');
  };

  /** Map a MediaPipe result to one `HandFrame` per detected hand. */
  const emitFrames = (result: HandLandmarkerResult, tsMs: number): void => {
    const landmarks = result.landmarks ?? [];
    const worldLandmarks = result.worldLandmarks ?? [];
    const handedness = result.handedness ?? [];
    for (let i = 0; i < landmarks.length; i += 1) {
      const points = landmarks[i] ?? [];
      const world = worldLandmarks[i] ?? [];
      const category = handedness[i]?.[0];
      const categoryName = category?.categoryName;
      const frame: HandFrame = {
        tsMs,
        handedness: categoryName === 'Right' ? 'Right' : 'Left',
        landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        worldLandmarks: world.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      };
      try {
        options.onFrame(frame);
      } catch (err) {
        // A broken consumer must not take the camera down.
        options.onError(toError(err));
      }
    }
  };

  /** The requestAnimationFrame loop. */
  const tick = (): void => {
    if (stopped) return;
    // Schedule the next frame FIRST: if the work below throws, the
    // loop still has a pending frame and the error handler can decide
    // what to do with it.
    rafId = requestAnimationFrame(tick);
    if (stopped || video === null || landmarker === null) return;

    try {
      const nowMs = performance.now();

      // Skip when the camera has not delivered a new frame.
      const currentTime = video.currentTime;
      if (currentTime === lastVideoTime) return;
      lastVideoTime = currentTime;

      // Skip when the camera is faster than the configured target.
      if (nowMs - lastDetectAtMs < minIntervalMs) return;
      lastDetectAtMs = nowMs;

      // MediaPipe requires strictly increasing timestamps.
      const tsMs = Math.max(nowMs, lastTsMs + 1);
      lastTsMs = tsMs;

      const result = landmarker.detectForVideo(video, tsMs);
      emitFrames(result, tsMs);
    } catch (err) {
      fail(err);
    }
  };

  setStatus('idle');
  setStatus('starting');

  try {
    if (
      typeof navigator === 'undefined'
      || typeof navigator.mediaDevices === 'undefined'
      || typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      throw new Error(
        'Камера недоступна в этом окружении (camera permission API '
          + 'navigator.mediaDevices.getUserMedia отсутствует).',
      );
    }

    // 1. Camera.
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: config.camera.width,
          height: config.camera.height,
          frameRate: config.camera.frameRate,
        },
      });
    } catch (err) {
      throw cameraPermissionError(err);
    }
    if (stopped) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
      throw new Error('Захват жестов остановлен до старта камеры (capture stopped).');
    }

    // 2. The <video> element: either the caller's own (camera
    //    preview) or a hidden one we create and own.
    video = options.videoElement ?? createHiddenVideo();
    ownsVideo = options.videoElement === undefined || options.videoElement === null;
    video.srcObject = stream;
    await video.play();

    // 3. MediaPipe (lazy: the wasm bundle is ~30 MB and is only
    //    needed once the user actually turns the camera on).
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(config.wasmPath);
    landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: config.modelPath,
        delegate: config.delegate,
      },
      runningMode: 'VIDEO',
      numHands,
    });

    setStatus('running');
    rafId = requestAnimationFrame(tick);

    return {
      stop,
      status: () => status,
    };
  } catch (err) {
    throw fail(err);
  }
};
