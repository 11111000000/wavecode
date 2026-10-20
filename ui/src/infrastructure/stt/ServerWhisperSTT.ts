/**
 * ServerWhisperSTT — infrastructure-layer `STTEngine` that records
 * the mic locally and transcribes it on the server
 * (`POST {VITE_LLM_PROXY_URL}/audio/transcriptions`, whisper.cpp
 * `ggml-base-q5_1` behind the same LiteLLM proxy that serves the
 * chat completions).
 *
 * Why this exists
 * ---------------
 * WebSpeechSTT is the fast path: Chrome streams ~1-2 s partials from
 * Google's cloud and the UI feels live. It is also unavailable on
 * iOS Safari and Firefox, where `window.SpeechRecognition` simply
 * does not exist — those browsers had no voice input at all before
 * this file. ServerWhisper is the *fallback*, not a replacement: it
 * costs one HTTP round-trip of 5-9 s measured on the 4-vCPU host
 * (encode is a fixed 30 s window, so the cost barely moves with clip
 * length) and it needs no Google account on the device.
 *
 * Why one POST per utterance, not every 2 seconds
 * ----------------------------------------------
 * The server answers only when the whole clip is done, so a periodic
 * partial upload buys nothing except a fresh 5-9 s wait per
 * partial — on a 4-vCPU box the STT route is single-flight, so
 * overlapping partials simply 503. Instead this engine buffers the
 * whole utterance and POSTs it exactly once, when the utterance is
 * over. "Over" is detected client-side as 1.3 s of silence after
 * speech (RMS through an `AnalyserNode`); the UI shows
 * «Записываю… N с» meanwhile instead of pretending to stream.
 *
 * Why the upload is triggered by the engine, not by `stop()`
 * --------------------------------------------------
 * Measured, not guessed: `VoiceAISession.stop()` interrupts the
 * chunk-consumer fiber *before* calling `stt.stop()`, so anything an
 * engine emits afterwards lands in a closed mailbox and is dropped
 * (verified with a scratch harness against the real orchestrator:
 * FSM ended `paused` with an empty transcript). A final chunk
 * therefore has to be emitted while the consumer is still alive —
 * which is exactly what the silence timer does. `stop()` here means
 * "cancel": release the mic, drop the buffer, upload nothing. That
 * also matches user intent on the panel's ✕.
 *
 * Notes for the next reader
 * -------------------------
 * - `Stream.asyncPush`'s register Effect must COMPLETE — it is
 *   sequenced after the mailbox acquire, not registered as a scope
 *   finalizer (`Effect.tap`, not `Effect.acquireRelease`). Return
 *   `Effect.void` and use `Effect.addFinalizer` for real cleanup.
 *   WebSpeechSTT returns `recognition.abort()` from its register,
 *   which fires immediately after `start()`; that is a pre-existing
 *   bug in that file, deliberately not replicated here.
 * - `infrastructure/` never imports `solid-js` (ESLint
 *   `no-restricted-imports`), so the elapsed-time readout lives in
 *   the presentation store, not here.
 */

import {
  Effect,
  Layer,
  Stream,
  type Context,
  type StreamEmit,
} from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import { logger } from '~/infrastructure/log/logger';

/* ── configuration ──────────────────────────────────────────────────── */

export type ServerWhisperConfig = {
  /** Full endpoint including `/audio/transcriptions`. */
  readonly endpoint: string;
  /** Same Bearer key the chat completions use. */
  readonly apiKey: string;
};

const readConfigFromEnv = (): ServerWhisperConfig => {
  const base = import.meta.env.VITE_LLM_PROXY_URL ?? 'https://llm.kosov.online/v1';
  return {
    endpoint: `${base.replace(/\/+$/, '')}/audio/transcriptions`,
    apiKey: import.meta.env.VITE_LLM_PROXY_KEY ?? '',
  };
};

/* ── recording constants ────────────────────────────────────────────── */

/**
 * Preference order matters: `audio/webm;codecs=opus` is what Chrome
 * and Firefox record natively and is ~24 kbps, `audio/mp4` is what
 * iOS Safari records. ffmpeg on the server decodes all of them.
 */
const MIME_CANDIDATES: ReadonlyArray<string> = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** RMS above which we consider the mic "hearing something". Roughly
 *  −34 dBFS: above a quiet room's noise floor, below normal speech.
 *  A higher threshold misses soft speakers, a lower one turns the
 *  hum of a laptop into an utterance boundary. */
const SPEECH_RMS_THRESHOLD = 0.02;

/** How long the mic has to stay quiet before we call the utterance
 *  over. 1.3 s is longer than a breath pause between phrases and
 *  shorter than the "thinking about what to say" gap most users
 *  take mid-sentence. */
const SILENCE_FLUSH_MS = 1300;

/** Hard cap on one utterance. The server rejects clips longer than
 *  120 s with 400; we stop at 100 s and start a fresh clip on the
 *  next utterance rather than failing the request. */
const MAX_UTTERANCE_MS = 100_000;

/** RMS polling cadence — 10 Hz is plenty for a boundary test and
 *  costs ~0.1 ms per tick. */
const METER_POLL_MS = 100;

/** `MediaRecorder.start(timeslice)` cadence. Without it Chrome only
 *  fires `dataavailable` once, at `stop()`, and a tab that gets
 *  killed mid-utterance loses everything. */
const RECORDER_TIMESLICE_MS = 1000;

const ANALYSER_FFT_SIZE = 1024;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
  video: false,
};

/* ── capability probing ─────────────────────────────────────────────── */

/** First container both the browser and the server's ffmpeg can
 *  handle, or `null` when this browser cannot record at all. */
export const pickRecordingMimeType = (): string | null => {
  if (typeof MediaRecorder === 'undefined') return null;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return null;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
};

/**
 * Pure capability check. Requires `getUserMedia` (mic capture),
 * `MediaRecorder` + a supported container (encoding) — anything less
 * and the voice FAB must stay disabled instead of failing on press.
 */
export const isServerWhisperSTTSupported = (): boolean =>
  typeof navigator !== 'undefined'
  && typeof navigator.mediaDevices !== 'undefined'
  && typeof navigator.mediaDevices.getUserMedia === 'function'
  && pickRecordingMimeType() !== null;

/* ── error mapping ──────────────────────────────────────────────────── */

const sttError = (
  reason: SttUnsupportedError['reason'],
  message: string,
): SttUnsupportedError => ({ _tag: 'SttUnsupported', reason, message });

/**
 * `getUserMedia` rejects with a DOMException whose `name` is the
 * only signal we get. Chrome/Firefox use `NotAllowedError` for both
 * "user denied" and "no device"; iOS Safari uses `NotAllowedError`
 * too, `NotFoundError` when there is no input at all.
 */
const classifyMicError = (err: unknown): SttUnsupportedError => {
  // Read `name` structurally: `err instanceof DOMException` would
  // itself throw a ReferenceError in an environment without
  // DOMException, and this mapper exists precisely so that nothing
  // raw escapes.
  const name =
    typeof err === 'object' && err !== null
      && typeof (err as { readonly name?: unknown }).name === 'string'
      ? (err as { readonly name: string }).name
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return sttError(
        'permission-denied',
        'Браузер не дал доступ к микрофону',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return sttError(
        'no-speech-api',
        'Микрофон не найден',
      );
    case 'NotReadableError':
    case 'TrackStartError':
      return sttError(
        'network',
        'Микрофон занят другим приложением',
      );
    default:
      return sttError(
        'network',
        err instanceof Error ? err.message : 'getUserMedia failed',
      );
  }
};

/**
 * Server failure → `SttUnsupportedError`. Every bucket lands on
 * `'network'` on purpose: that is the one reason the orchestrator
 * treats as transient, and every status here is either transient
 * (503 single-flight, 504 timeout) or caused by something the user
 * can change by speaking less / with better audio (413 too big, 400
 * broken or over-long clip).
 */
const classifyHttpFailure = (status: number, body: string): SttUnsupportedError => {
  const detail = body.trim().slice(0, 200);
  const suffix = detail.length > 0 ? `: ${detail}` : '';
  switch (status) {
    case 400:
      return sttError(
        'network',
        `Сервер распознавания отклонил аудио (400)${suffix}`,
      );
    case 401:
    case 403:
      return sttError(
        'network',
        `Ключ распознавания отклонён (${status})${suffix} — проверь VITE_LLM_PROXY_KEY`,
      );
    case 413:
      return sttError(
        'network',
        'Аудио больше 25 МБ — говорите короче',
      );
    case 503:
      return sttError(
        'network',
        'Сервер распознавания занят, повторите ещё раз',
      );
    case 504:
      return sttError(
        'network',
        'Сервер распознавания не ответил вовремя',
      );
    default:
      return sttError(
        'network',
        `Сервер распознавания ответил ${status}${suffix}`,
      );
  }
};

/* ── transcription ──────────────────────────────────────────────────── */

/** `ru-RU` → `ru`. The server wants ISO 639-1; anything that is not
 *  a two-letter code is left out so the model auto-detects. */
const toServerLanguage = (lang: string): string | null => {
  const base = (lang.split('-')[0] ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : null;
};

const containerExtension = (mimeType: string): string =>
  mimeType.includes('mp4') ? 'mp4'
    : mimeType.includes('ogg') ? 'ogg'
      : 'webm';

type TranscribeOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: SttUnsupportedError };

/**
 * One multipart POST. Never throws — transport rejection, HTTP
 * failure and unparseable body all come back as a value, because
 * every caller is a bare `setTimeout` callback that has no Effect
 * error channel to fail into.
 */
const transcribe = async (
  config: ServerWhisperConfig,
  blob: Blob,
  lang: string,
): Promise<TranscribeOutcome> => {
  const form = new FormData();
  form.append(
    'file',
    blob,
    `clip.${containerExtension(blob.type)}`,
  );
  const language = toServerLanguage(lang);
  if (language !== null) form.append('language', language);

  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
  } catch (err) {
    return {
      ok: false,
      error: sttError(
        'network',
        err instanceof Error
          ? `Сервер распознавания недоступен: ${err.message}`
          : 'Сервер распознавания недоступен',
      ),
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, error: classifyHttpFailure(response.status, body) };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const text =
    typeof parsed === 'object' && parsed !== null
      && typeof (parsed as { readonly text?: unknown }).text === 'string'
      ? (parsed as { readonly text: string }).text
      : '';
  return { ok: true, text };
};

/* ── metering ───────────────────────────────────────────────────────── */

const computeRms = (buf: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const sample = buf[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / buf.length);
};

type Meter = {
  readonly level: () => number;
  readonly dispose: () => void;
};

/**
 * Level meter on an `AnalyserNode`, created in the same way as
 * `MicCapture` (own context, never connected to the destination — a
 * mic routed to the speakers is a feedback loop). Returns `null` when
 * this browser refuses to give us an `AudioContext`; the caller then
 * falls back to duration-only flushing.
 */
const startMeter = (stream: MediaStream): Meter | null => {
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as unknown as {
          readonly webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
  if (Ctor === undefined) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    source.connect(analyser);
  } catch {
    try {
      source?.disconnect();
    } catch {
      /* nothing to disconnect */
    }
    void ctx.close().catch(() => {});
    return null;
  }

  // Safari keeps a freshly constructed context suspended until a
  // gesture resumes it. We are inside the FAB's pointerdown, so this
  // normally succeeds; when it doesn't, the RMS stays at zero and we
  // simply never see the silence boundary.
  void ctx.resume().catch(() => {});

  const buf = new Float32Array(analyser.fftSize);
  const node = analyser;
  return {
    level: () => {
      node.getFloatTimeDomainData(buf);
      return computeRms(buf);
    },
    dispose: () => {
      try {
        source?.disconnect();
        node.disconnect();
      } catch {
        /* already disconnected */
      }
      void ctx.close().catch(() => {});
    },
  };
};

/* ── service ────────────────────────────────────────────────────────── */

type EmitOps = StreamEmit.EmitOpsPush<SttUnsupportedError, TranscriptChunk>;

/**
 * Active recording, if any. One per tab (mirrors WebSpeechSTT's
 * singleton rule) so a second `start()` fails fast instead of
 * opening a second mic stream the mic mutex knows nothing about.
 */
let active: {
  readonly mimeType: string;
  readonly release: () => void;
} | null = null;

const makeService = (
  config: ServerWhisperConfig,
): Context.Tag.Service<typeof STTEngine> => ({
  isSupported: () => Effect.sync(isServerWhisperSTTSupported),

  start: (
    opts: SttStartOptions,
  ): Effect.Effect<
    Stream.Stream<TranscriptChunk, SttUnsupportedError>,
    SttUnsupportedError,
    never
  > =>
    Effect.gen(function* () {
      if (active !== null) {
        logger.push('warn', ['[stt-server] start() while already recording']);
        return yield* Effect.fail(
          sttError('aborted', 'ServerWhisperSTT already recording; call stop() first'),
        );
      }
      if (!isServerWhisperSTTSupported()) {
        return yield* Effect.fail(
          sttError(
            'no-speech-api',
            'Браузер не умеет записывать аудио (нет MediaRecorder)',
          ),
        );
      }
      const mimeType = pickRecordingMimeType();
      if (mimeType === null) {
        return yield* Effect.fail(
          sttError('no-speech-api', 'Нет поддерживаемого аудио-контейнера'),
        );
      }

      // `opts.interim` has no meaning here: the server cannot produce
      // partials, so pretending otherwise would only teach the UI to
      // wait for text that never arrives.
      logger.push('info', [
        '[stt-server] start',
        `lang=${opts.lang}`,
        `mime=${mimeType}`,
        `interim=${String(opts.interim)}(ignored)`,
      ]);

      return Stream.asyncPush<TranscriptChunk, SttUnsupportedError>(
        (emit: EmitOps) =>
          Effect.gen(function* () {
            const micStream: MediaStream = yield* Effect.tryPromise({
              try: () => navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS),
              catch: classifyMicError,
            });

            const parts: BlobPart[] = [];
            let meter: Meter | null = null;
            let meterTimer: number | null = null;
            let released = false;
            let flushing = false;

            const recorder = new MediaRecorder(micStream, { mimeType });
            recorder.ondataavailable = (event: BlobEvent): void => {
              if (event.data.size > 0) parts.push(event.data);
            };

            const release = (): void => {
              if (released) return;
              released = true;
              if (meterTimer !== null) {
                window.clearInterval(meterTimer);
                meterTimer = null;
              }
              meter?.dispose();
              meter = null;
              if (recorder.state !== 'inactive') {
                try {
                  recorder.stop();
                } catch {
                  /* already stopped */
                }
              }
              for (const track of micStream.getTracks()) track.stop();
              if (active !== null && active.release === release) active = null;
            };

            /**
             * Close the clip, upload it once, emit the answer. Runs
             * outside any Effect (timer callback), so it catches its
             * own exceptions and reports through `emit.fail` — the
             * orchestrator only ever sees `SttUnsupportedError`.
             */
            const flush = async (): Promise<void> => {
              if (flushing || released) return;
              flushing = true;
              if (meterTimer !== null) {
                window.clearInterval(meterTimer);
                meterTimer = null;
              }
              try {
                await new Promise<void>((resolve) => {
                  recorder.onstop = (): void => resolve();
                  if (recorder.state === 'inactive') {
                    resolve();
                    return;
                  }
                  recorder.stop();
                });
                const blob = new Blob(parts, { type: mimeType });
                parts.length = 0;
                if (blob.size === 0) {
                  logger.push('warn', ['[stt-server] nothing recorded, skipping upload']);
                  emit.end();
                  return;
                }
                const outcome = await transcribe(config, blob, opts.lang);
                if (!outcome.ok) {
                  logger.push('warn', ['[stt-server] ✗', outcome.error.message]);
                  emit.fail(outcome.error);
                  return;
                }
                const text = outcome.text.trim();
                logger.push('info', [
                  '[stt-server] ✓ transcript',
                  `${blob.size}B`,
                  `${text.length} chars`,
                ]);
                if (text.length > 0) {
                  const chunk: TranscriptChunk = {
                    kind: 'final',
                    text,
                    confidence: 1,
                    lang: opts.lang,
                    timestampMs: Date.now(),
                  };
                  emit.single(chunk);
                }
                emit.end();
              } catch (err) {
                logger.push('error', ['[stt-server] flush crashed', String(err)]);
                emit.fail(
                  sttError(
                    'network',
                    err instanceof Error ? err.message : 'flush failed',
                  ),
                );
              } finally {
                release();
              }
            };

            recorder.start(RECORDER_TIMESLICE_MS);
            meter = startMeter(micStream);

            const startedAtMs = Date.now();
            let lastVoiceAtMs = startedAtMs;
            let sawSpeech = false;
            meterTimer = window.setInterval(() => {
              if (released || flushing) return;
              const now = Date.now();
              const rms = meter?.level() ?? 0;
              if (rms >= SPEECH_RMS_THRESHOLD) {
                sawSpeech = true;
                lastVoiceAtMs = now;
              }
              if (now - startedAtMs >= MAX_UTTERANCE_MS) {
                void flush();
                return;
              }
              // No speech ever → keep listening. Whisper invents
              // plausible sentences out of digital silence (we
              // measured: 3 s of zeroes → "Редактор субтитров
              // А. Синцевская"), and an invented instruction routed
              // to the LLM edits the user's score. An empty clip is
              // simply not worth a 5-9 s round-trip either.
              if (sawSpeech && now - lastVoiceAtMs >= SILENCE_FLUSH_MS) {
                void flush();
              }
            }, METER_POLL_MS);

            active = { mimeType, release };

            // Real teardown on every exit path (consumer interrupt,
            // `emit.end()`, upstream failure). Registered as a scope
            // finalizer because the Effect returned from this
            // register — see header — is not one.
            yield* Effect.addFinalizer(
              () => Effect.sync(() => {
                logger.push('info', ['[stt-server] scope closed, releasing mic']);
                release();
              }),
            );
            // Must complete for the mailbox to start delivering.
            return yield* Effect.void;
          }),
        { bufferSize: 16 },
      );
    }),

  stop: () =>
    Effect.sync(() => {
      const session = active;
      if (session === null) return;
      logger.push('info', ['[stt-server] stop() — cancel, no upload']);
      session.release();
    }),
});

/**
 * Concrete Layer. `as never` mirrors `WebSpeechSTTLive` /
 * `LiveLLMClient` — structural service values into `Layer.succeed`
 * without TypeScript narrowing the Service type.
 */
export const ServerWhisperSTTLive: Layer.Layer<STTEngine, never, never> = Layer.succeed(
  STTEngine,
  makeService(readConfigFromEnv()) as never,
);

/** Test / experiment seam: explicit endpoint + key instead of env. */
export const makeServerWhisperSTT = (
  config: Partial<ServerWhisperConfig> = {},
): Layer.Layer<STTEngine, never, never> => {
  const fromEnv = readConfigFromEnv();
  return Layer.succeed(
    STTEngine,
    makeService({
      endpoint: config.endpoint ?? fromEnv.endpoint,
      apiKey: config.apiKey ?? fromEnv.apiKey,
    }) as never,
  );
};