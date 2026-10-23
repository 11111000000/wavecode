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
 * this file. ServerWhisper is the *fallback*, not a replacement:
 * each round-trip is 5-9 s measured on the 4-vCPU host (encode is a
 * fixed 30 s window, so the cost barely moves with clip length) and
 * it needs no Google account on the device.
 *
 * Two upload cadences
 * -------------------
 * The previous revision uploaded once per utterance, on silence, and
 * the UI honestly admitted "записываю… N с" until the first result
 * appeared. That is the lowest-fidelity path this engine can offer:
 * the user gets no live feedback, just a counter.
 *
 * This revision layers a *periodic interim upload* on top of the
 * silent-flush final upload:
 *   - The first upload fires after `TICK_MS` of speech; each
 *     subsequent tick fires at `TICK_MS` intervals if no request is
 *     already in flight. Each tick's text replaces the panel's
 *     "interim" field, like a Web Speech interim.
 *   - The silence flush still happens once the user has been quiet
 *     for `SILENCE_FLUSH_MS`; it waits for any in-flight tick to
 *     complete (server is single-flight — overlapping POSTs 503),
 *     then sends the remaining audio as a `final` chunk that the
 *     reducer's auto-commit routes to the LLM.
 *
 * The interim is `kind: 'interim'` so `appendChunk` only updates the
 * `interim` field; the orchestrator never auto-commits on interm. The
 * final flush is the *only* thing that promotes to the LLM. This is
 * what the bug-fix commit "live transcript" decides: see
 * `decisions/wavecode-voice-live-transcript.yaml`.
 *
 * Single-flight rule
 * ------------------
 * The server is single-flight (`asyncio.Semaphore(1)` measured:
 * overlapping POSTs return 503). The client keeps AT MOST ONE
 * request in flight: while a tick is awaiting its response, the
 * next meter-tick's "fire upload" branch is a no-op. The silence
 * flush blocks (with a `FLUSH_WAIT_MAX_MS` ceiling) on the
 * in-flight flag for the same reason. This naturally throttles
 * uploads to the server's throughput (~one every 6 s) without
 * needing an explicit "tick every N seconds" timer.
 *
 * Empty-speech guard
 * ------------------
 * `sawSpeech` is a sticky latch — once the meter sees RMS above
 * `SPEECH_RMS_THRESHOLD`, the engine is willing to upload at all.
 * This is the same guard as the silence-flush path: whisper on
 * digital silence hallucinates ("Редактор субтитров А. Синцевская"
 * measured on a 3-s zero clip), and an upload of silence can only
 * produce a hallucination or a wait, never useful text. The meter
 * also refuses to fire ticks while the silence timer is in range,
 * to keep the last interim from becoming a final-flush duplicate.
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
 * - The `inFlight` flag is a plain closure `let`, not a `Ref`,
 *   because the `Stream.emit` surface is single-threaded by
 *   Effect's runtime (callbacks fire on the fiber that subscribed).
 *   A `Ref` would buy us nothing and add ceremony.
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

/**
 * Incremental upload cadence. 2.5 s is the smallest window where a
 * tick can be useful on the server path: response time is 5-9 s
 * (`decisions/wavecode-server-stt`), so the next tick has either
 * completed or been skipped (server single-flight) before this one
 * fires.
 */
const TICK_MS = 2_500;

/** Hard cap on one utterance. The server rejects clips longer than
 *  120 s with 400; we stop at 100 s and start a fresh clip on the
 *  next utterance rather than failing the request. */
const MAX_UTTERANCE_MS = 100_000;

/** RMS polling cadence — 10 Hz is plenty for a boundary test and
 *  costs ~0.1 ms per tick. The incremental-upload gate piggybacks on
 *  this same timer rather than spinning up a second one. */
const METER_POLL_MS = 100;

/** `MediaRecorder.start(timeslice)` cadence. Without it Chrome only
 *  fires `dataavailable` once, at `stop()`, and a tab that gets
 *  killed mid-utterance loses everything. */
const RECORDER_TIMESLICE_MS = 1000;

/** Hard ceiling on how long the silence flush will wait for an
 *  in-flight tick before surfacing the (silent)primary error. 10 s
 *  covers two server round-trips' worth of patience; past that the
 *  server is so stuck the user is better off with an error than
 *  with another silent panel. */
const FLUSH_WAIT_MAX_MS = 10_000;

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
 * Module-level handle to the active recording's meter. The presentation
 * reads `getServerWhisperRmsLevel()` on a 10 Hz poll to render a live
 * RMS bar inside `RecordingPanel`. The handle is set in `start()` after
 * the meter exists and cleared in the corresponding `release()`.
 *
 * Why a module-level ref instead of plumbing the meter through the
 * `STTEngine` tag
 * ---------------------------------------------------------------
 * `STTEngine` is the stable interface (`start` / `stop` /
 * `isSupported`). Adding a meter accessor would couple the tag to the
 * server impl specifically, which a future `WebSpeechSTT` cannot
 * satisfy (Chrome does not expose AnalyserNode data for the WebSpeech
 * path — Chrome owns the mic). The presentation reads the meter only
 * when this module is actually the active engine; on the WebSpeech
 * path the reader returns `null` and the panel renders no bar.
 */
let activeMeter: Meter | null = null;

/**
 * External accessor for the active recording's RMS level. Returns
 * `null` when no server-STT recording is in flight — callers MUST
 * NOT fabricate a level (the cloud Web Speech path produces none,
 * faking one would mean "the app hears you" when it doesn't).
 */
export const getServerWhisperRmsLevel = (): number | null =>
  activeMeter === null ? null : activeMeter.level();

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
  const meter: Meter = {
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
  activeMeter = meter;
  return meter;
};

/* ── service ────────────────────────────────────────────────────────── */

type EmitOps = StreamEmit.EmitOpsPush<SttUnsupportedError, TranscriptChunk>;

/**
 * Active recording, if any. One per tab (mirrors WebSpeechSTT's
 * singleton rule) so a second `start()` fails fast instead of
 * opening a second mic stream the mic mutex knows nothing about.
 *
 * `requestFlush` is what `stop()` calls. It is deliberately NOT
 * `release()`: releasing the finger off the button must still ship
 * whatever the microphone captured, or "hold, say a phrase, let go"
 * throws the phrase away whenever the speech was shorter than one
 * `TICK_MS` tick. Discarding on release is `dismiss`'s job, and that
 * path never reaches this module — it interrupts the subscriber
 * fiber first, which makes the flush a no-op via `released`.
 */
let active: {
  readonly mimeType: string;
  readonly release: () => void;
  readonly requestFlush: () => void;
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

      // `opts.interim` IS meaningful now: this engine emits real
      // interim chunks during speech. WebSpeechSTT respects the same
      // flag, so a caller asking for `interim: false` gets the
      // legacy one-shot-on-silence behaviour without the periodic
      // uploads — the meter gate suppresses the tick path while
      // silent and `sawSpeech` would still flip on speech, so the
      // safest interpretation is to skip ticks entirely when the
      // caller does not want interim at all.
      logger.push('info', [
        '[stt-server] start',
        `lang=${opts.lang}`,
        `mime=${mimeType}`,
        `interim=${String(opts.interim)}`,
      ]);
      const interimWanted = opts.interim;

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
            // Single-flight flag for the periodic uploads (and the
            // final flush). Plain `let`, not `Ref`: the emit surface
            // and the meter callback run on the same fiber.
            let inFlight = false;
            let lastTickStartMs = 0;

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
              // If this recording owns `activeMeter`, drop the
              // module-level handle so external readers (`getServer
              // WhisperRmsLevel`) report null. We only clear when
                // the pointer matches — a tab-restart race that re-
                // installed the meter is rare but possible, and
                // clobbering a fresher handle would be wrong.
                if (meter !== null && activeMeter === meter) {
                  activeMeter = null;
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
             * One upload. Used both for the periodic interim tick
             * and the silence-flush final. The caller prepares the
             * blob (the interim tick takes a snapshot of the current
             * parts; the silence flush takes its own snapshot after
             * `recorder.stop()` produces the final chunk) and is
             * responsible for clearing `parts` at the right moment.
             * Returns without emitting on empty blob or transport
             * failure — the orchestrator gets one failure per
             * session from the final flush's `emit.fail`, not from
             * interim hiccups (which only matter as a log).
             */
            const upload = async (
              kind: 'interim' | 'final',
              blob: Blob,
            ): Promise<void> => {
              if (inFlight) return;
              if (blob.size === 0) return;
              inFlight = true;
              try {
                const outcome = await transcribe(config, blob, opts.lang);
                if (!outcome.ok) {
                  if (kind === 'final') {
                    logger.push('warn', ['[stt-server] ✗', outcome.error.message]);
                    emit.fail(outcome.error);
                  } else {
                    logger.push('warn', [
                      '[stt-server] interim ✗',
                      outcome.error.message,
                    ]);
                  }
                  return;
                }
                const text = outcome.text.trim();
                if (text.length === 0) {
                  if (kind === 'final') {
                    logger.push('info', ['[stt-server] empty transcript']);
                  }
                  return;
                }
                if (released) return;
                if (kind === 'interim') {
                  logger.push('info', [
                    '[stt-server] interim',
                    `${blob.size}B`,
                    `${text.length} chars`,
                    text.slice(0, 40) + (text.length > 40 ? '…' : ''),
                  ]);
                } else {
                  logger.push('info', [
                    '[stt-server] ✓ transcript',
                    `${blob.size}B`,
                    `${text.length} chars`,
                  ]);
                }
                emit.single({
                  kind,
                  text,
                  confidence: 1,
                  lang: opts.lang,
                  timestampMs: Date.now(),
                });
              } catch (err) {
                if (kind === 'final') {
                  logger.push('error', ['[stt-server] flush crashed', String(err)]);
                  emit.fail(
                    sttError(
                      'network',
                      err instanceof Error ? err.message : 'flush failed',
                    ),
                  );
                } else {
                  logger.push('warn', [
                    '[stt-server] interim crashed',
                    String(err),
                  ]);
                }
              } finally {
                inFlight = false;
              }
            };

            /**
             * Build a snapshot of the current `parts` (does NOT
             * clear them — interim uploads keep accumulating so the
             * server transcribes with the full context) and ship it.
             */
            const tickOnce = (): void => {
              if (parts.length === 0) return;
              const blob = new Blob(parts, { type: mimeType });
              void upload('interim', blob);
            };

            /**
             * Wait for any in-flight tick to complete so the final
             * upload doesn't 503 against the single-flight queue.
             * Surfaces an error after `FLUSH_WAIT_MAX_MS` rather
             * than letting the user stare at a silent panel
             * forever.
             */
            const waitForInFlight = async (): Promise<boolean> => {
              if (!inFlight) return true;
              const waitStart = Date.now();
              while (inFlight) {
                if (Date.now() - waitStart >= FLUSH_WAIT_MAX_MS) {
                  return false;
                }
                await new Promise<void>((resolve) =>
                  window.setTimeout(resolve, 50),
                );
              }
              return true;
            };

            const flush = async (): Promise<void> => {
              if (flushing || released) return;
              flushing = true;
              if (meterTimer !== null) {
                window.clearInterval(meterTimer);
                meterTimer = null;
              }
              const cleared = await waitForInFlight();
              if (!cleared) {
                logger.push('warn', [
                  '[stt-server] flush timed out waiting for in-flight upload',
                ]);
                emit.fail(
                  sttError(
                    'network',
                    'Сервер распознавания не ответил, повторите ещё раз',
                  ),
                );
                release();
                return;
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
                await upload('final', blob);
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
                return;
              }
              // Incremental-upload gate. Piggies-backs on the meter
              // cadence to avoid a second timer, and the silent
              // branch above will flip into `flush()` before any
              // more ticks can fire. `interimWanted` mirrors what
              // the caller asked for; `inFlight` enforces the
              // single-flight rule from `decisions/
              // wavecode-voice-live-transcript`.
              if (
                interimWanted
                && !inFlight
                && sawSpeech
                && now - lastTickStartMs >= TICK_MS
              ) {
                lastTickStartMs = now;
                tickOnce();
              }
            }, METER_POLL_MS);

            /**
             * Entry point for `STTEngine.stop()`. Triggers the same
             * silence-flush path on the caller's turn — the take is
             * uploaded as a `final` chunk, then the stream ends.
             * Fire-and-forget by design: `stop()` is a synchronous
             * Effect and the round trip takes seconds.
             */
            const requestFlush = (): void => {
              void flush();
            };

            active = { mimeType, release, requestFlush };

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
      // Flush-and-upload, NOT cancel. `flush()` is idempotent by
      // construction: it no-ops when a flush is already running (the
      // 1.3 s silence boundary beat us to it) or when `released` is
      // set (the consumer tore the take down deliberately), so this
      // is safe to call on every release regardless of which path
      // got here first.
      logger.push('info', ['[stt-server] stop() — flushing take']);
      session.requestFlush();
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
