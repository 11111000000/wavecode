import type { PitchFrame } from '~/domain/audio/micCapture';
import type { Transient, TransientFrame, TransientState } from '~/domain/audio/transient';
import { feedTransient, initialTransientState } from '~/domain/audio/transient';
import YinWorker from './yinDetector.worker?worker';

/**
 * MicCapture — main-thread orchestrator.
 *
 * Responsibilities (thin by design):
 *   1. getUserMedia({ audio: ... })
 *   2. AudioContext + AnalyserNode, hooked to the MediaStream
 *   3. spawn a dedicated Worker (`yinDetector.worker.ts`)
 *   4. RAF loop: each frame grabs the latest time-domain data via
 *      `getFloatTimeDomainData`, posts it to the Worker (Transferable),
 *      receives a YIN frame, AND in parallel feeds the same read into
 *      the in-process transient detector. Both pipelines run every
 *      tick — no user-facing "mode" toggle.
 *   5. Fires three callbacks as new events surface:
 *      - `onFrame`     — every worker frame (pitch detected or null)
 *      - `onTransient` — each new onset the transient pipeline emits
 *      - `onMeter`     — every RAF tick with {rms, peak, hz, ts},
 *                        used by the UI for the live RMS meter +
 *                        onset spike markers
 *   6. lifetime: stop() tears down tracks, our AnalyserNode,
 *      MediaStreamSource, worker, raf, and the AudioContext WE created.
 *
 * What's NOT here:
 *   - Note segmentation (lives in `domain/audio/micCapture.ts`)
 *   - Snippet generation (lives in `domain/audio/micCapture.ts`)
 *   - Solid UI signals (lives in `presentation/state/micStore.ts`)
 *
 * Why dedicated Worker
 * --------------------
 * Even on a modern laptop, pitchy's MPM on a 2048-sample buffer takes
 * ~5-10ms. On the main thread that competes with audio scheduling and
 * Solid rendering — we've seen the Visualizer (~30Hz RAF, 1k FFT)
 * already hurting the scheduler when the tab loses focus. Moving YIN
 * off-thread costs us zero-copy `Transferable` posts and keeps the
 * audio loop clean.
 *
 * Why RAF (not ScriptProcessorNode, not AudioWorklet)
 * ---------------------------------------------------
 * `ScriptProcessorNode` is deprecated; `AudioWorklet` is the modern
 * equivalent but adds a "module-then-load-then-attach" dance and a
 * separate bundle. RAF + polled `getFloatTimeDomainData` is good enough
 * for vocal/whistle note transcription (~30Hz update rate, ~42ms latency
 * dominated by the FFT window). If we ever need sub-frame timing
 * (live spectrogram lag compensation) we'd move to AudioWorklet.
 *
 * Why a SEPARATE AudioContext (not sharing with LiveAudioEngine)
 * ----------------------------------------------------------------
 * `LiveAudioEngine.unlockAudioContext()` exposes
 * `window.__wavecodeAudioCtx` — the AudioContext that drives
 * Strudel/superdough output. We deliberately do NOT reuse it:
 *   - Sharing caused a regression where sample banks (drums, bass,
 *     piano) stopped playing after the mic detector had stashed
 *     its context first. The cause was that
 *     `LiveAudioEngine.unlockAudioContext` then short-circuited the
 *     analyser-tap install path (it only sets up the destination
 *     tap and analyser when it creates a fresh context), leaving
 *     Strudel's output graph without the routing the visualizer /
 *     mixer depended on.
 *   - Two AudioContexts on the same device is allowed and well-
 *     supported on Chrome/Edge/Firefox. iOS Safari can be finicky
 *     about a second context starting after a user gesture, but in
 *     practice a `MediaStreamSource` on context #2 starts reliably
 *     because the gesture is the mic permission prompt (not Play).
 *
 * Returned handle is single-use: start() once, stop() once.
 *
 * Pipeline-mode history
 * ---------------------
 * Earlier versions exposed a `mode: 'sustain' | 'transient' | 'auto'`
 * knob on `MicStartOptions` so users could pick which pipeline ran.
 * The `auto` mode ran both in parallel, which is what every user
 * actually wanted — picking sustain-only or transient-only required
 * understanding the difference between pitch detection and onset
 * detection, which is the wrong mental model for a singer / tapper.
 * `mode` has been deleted from the API; both pipelines ALWAYS run.
 */

export type MeterFrame = {
  /** Instantaneous RMS at the latest frame, 0..1. Computed in main
   *  thread from `getFloatTimeDomainData` (same algorithm as the
   *  worker uses, see `yinDetector.worker.ts`). */
  readonly rms: number;
  /** Maximum RMS observed in the trailing ~200ms. Computed from the
   *  per-frame RMS ring buffer; used by the UI for the meter
   *  sparkline so a single quiet frame between two loud hits doesn't
   *  collapse the bar. */
  readonly peak: number;
  /** Latest detected pitch (Hz) from the worker, or null if the
   *  current frame has no clear pitch. */
  readonly hz: number | null;
  /** `audioCtx.currentTime * 1000` at the tick that produced this
   *  meter reading; same epoch the worker frames use. */
  readonly timestampMs: number;
};

export type MicStartOptions = {
  readonly onFrame?: (frame: PitchFrame) => void;
  readonly onTransient?: (transient: Transient) => void;
  readonly onMeter?: (frame: MeterFrame) => void;
  readonly onStateChange?: (state: MicCaptureState) => void;
  readonly onError?: (err: Error) => void;
  readonly fftSize?: number;          // default 2048
  readonly clarityThreshold?: number; // default 0.9
  readonly deviceId?: string | null;  // optional mic selection
};

export type MicCaptureState =
  | 'idle'
  | 'requesting-mic'
  | 'starting-audio'
  | 'streaming'
  | 'stopping'
  | 'errored';

export type MicCaptureHandle = {
  readonly getState: () => MicCaptureState;
  readonly stop: () => Promise<void>;
};

const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_CLARITY_THRESHOLD = 0.9;
/** Rolling window for `peak` in `MeterFrame`. 200ms is short enough
 *  that a sustained note's max tracks the note's envelope, not some
 *  historical sound from minutes back. */
const METER_PEAK_WINDOW_MS = 200;

const isMicCaptureSupported = (): boolean =>
  typeof navigator !== 'undefined'
  && typeof navigator.mediaDevices !== 'undefined'
  && typeof navigator.mediaDevices.getUserMedia === 'function';

export const isMicSupported = isMicCaptureSupported;

/**
 * Race getUserMedia against `timeoutMs` (default 5s). On timeout, throw
 * a recognisable error so callers don't sit forever on a hanging
 * permission prompt.
 */
const requestMic = async (
  constraints: MediaStreamConstraints,
  timeoutMs = 5000,
): Promise<MediaStream> => {
  if (!isMicCaptureSupported()) {
    throw new Error('getUserMedia недоступен в этом окружении (нет mediaDevices)');
  }
  const requested = navigator.mediaDevices.getUserMedia(constraints);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('mic-permission-timeout')), timeoutMs);
  });
  try {
    return await Promise.race([requested, timeout]);
  } catch (err) {
    if (err instanceof Error && err.message === 'mic-permission-timeout') {
      throw new Error(
        'Browser mic permission prompt не ответил за 5 секунд — '
          + 'проверьте, не заблокирован ли prompt браузером.',
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
};

const mkWorker = (): Worker => {
  const w = new YinWorker();
  return w as unknown as Worker;
};

/** In-thread RMS — same shape as the worker's computeRms but operates
 *  on the main-thread copy of `getFloatTimeDomainData`. Cheap
 *  (~2048 mults per frame, ~0.1ms on a laptop) and avoids waiting
 *  for the worker's async reply to surface in `onMeter`. */
const computeRms = (buf: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const sample = buf[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buf.length);
};

export const startMicDetector = (
  opts: MicStartOptions,
): MicCaptureHandle => {
  let state: MicCaptureState = 'idle';
  const setState = (next: MicCaptureState): void => {
    state = next;
    opts.onStateChange?.(next);
  };

  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: number | null = null;
  let worker: Worker | null = null;
  let stopped = false;
  // Track whether we created the AudioContext ourselves (so we
  // close it in stop()) or reused the global one (don't close —
  // it's owned by LiveAudioEngine / Strudel).
  let ownsAudioCtx = false;
  // Track our own MediaStreamSource so we can disconnect it
  // independently in stop() (the AnalyserNode is per-call too).
  let mediaSource: MediaStreamAudioSourceNode | null = null;
  // Latest hz the worker reported — refreshed on every onFrame
  // message. Read by the tick() when firing onMeter so the meter
  // callback knows whether the current audio frame is pitched.
  let latestHz: number | null = null;
  // Per-tick RMS samples for the trailing 200ms peak window.
  // We append one entry per tick, then prune anything older than
  // `sampleTs - METER_PEAK_WINDOW_MS` and reduce-max over what's
  // left. A bounded array is fine here: at 60Hz RAF the window holds
  // ~12 entries, never more.
  const recentRms: Array<{ rms: number; timestampMs: number }> = [];

  const fftSize = opts.fftSize ?? DEFAULT_FFT_SIZE;
  const clarityThreshold = opts.clarityThreshold ?? DEFAULT_CLARITY_THRESHOLD;
  const audioConstraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(opts.deviceId === null || opts.deviceId === undefined
        ? {}
        : { deviceId: { exact: opts.deviceId } }),
    },
    video: false,
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    setState('stopping');
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (worker !== null) {
      worker.terminate();
      worker = null;
    }
    if (mediaSource !== null) {
      try {
        mediaSource.disconnect();
      } catch {
        /* already disconnected */
      }
      mediaSource = null;
    }
    if (analyser !== null) {
      try {
        analyser.disconnect();
      } catch {
        /* already disconnected */
      }
      analyser = null;
    }
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (audioCtx !== null && ownsAudioCtx) {
      try {
        await audioCtx.close();
      } catch {
        /* double-close is fine */
      }
      audioCtx = null;
    }
    recentRms.length = 0;
    latestHz = null;
    setState('idle');
  };

  // Async setup doesn't need to block the caller: start() returns
  // a handle whose getState() reflects the live phase. Errors are
  // surfaced via onError.
  setState('requesting-mic');
  void (async (): Promise<void> => {
    try {
      const micStream = await requestMic(audioConstraints);
      if (stopped) {
        for (const track of micStream.getTracks()) track.stop();
        return;
      }
      stream = micStream;
      setState('starting-audio');

      // Always create our own AudioContext. Do NOT stash to
      // `window.__wavecodeAudioCtx` (that's LiveAudioEngine's
      // output context — see header comment for why we don't share).
      const Ctor: typeof AudioContext =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      audioCtx = ctx;
      ownsAudioCtx = true;
      const src = ctx.createMediaStreamSource(micStream);
      const node = ctx.createAnalyser();
      node.fftSize = fftSize;
      analyser = node;
      mediaSource = src;
      src.connect(node);

      // Always spawn the MPM worker — pitch detection is cheap
      // (~5-10ms/frame in a worker, off the main thread) and the
      // user model is "sing into the mic and notes appear; tap
      // into the mic and onsets appear", with both visible at
      // once. There is no longer a user-facing mode toggle.
      worker = mkWorker();
      worker.onmessage = (ev: MessageEvent): void => {
        const data = ev.data as {
          type?: string;
          hz?: number | null;
          clarity?: number;
          rms?: number;
          timestampMs?: number;
          message?: string;
        };
        if (data.type === 'frame') {
          latestHz = typeof data.hz === 'number' ? data.hz : null;
          opts.onFrame?.({
            hz: latestHz,
            clarity: typeof data.clarity === 'number' ? data.clarity : 0,
            rms: typeof data.rms === 'number' ? data.rms : 0,
            timestampMs: typeof data.timestampMs === 'number'
              ? data.timestampMs
              : performance.now(),
          });
        } else if (data.type === 'error') {
          opts.onError?.(new Error(`mic-worker: ${data.message ?? 'unknown'}`));
        }
      };
      worker.postMessage({
        type: 'configure',
        fftSize,
        sampleRate: ctx.sampleRate,
        clarityThreshold,
      });
      setState('streaming');

      const sendBuf = new Float32Array(fftSize);
      const freqBuf = new Uint8Array(analyser.frequencyBinCount);
      const sampleRate = ctx.sampleRate;
      let transientState: TransientState = initialTransientState();
      const tick = (): void => {
        if (stopped || analyser === null || audioCtx === null) return;
        analyser.getFloatTimeDomainData(sendBuf);
        const sampleTs = audioCtx.currentTime * 1000;

        // MPM worker — post the same time-domain buffer the
        // transient pipeline reads. The worker replies asynchronously
        // via onmessage above; both pipelines see the same audio
        // tick, so a pitched kick drum surfaces as BOTH a `frame`
        // and a `transient` in the same wall-clock window.
        if (worker !== null) {
          const buf = new Float32Array(sendBuf);
          try {
            worker.postMessage({
              type: 'sample',
              buffer: buf,
              sampleRate,
              timestampMs: sampleTs,
            }, [buf.buffer]);
          } catch {
            const fresh = new Float32Array(sendBuf);
            worker.postMessage({
              type: 'sample',
              buffer: fresh,
              sampleRate,
              timestampMs: sampleTs,
            }, [fresh.buffer]);
          }
        }

        // In-thread transient detector — same AnalyserNode read.
        analyser.getByteFrequencyData(freqBuf);
        const transientFrame: TransientFrame = {
          timeDomain: sendBuf,
          freqDomain: freqBuf,
          sampleRate,
          timestampMs: sampleTs,
        };
        const next = feedTransient(transientState, transientFrame);
        if (next.transients.length > transientState.transients.length) {
          const newest = next.transients[next.transients.length - 1]!;
          opts.onTransient?.(newest);
        }
        transientState = next;

        // Live meter: rolling-peak RMS + latest hz, fired every tick
        // so the UI can render the bar even when no pitch / onset is
        // detected (silent frames keep the meter at zero).
        if (opts.onMeter !== undefined) {
          const rmsNow = computeRms(sendBuf);
          recentRms.push({ rms: rmsNow, timestampMs: sampleTs });
          const cutoff = sampleTs - METER_PEAK_WINDOW_MS;
          while (recentRms.length > 0 && recentRms[0]!.timestampMs < cutoff) {
            recentRms.shift();
          }
          let peak = rmsNow;
          for (const entry of recentRms) {
            if (entry.rms > peak) peak = entry.rms;
          }
          opts.onMeter({
            rms: rmsNow,
            peak,
            hz: latestHz,
            timestampMs: sampleTs,
          });
        }

        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      setState('errored');
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return {
    getState: () => state,
    stop,
  };
};