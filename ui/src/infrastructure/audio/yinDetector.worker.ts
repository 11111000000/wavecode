/// <reference lib="webworker" />

import { PitchDetector } from 'pitchy';

/**
 * Mic pitch-detector Worker.
 *
 * Why pitchy / McLeod Pitch Method
 * --------------------------------
 * `pitchy` (4.1 KB minified, MIT, zero runtime deps) wraps the McLeod
 * Pitch Method (MPM), which on monophonic input — a single human
 * text — outperforms the textbook YIN algorithm on noisy real
 * audio at the same latency budget. MPM returns `[pitch, clarity]`
 * where `clarity ∈ [0, 1]` measures NSDF peak height; we accept the
 * frame only when `clarity >= clarityThreshold`. Below that, MPM
 * itself returns `pitch = 0` (its internal "can't decide" signal),
 * so we map that to `hz = null`.
 *
 * Pipeline
 * --------
 * Main → Worker:
 *   { type: 'configure'; fftSize: number; sampleRate: number; clarityThreshold: number }
 *   { type: 'sample'; buffer: Float32Array; timestampMs: number }
 *   (buffer is a TIME-DOMAIN slice from AnalyserNode.getFloatTimeDomainData,
 *    transferred zero-copy via postMessage's Transferable list.)
 *
 * Worker → Main:
 *   { type: 'frame'; hz: number | null; clarity: number; rms: number; timestampMs: number }
 *   { type: 'error'; message: string }
 *
 * Pure-function export
 * --------------------
 * `handleYin(req, deps, state)` is exported alongside the Worker binding
 * so unit tests can drive the protocol directly: pass a synthetic
 * sine buffer + a fake reply closure, assert the frame structure.
 * The bottom-of-file `if (workerScope !== null ...)` block is the Worker
 * glue and only meaningful in a Worker global scope.
 *
 * Failure mode
 * ------------
 * Uncaught exceptions in a Worker terminate the runtime. We catch
 * every failure path and route it through `deps.reply(error)` so the
 * Worker is never killed by a single malformed frame.
 */

export type YinConfigure = {
  readonly type: 'configure';
  readonly fftSize: number;
  readonly sampleRate: number;
  readonly clarityThreshold: number;
};

export type YinSample = {
  readonly type: 'sample';
  readonly buffer: Float32Array;
  readonly sampleRate: number;
  readonly timestampMs: number;
};

export type YinInbound = YinConfigure | YinSample;

export type YinFrame = {
  readonly type: 'frame';
  readonly hz: number | null;
  readonly clarity: number;
  readonly rms: number;
  readonly timestampMs: number;
};

export type YinError = {
  readonly type: 'error';
  readonly message: string;
};

export type YinOutbound = YinFrame | YinError;

export type YinDeps = {
  readonly nowMs: () => number;
  readonly reply: (msg: YinOutbound) => void;
};

export type YinState = {
  detector: PitchDetector<Float32Array> | null;
  fftSize: number;
  clarityThreshold: number;
  framesProcessed: number;
};

export const defaultYinState: YinState = {
  detector: null,
  fftSize: 2048,
  clarityThreshold: 0.9,
  framesProcessed: 0,
};

const computeRms = (buf: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const sample = buf[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buf.length);
};

const safeReply = (deps: YinDeps, msg: YinOutbound): void => {
  try {
    deps.reply(msg);
  } catch {
    /* Intentional swallow — broken main-thread postMessage must not
     * terminate the Worker. The next frame's reply will retry. */
  }
};

const ensureDetector = (state: YinState, fftSize: number): void => {
  if (
    state.detector !== null
    && state.detector.inputLength === fftSize
  ) {
    return;
  }
  state.detector = PitchDetector.forFloat32Array(fftSize);
  state.fftSize = fftSize;
};

export const handleYin = (
  req: YinInbound,
  deps: YinDeps,
  state: YinState = defaultYinState,
): void => {
  try {
    if (req.type === 'configure') {
      state.clarityThreshold = req.clarityThreshold;
      ensureDetector(state, req.fftSize);
      if (state.detector !== null) {
        state.detector.clarityThreshold = req.clarityThreshold;
      }
      return;
    }

    const buf = req.buffer;
    const ts = req.timestampMs;
    const sr = req.sampleRate;
    // Ensure a detector exists for the incoming buffer size even
    // without a prior 'configure' message — the default-state's
    // fftSize (2048) happens to match a common buffer length, so
    // the old `buf.length !== state.fftSize` guard silently skipped
    // detector creation and replied with hz=null. Lazy creation on
    // first 'sample' is the safer contract.
    if (state.detector === null || state.detector.inputLength !== buf.length) {
      ensureDetector(state, buf.length);
    }
    if (state.detector === null) {
      safeReply(deps, { type: 'frame', hz: null, clarity: 0, rms: 0, timestampMs: ts });
      return;
    }

    const rms = computeRms(buf);
    const [pitch, clarity] = state.detector.findPitch(buf, sr);
    const hz = pitch > 0 && clarity >= state.clarityThreshold ? pitch : null;
    state.framesProcessed += 1;
    safeReply(deps, {
      type: 'frame',
      hz,
      clarity,
      rms,
      timestampMs: ts,
    });
  } catch (err) {
    safeReply(deps, {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

const workerScope: { addEventListener?: Worker['addEventListener']; postMessage?: Worker['postMessage'] } | null =
  typeof self === 'undefined'
    ? null
    : (self as unknown as { addEventListener?: Worker['addEventListener']; postMessage?: Worker['postMessage'] });

if (workerScope !== null && typeof workerScope.addEventListener === 'function') {
  const state: YinState = {
    detector: null,
    fftSize: 2048,
    clarityThreshold: 0.9,
    framesProcessed: 0,
  };
  const reply = (msg: YinOutbound): void => {
    if (workerScope.postMessage === undefined) return;
    workerScope.postMessage(msg);
  };
  const deps: YinDeps = {
    nowMs: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    reply,
  };
  const handler = (e: MessageEvent<YinInbound>): void => {
    handleYin(e.data, deps, state);
  };
  workerScope.addEventListener('message', handler as unknown as EventListener);
}
