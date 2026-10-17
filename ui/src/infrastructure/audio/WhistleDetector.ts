import type { PitchFrame } from '~/domain/audio/whistle';
import YinWorker from './yinDetector.worker?worker';

/**
 * WhistleDetector — main-thread orchestrator.
 *
 * Responsibilities (thin by design):
 *   1. getUserMedia({ audio: ... })
 *   2. AudioContext + AnalyserNode, hooked to the MediaStream
 *   3. spawn a dedicated Worker (`yinDetector.worker.ts`)
 *   4. RAF loop: each frame grabs the latest time-domain data via
 *      `getFloatTimeDomainData`, posts it to the Worker (Transferable),
 *      receives a YIN frame, and forwards it to the caller.
 *   5. lifetime: stop() tears down tracks, our AnalyserNode, MediaStreamSource,
 *      worker, raf, and the AudioContext WE created.
 *
 * What's NOT here:
 *   - Note segmentation (lives in `domain/audio/whistle.ts`)
 *   - Snippet generation (lives in `domain/audio/whistle.ts`)
 *   - Solid UI signals (lives in `presentation/state/whistleStore.ts`)
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
 * for whistle → note transcription (~30Hz update rate, ~42ms latency
 * dominated by the FFT window). If we ever need sub-frame timing
 * (live spectrogram lag compensation) we'd move to AudioWorklet.
 *
 * Why a SEPARATE AudioContext (not sharing with LiveAudioEngine)
 * ----------------------------------------------------------------
 * `LiveAudioEngine.unlockAudioContext()` exposes
 * `window.__wavecodeAudioCtx` — the AudioContext that drives
 * Strudel/superdough output. We deliberately do NOT reuse it:
 *   - Sharing caused a regression where sample banks (drums, bass,
 *     piano) stopped playing after the whistle detector had stashed
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
 */

export type WhistleStartOptions = {
  readonly onFrame: (frame: PitchFrame) => void;
  readonly onStateChange?: (state: WhistleDetectorState) => void;
  readonly onError?: (err: Error) => void;
  readonly fftSize?: number;          // default 2048
  readonly clarityThreshold?: number; // default 0.9
  readonly deviceId?: string | null;  // optional mic selection
};

export type WhistleDetectorState =
  | 'idle'
  | 'requesting-mic'
  | 'starting-audio'
  | 'streaming'
  | 'stopping'
  | 'errored';

export type WhistleDetectorHandle = {
  readonly getState: () => WhistleDetectorState;
  readonly stop: () => Promise<void>;
};

const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_CLARITY_THRESHOLD = 0.9;

const isMicCaptureSupported = (): boolean =>
  typeof navigator !== 'undefined'
  && typeof navigator.mediaDevices !== 'undefined'
  && typeof navigator.mediaDevices.getUserMedia === 'function';

export const isWhistleSupported = isMicCaptureSupported;

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
        'Browser mic permission prompt не ответил за 5 секунд — ' +
          'проверьте, не заблокирован ли prompt браузером.',
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
};

const mkWorker = (): Worker => {
  const w = new YinWorker();
  return w as unknown as Worker;
};

export const startWhistleDetector = (
  opts: WhistleStartOptions,
): WhistleDetectorHandle => {
  let state: WhistleDetectorState = 'idle';
  const setState = (next: WhistleDetectorState): void => {
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
          opts.onFrame({
            hz: typeof data.hz === 'number' ? data.hz : null,
            clarity: typeof data.clarity === 'number' ? data.clarity : 0,
            rms: typeof data.rms === 'number' ? data.rms : 0,
            timestampMs: typeof data.timestampMs === 'number'
              ? data.timestampMs
              : performance.now(),
          });
        } else if (data.type === 'error') {
          opts.onError?.(new Error(`whistle-worker: ${data.message ?? 'unknown'}`));
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
      const sampleRate = ctx.sampleRate;
      const tick = (): void => {
        if (stopped || analyser === null || audioCtx === null || worker === null) return;
        analyser.getFloatTimeDomainData(sendBuf);
        const sampleTs = audioCtx.currentTime * 1000;
        const buf = new Float32Array(sendBuf);
        try {
          worker.postMessage({
            type: 'sample',
            buffer: buf,
            sampleRate,
            timestampMs: sampleTs,
          }, [buf.buffer]);
        } catch {
          // Buffer may have been detached by a prior frame's transfer;
          // rebuild from the live analyser buffer and re-post.
          const fresh = new Float32Array(sendBuf);
          worker.postMessage({
            type: 'sample',
            buffer: fresh,
            sampleRate,
            timestampMs: sampleTs,
          }, [fresh.buffer]);
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
