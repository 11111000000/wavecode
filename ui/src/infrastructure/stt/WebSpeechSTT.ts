/**
 * WebSpeechSTT — infrastructure-layer implementation of the
 * `STTEngine` service tag (`application/voice/STTEngine.ts`) backed
 * by the browser's Web Speech API (`window.SpeechRecognition` /
 * `window.webkitSpeechRecognition`).
 *
 * The API is event-driven (no Promise / ReadableStream of its own),
 * so this module is the adapter that bridges the `onresult` /
 * `onerror` / `onend` callback surface to an Effect-TS
 * `Stream<TranscriptChunk, SttUnsupportedError>` that the
 * `VoiceAISession` orchestrator can consume with back-pressure,
 * interruption, and structured concurrency for free.
 *
 * Why a module-level singleton for the recognition instance
 * ----------------------------------------------------------
 * Chrome throws `InvalidStateError` if you create a second
 * SpeechRecognition before stopping the first — there can be at most
 * ONE active instance per tab. We track it in `activeRecognition` and
 * refuse a second `start()` until `stop()` (or natural `onend`) has
 * run, mapping the situation to a typed `SttUnsupportedError {
 * reason: 'aborted' }` rather than letting the browser throw.
 *
 * What this module does NOT do
 * ----------------------------
 * - Mic capture (that's `infrastructure/audio/MicCapture.ts`).
 *   WebSpeechSTT lets Chrome own the mic; it does not call
 *   `getUserMedia` directly.
 * - Routing of `TranscriptChunk` into the voice session state
 *   machine — that's `application/voice/VoiceAISession.ts`.
 *
 * Lifecycle
 * ---------
 *   1. `isSupported()` is a pure capability check, never throws.
 *   2. `start({ lang, interim })` creates exactly one instance and
 *      returns an Effect that fails synchronously on `aborted` /
 *      `no-speech-api`; on success it returns a Stream that emits
 *      one `TranscriptChunk` per `onresult` and terminates cleanly
 *      on `onend` or via `stop()`.
 *   3. `stop()` is idempotent — calling it without an active
 *      instance is a no-op. The browser fires `onend` shortly
 *      after; the corresponding `emit.end()` lands on the stream.
 *
 * Logging goes through `~/infrastructure/log/logger` so the in-app
 * Console UI picks up STT lifecycle events.
 */

import {
  Effect,
  Layer,
  Stream,
  type Context,
} from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import { logger } from '~/infrastructure/log/logger';

/**
 * Minimal structural type for a SpeechRecognition instance. We do
 * NOT depend on TypeScript's DOM-lib `webkitSpeechRecognition`
 * because (a) lib version drift is a known hazard and (b) the
 * browser API is split across `SpeechRecognition` (W3C) and
 * `webkitSpeechRecognition` (legacy Chrome) and we don't want the
 * type system to force one or the other.
 */
type SpeechRecognitionAlternative = {
  readonly transcript: string;
  readonly confidence: number;
};

type SpeechRecognitionResultItem = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternative | undefined;
};

type SpeechRecognitionResultList = {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultItem | undefined;
};

type SpeechRecognitionErrorEvent = {
  readonly error: string;
  readonly message?: string;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

/**
 * Augment the global Window type so `'SpeechRecognition' in window`
 * narrows correctly inside `getSpeechRecognitionCtor`. We use a
 * property-presence test instead of an instanceof check because
 * the constructor is loaded from one of two globals
 * (`SpeechRecognition` / `webkitSpeechRecognition`) and the
 * constructor identity differs between them — but they're
 * functionally equivalent.
 */
type SpeechRecognitionWindow = {
  readonly SpeechRecognition?: SpeechRecognitionCtor;
  readonly webkitSpeechRecognition?: SpeechRecognitionCtor;
};

/**
 * Resolve the constructor or `null` if Web Speech API is not
 * available in this environment. Safe in SSR / jsdom where
 * `window` is undefined or does not carry the globals.
 */
const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as SpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * Pure capability check: `true` iff a SpeechRecognition constructor
 * exists on the current window. Never throws. SSR / jsdom returns
 * `false`.
 */
export const isWebSpeechSTTSupported = (): boolean =>
  getSpeechRecognitionCtor() !== null;

/**
 * Module-level singleton — see header comment for why we track this.
 * The reference is set inside `start()`'s `Stream.asyncPush`
 * registration, and cleared by `onend` / `onerror` / `stop()` / and
 * the Stream's Scope finalizer (whichever fires first).
 */
let activeRecognition: SpeechRecognitionInstance | null = null;

/**
 * Map a raw `SpeechRecognitionErrorEvent.error` string to one of
 * the four documented `SttUnsupportedError.reason` discriminators.
 * Anything not explicitly listed falls back to `'network'` because
 * that bucket also covers "transient infrastructure failures" —
 * the orchestrator's retry policy treats it as recoverable.
 */
const classifySpeechError = (
  err: string,
): 'no-speech-api' | 'permission-denied' | 'network' | 'aborted' => {
  switch (err) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'network';
  }
};

const makeService = (): Context.Tag.Service<typeof STTEngine> => ({
  isSupported: () => Effect.succeed(getSpeechRecognitionCtor() !== null),

  start: (
    opts: SttStartOptions,
  ): Effect.Effect<
    Stream.Stream<TranscriptChunk, SttUnsupportedError>,
    SttUnsupportedError,
    never
  > =>
    Effect.gen(function* () {
      if (activeRecognition !== null) {
        logger.push('warn', ['[stt] start() called while already running']);
        return yield* Effect.fail({
          _tag: 'SttUnsupported' as const,
          reason: 'aborted' as const,
          message: 'WebSpeechSTT already running; call stop() first',
        });
      }
      const Ctor = getSpeechRecognitionCtor();
      if (Ctor === null) {
        logger.push('warn', ['[stt] SpeechRecognition unavailable']);
        return yield* Effect.fail({
          _tag: 'SttUnsupported' as const,
          reason: 'no-speech-api' as const,
          message: 'SpeechRecognition is not available in this browser',
        });
      }

      // `Stream.asyncPush` gives us a fire-and-forget callback
      // surface (Emit.EmitOpsPush) for emitting chunks / errors /
      // end-of-stream. The cleanup Effect we return is registered
      // as a Scope finalizer and runs when the consumer cancels,
      // interrupts, or reaches the natural end — which is exactly
      // the lifecycle we want for the recognition instance.
      const stream = Stream.asyncPush<TranscriptChunk, SttUnsupportedError>(
        (emit) => {
          const recognition: SpeechRecognitionInstance = new Ctor();
          recognition.lang = opts.lang;
          recognition.continuous = opts.interim;
          recognition.interimResults = opts.interim;
          recognition.maxAlternatives = 1;

          const clearActiveIfOurs = (): void => {
            if (activeRecognition === recognition) {
              activeRecognition = null;
            }
          };

          recognition.onresult = (event): void => {
            // `resultIndex` is the FIRST new entry; iterate to end.
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
              const result = event.results[i];
              if (result === undefined) continue;
              const alt = result[0];
              if (alt === undefined) continue;
              const text = alt.transcript.trim();
              if (text.length === 0) continue;
              const confidence = typeof alt.confidence === 'number'
                ? alt.confidence
                : 0;
              const chunk: TranscriptChunk = {
                kind: result.isFinal ? 'final' : 'interim',
                text,
                confidence,
                lang: opts.lang,
                timestampMs: Date.now(),
              };
              emit.single(chunk);
            }
          };

          recognition.onerror = (event): void => {
            const reason = classifySpeechError(event.error);
            logger.push('warn', [
              '[stt] SpeechRecognition error',
              event.error,
              event.message ?? '',
              '→',
              reason,
            ]);
            clearActiveIfOurs();
            emit.fail({
              _tag: 'SttUnsupported',
              reason,
              message: `SpeechRecognition error: ${event.error}`,
            });
          };

          recognition.onend = (): void => {
            logger.push('info', ['[stt] SpeechRecognition ended']);
            clearActiveIfOurs();
            emit.end();
          };

          activeRecognition = recognition;
          logger.push('info', [
            '[stt] SpeechRecognition started',
            'lang=' + opts.lang,
            'continuous=' + String(opts.interim),
          ]);
          recognition.start();

          // Finalizer: Scope closes on stream cancel / interrupt /
          // natural end. `abort()` is best-effort — the browser
          // fires `onend` shortly, which clears `activeRecognition`
          // and calls `emit.end()` again (idempotent).
          return Effect.sync(() => {
            clearActiveIfOurs();
            try {
              recognition.abort();
            } catch {
              /* recognition already ended */
            }
          });
        },
        { bufferSize: 16 },
      );

      return stream;
    }),

  stop: () =>
    Effect.sync(() => {
      if (activeRecognition === null) return;
      const rec = activeRecognition;
      activeRecognition = null;
      logger.push('info', ['[stt] stop() called by consumer']);
      try {
        rec.stop();
      } catch {
        /* already stopped / ended — fine */
      }
    }),
});

/**
 * Concrete Layer wiring `WebSpeechSTT` as the system's
 * `STTEngine`. The `as never` mirrors the project convention from
 * `LiveLLMClient` — it lets us hand a structurally-typed service
 * value to `Layer.succeed` without TypeScript inferring a
 * narrower-than-intended Service type. Drift in the
 * `STTEngine.Service` shape surfaces as a compile error in
 * `STTEngine.test.ts`'s conformance fixture.
 */
export const WebSpeechSTTLive: Layer.Layer<STTEngine, never, never> = Layer.succeed(
  STTEngine,
  makeService() as never,
);