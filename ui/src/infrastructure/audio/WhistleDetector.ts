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
 *   5. lifetime: stop() tears down tracks, ctx, worker, raf.
 *
 * What's NOT here:
 *   - Note segmentation (lives in `domain/audio/whistle.ts`)
 *   - Snippet generation (lives in `domain/audio/whistle.ts`)
 *   - Solid UI signals (lives in `presentation/state/whistleStore.ts`)
 *
 * Why dedicated Worker
 * --------------------
 * Even on a modern laptop, pitchy's YIN on a 2048-sample buffer takes
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
 * Why no AudioContext reuse
 * -------------------------
 * The existing `LiveAudioEngine` has its own AudioContext (the one
 * Strudel/superdough owns). We need to read the microphone INSIDE the
 * same context or one built on the same physical device, because
 * the user's mic stream is a single source of truth. We build our own
 * AudioContext (browser-default sampleRate) for now; a future iteration
 * may want to share `getAnalyserNode()`'s context to centralise device
 * IO.
 *
 * Returned handle is single-use: start() once, stop() once. Re-using
 * after stop throws — the UI should call start() afresh.
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
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (audioCtx !== null) {
      try {
        await audioCtx.close();
      } catch {
        /* double-close is fine */
      }
      audioCtx = null;
    }
    analyser = null;
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

      const Ctor: typeof AudioContext =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      audioCtx = ctx;
      const src = ctx.createMediaStreamSource(micStream);
      const node = ctx.createAnalyser();
      node.fftSize = fftSize;
      analyser = node;
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
