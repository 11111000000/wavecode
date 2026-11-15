/**
 * gestureConfig — tunables for the webcam hand-gesture capture.
 *
 * Everything the capture needs to know about the outside world lives
 * here, so the capture module itself stays free of magic numbers and
 * the caller can override any single knob without forking the module.
 *
 * Asset paths
 * -----------
 * Both the wasm runtime and the model are served from OUR origin
 * (`ui/public/`), not from a CDN:
 *
 *   - `/mediapipe/wasm`            — copied out of
 *     `node_modules/@mediapipe/tasks-vision/wasm` by
 *     `scripts/sync-mediapipe-assets.mjs` (npm script
 *     `sync:mediapipe`, hooked into `predev`/`prebuild`).
 *   - `/models/hand_landmarker.task` — the float16 model, committed to
 *     the repo so a cold checkout works without a second download.
 *
 * MediaPipe's `modelAssetPath` officially accepts "URL or relative
 * path", so same-origin serving is supported and keeps the feature
 * working offline / behind a restrictive CSP.
 *
 * Delegate: CPU by default, GPU only on request
 * ---------------------------------------------
 * The delegate is a MEASUREMENT, not a preference. MediaPipe's own
 * Pixel 6 benchmark shows Gesture Recognizer running SLOWER on the GPU
 * delegate than on the CPU delegate, while Hand Landmarker is the
 * other way round. That spread is exactly why the knob is exposed
 * instead of hardcoded: the right default depends on the device and
 * on the model, and the only honest way to choose is to measure the
 * frame rate on the target hardware and flip the flag. `CPU` is the
 * default because it is the safer of the two (no WebGL context
 * required, no driver quirks, no canvas contention with the rest of
 * the app).
 */

/** MediaPipe inference backend. */
export type GestureDelegate = 'CPU' | 'GPU';

/**
 * Requested camera geometry. Every field is optional so that a
 * caller can override just the resolution and keep the default frame
 * rate.
 */
export type GestureCameraConstraints = {
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
};

/**
 * User-facing configuration. `Partial<GestureCaptureConfig>` is what
 * callers pass; `resolveGestureConfig()` turns it into a
 * `ResolvedGestureCaptureConfig` with every knob filled in.
 */
export type GestureCaptureConfig = {
  /** Constraints handed to `getUserMedia({ video })`. */
  readonly camera: GestureCameraConstraints;
  /** MediaPipe inference backend — see the note at the top. */
  readonly delegate: GestureDelegate;
  /** Base URL of the MediaPipe wasm fileset (no trailing slash). */
  readonly wasmPath: string;
  /** URL of the `hand_landmarker.task` model asset. */
  readonly modelPath: string;
  /** How many hands the landmarker tracks at once. */
  readonly numHands: number;
  /** Target detection rate; also the requested camera frame rate. */
  readonly targetFps: number;
};

/** A `GestureCaptureConfig` with every field resolved to a concrete value. */
export type ResolvedGestureCaptureConfig = Omit<GestureCaptureConfig, 'camera'> & {
  readonly camera: Required<GestureCameraConstraints>;
};

/**
 * Defaults. 640x480@30 is the cheapest geometry that still gives the
 * landmarker enough pixels for fingertips; two hands are tracked so
 * that a pinch can be detected per-hand.
 */
export const DEFAULT_GESTURE_CONFIG: GestureCaptureConfig = {
  camera: { width: 640, height: 480, frameRate: 30 },
  delegate: 'CPU',
  wasmPath: '/mediapipe/wasm',
  modelPath: '/models/hand_landmarker.task',
  numHands: 2,
  targetFps: 30,
};

/**
 * Merge caller overrides over the defaults.
 *
 * The camera sub-object is merged field-by-field, so
 * `{ camera: { width: 1280 } }` keeps the default height and frame
 * rate instead of dropping the camera to `{ width: 1280 }`.
 */
export const resolveGestureConfig = (
  overrides?: Partial<GestureCaptureConfig>,
): ResolvedGestureCaptureConfig => {
  const camera: Required<GestureCameraConstraints> = {
    width: overrides?.camera?.width ?? DEFAULT_GESTURE_CONFIG.camera.width ?? 640,
    height: overrides?.camera?.height ?? DEFAULT_GESTURE_CONFIG.camera.height ?? 480,
    frameRate:
      overrides?.camera?.frameRate ?? DEFAULT_GESTURE_CONFIG.camera.frameRate ?? 30,
  };

  return {
    delegate: overrides?.delegate ?? DEFAULT_GESTURE_CONFIG.delegate,
    wasmPath: overrides?.wasmPath ?? DEFAULT_GESTURE_CONFIG.wasmPath,
    modelPath: overrides?.modelPath ?? DEFAULT_GESTURE_CONFIG.modelPath,
    numHands: overrides?.numHands ?? DEFAULT_GESTURE_CONFIG.numHands,
    targetFps: overrides?.targetFps ?? DEFAULT_GESTURE_CONFIG.targetFps,
    camera,
  };
};
