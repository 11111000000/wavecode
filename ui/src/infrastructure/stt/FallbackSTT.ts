/**
 * FallbackSTT — an `STTEngine` decorator that runs a primary engine
 * and retries once on a secondary when the primary fails with a
 * recoverable reason.
 *
 * Why this exists
 * ---------------
 * "Is `window.SpeechRecognition` defined?" is not the same question
 * as "does Web Speech work here?". Android Chrome ships the API
 * everywhere and fails at runtime with `network` when the device has
 * no Google speech services — the classic AOSP / Firefox-on-Android
 * case. Without a fallback the user gets "не получилось связаться с
 * голосовым сервисом" and no voice input at all, even though the
 * server relay would have answered.
 *
 * What counts as "recoverable"
 * ---------------------------
 * `no-speech-api` and `network` — the engine itself is missing or
 * unreachable. `permission-denied` is NOT retried: the second
 * engine would call the same `getUserMedia` and be refused by the
 * same permission, so the retry only doubles the wait before showing
 * the error the user has to act on. `aborted` is not retried either
 * — it means the user (or barge-in) asked to stop.
 *
 * Where the failure is caught
 * ---------------------------
 * `Stream.unwrap` evaluates `primary.start(opts)` when the returned
 * stream is *consumed*, so a failure of the returned Effect (`start()`
 * itself failed) and a failure of the stream body (WebSpeech's
 * `onerror` mid-session) collapse into the same `Stream.catchAll`
 * branch — no second code path to keep in sync.
 *
 * `stop()` is forwarded to both engines because we do not track which
 * one is currently recording, and both `stop()` implementations are
 * no-ops when idle.
 */

import { Context, Effect, Layer, Stream } from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import { logger } from '~/infrastructure/log/logger';

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
        Stream.catchAll((primaryErr: SttUnsupportedError) => {
          if (!isRecoverable(primaryErr)) {
            return Stream.fail(primaryErr);
          }
          logger.push('warn', [
            '[stt] primary engine failed, trying fallback',
            primaryErr.reason,
            primaryErr.message,
          ]);
          // Both engines may have opened a mic before failing
          // (WebSpeech does not, ServerWhisper does), so give the
          // primary a chance to release before the second records.
          return primary.stop().pipe(
            Effect.andThen(secondary.start(opts)),
            Stream.unwrap,
            Stream.catchAll((secondaryErr: SttUnsupportedError) => {
              logger.push('warn', [
                '[stt] fallback failed too',
                secondaryErr.reason,
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