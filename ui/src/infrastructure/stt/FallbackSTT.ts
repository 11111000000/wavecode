/**
 * FallbackSTT — an `STTEngine` decorator that runs a primary engine
 * and retries once on a secondary when the primary fails with a
 * recoverable reason OR stays silently alive without producing any
 * chunks.
 *
 * Why this exists
 * ---------------
 * "Is `window.SpeechRecognition` defined?" is not the same question
 * as "does Web Speech work here?". Android Chrome ships the API
 * everywhere and the recognizer itself silently drops recognitions
 * on devices without Google services — the classic AOSP / Firefox-
 * on-Android case. Without a fallback the user gets a button that
 * "works" but never types a word, and the only honest feedback in
 * the UI is a running seconds counter.
 *
 * Two failure shapes
 * ------------------
 * 1. **Recoverable hard error** — `no-speech-api` (the constructor
 *    is gone; it will never come back for this session) or `network`
 *    (the recognizer answered with `onerror`). The retry policy in
 *    `isRecoverable` keeps these two unretried: `permission-denied`
 *    is the same permission on the same device on the second engine,
 *    `aborted` is an explicit cancel by the user / `stop()`.
 *
 * 2. **Silent primary** — the recognizer is technically alive
 *    (`recognition.start()` did not throw, `onerror` was not fired),
 *    but no `onresult` ever lands. This is the Chrome Android case
 *    measured against Chromium 149: the API exists, `start()` runs,
 *    and the session idles for the rest of the recording with no
 *    events. A retry policy that only watched errors would never
 *    trigger — the original UX bug this file fixes.
 *
 * The watchdog (`WATCHDOG_MS`, 2.5 s) is layered on the primary as
 * `Stream.timeoutFail`. 2.5 s is an 8× safety margin over a normal
 * Chrome cloud interim (~300 ms), so a healthy engine never trips
 * it; a dead-but-not-erroring engine trips it within the very first
 * 2-3 s of speech.
 *
 * What is lost when the watchdog fires
 * ------------------------------------
 * Whatever audio the primary "ate" before the silence timer noticed
 * is gone. Web Speech does not expose a flush hook for its
 * recognizer buffer, and the server relay opens a fresh MediaRecorder
 * on fallback, so the user sees only what they speak from the
 * `secondary.start(opts)` instant onward. This is the cost of the
 * route being "switch engines mid-flight" instead of "stream the
 * whole clip through a single endpoint". It is called out here so a
 * future reader does not try to "recover" the lost prefix and break
 * the design.
 *
 * Secondary watchdog
 * ------------------
 * `SECONDARY_SILENT_MS` (12 s) runs after the secondary engine is
 * started — both for the original hard-error path and for the new
 * silent-primary path — and surfaces the primary error if the
 * secondary also stays quiet. 12 s is selected against the measured
 * 5–9 s server round-trip (see `decisions/wavecode-server-stt.yaml`)
 * plus a buffer; a 2.5 s number would always fire before the server
 * had time to answer and surface a useless error. The primary
 * reason is recoverable, so the surfaced error still names the
 * primary engine — see the existing catchAll in the recovery branch.
 *
 * `stop()` is forwarded to both engines because we do not track
 * which one is currently recording, and both `stop()` implementations
 * are no-ops when idle.
 */

import { Context, Duration, Effect, Layer, Stream } from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import { logger } from '~/infrastructure/log/logger';

/** 2.5 s — see the header. ~8× Chrome cloud interim (~300 ms). */
const WATCHDOG_MS = 2_500;

/** 12 s — server round-trip (5-9 s per
 *  `decisions/wavecode-server-stt.yaml`) plus a buffer. */
const SECONDARY_SILENT_MS = 12_000;

/**
 * Internal marker used to disambiguate "primary timed out
 * silently" from "primary actually failed with `network` /
 * `no-speech-api`". The marker lives in the `message` field rather
 * than a new `reason` because `SttUnsupportedError`'s union is
 * already four values long and adding a fifth would force a wave
 * of `switch` updates in `VoiceAISession`; the message-based
 * discrimination is local to this file and survive any future
 * changes to the upstream union.
 */
const SILENT_PRIMARY_MARK = '__fallback_watchdog_silent_primary__';
const SILENT_SECONDARY_MARK = '__fallback_watchdog_silent_secondary__';

const sttError = (
  reason: SttUnsupportedError['reason'],
  message: string,
): SttUnsupportedError => ({ _tag: 'SttUnsupported', reason, message });

const silentPrimaryError = (): SttUnsupportedError =>
  sttError('network', SILENT_PRIMARY_MARK);

const silentSecondaryError = (): SttUnsupportedError =>
  sttError('network', SILENT_SECONDARY_MARK);

const isRecoverable = (err: SttUnsupportedError): boolean =>
  err.reason === 'no-speech-api' || err.reason === 'network';

export const makeFallbackSTT = (
  primary: Context.Tag.Service<typeof STTEngine>,
  secondary: Context.Tag.Service<typeof STTEngine>,
): Context.Tag.Service<typeof STTEngine> => ({
  isSupported: () => primary.isSupported(),

  start: (opts: SttStartOptions) =>
    Effect.succeed(
      Stream.unwrap(primary.start(opts)).pipe(
        Stream.timeoutFail(
          () => silentPrimaryError(),
          Duration.millis(WATCHDOG_MS),
        ),
        Stream.catchAll((primaryErr: SttUnsupportedError) => {
          const wasSilent = primaryErr.message === SILENT_PRIMARY_MARK;
          // `permission-denied` and `aborted` are still terminal:
          // the second engine would hit the same mic refusal or
          // would conflict with the user's explicit cancel. Other
          // reasons are surface-as-is so the orchestrator's
          // recovery logic stays the source of truth.
          if (!wasSilent && !isRecoverable(primaryErr)) {
            return Stream.fail(primaryErr);
          }
          logger.push('warn', [
            '[stt] primary engine ' + (wasSilent ? 'silent' : 'failed'),
            `reason=${primaryErr.reason}`,
            primaryErr.message,
            '→ trying fallback',
          ]);
          // Both engines may have opened a mic before failing;
          // the silent-path's upstream is already cancelled by
          // `timeoutFail`, so this is a defensive no-op there.
          // On the hard-error path it tears down the half-open
          // MediaRecorder / recognition.
          return primary.stop().pipe(
            Effect.andThen(secondary.start(opts)),
            Stream.unwrap,
            (s) =>
              s.pipe(
                Stream.timeoutFail(
                  () => silentSecondaryError(),
                  Duration.millis(SECONDARY_SILENT_MS),
                ),
              ),
            Stream.catchAll((secondaryErr: SttUnsupportedError) => {
              logger.push('warn', [
                '[stt] fallback failed too',
                `reason=${secondaryErr.reason}`,
                secondaryErr.message,
              ]);
              // Surface the primary's failure: it is the one the UI
              // copy is calibrated to ("открой в Chrome"), while the
              // fallback's error has already been logged above.
              return Stream.fail(primaryErr);
            }),
          );
        }),
      ),
    ),

  stop: () => Effect.all([primary.stop(), secondary.stop()], { discard: true }),
});

/**
 * Wrap two Layers into one `STTEngine` Layer that falls back from
 * `primary` to `secondary`.
 *
 * Both inputs are stateless `Layer.succeed`s (nothing to release),
 * so building each environment synchronously and letting the scope
 * close is safe — the service objects outlive it. The `as never`
 * matches the convention in `WebSpeechSTTLive` / `ServerWhisperSTTLive`.
 */
export const fallbackSTTLayer = (
  primary: Layer.Layer<STTEngine, never, never>,
  secondary: Layer.Layer<STTEngine, never, never>,
): Layer.Layer<STTEngine, never, never> => {
  const buildSvc = (
    layer: Layer.Layer<STTEngine, never, never>,
  ): Context.Tag.Service<typeof STTEngine> => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        return yield* Layer.build(layer).pipe(Effect.scoped);
      }),
    );
    return Context.get(env, STTEngine);
  };
  return Layer.succeed(
    STTEngine,
    makeFallbackSTT(buildSvc(primary), buildSvc(secondary)) as never,
  );
};
