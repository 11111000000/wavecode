/**
 * WebSpeechSTT.test — conformance + capability tests for the
 * Web Speech API adapter.
 *
 * What this covers
 * ----------------
 *   - `WebSpeechSTTLive` is a Layer that satisfies
 *     `Layer.Layer<STTEngine, never, never>` (compile-time).
 *   - The service it provides reports `isSupported() === false`
 *     when SpeechRecognition is not on `globalThis.window` —
 *     which is the case in jsdom. The presentation layer relies
 *     on this to disable the FAB when Web Speech API is absent.
 *   - `start()` fails synchronously (via Effect.fail) with
 *     `_tag === 'SttUnsupported'` and `reason === 'no-speech-api'`
 *     when SpeechRecognition is unavailable. The orchestrator
 *     (`VoiceAISession`) uses the same error type for browser
 *     fallback — `WhisperSTTStub.start()` returns the same shape.
 *
 * What this does NOT cover
 * ------------------------
 *   - The actual SpeechRecognition event handling (onresult,
 *     onerror, onend). jsdom doesn't implement the API, and
 *     faking the global is fragile — the orchestrator's
 *     integration test (`VoiceAISession.test.ts`) uses an
 *     in-process fake STTEngine to exercise the chunk-stream
 *     pipeline, and the production code is small enough to
 *     review by eye.
 */

import { describe, it, expect } from 'vitest';
import { Effect, type Layer } from 'effect';
import { STTEngine } from '~/application/voice/STTEngine';
import { isWebSpeechSTTSupported, WebSpeechSTTLive } from './WebSpeechSTT';

describe('WebSpeechSTT — Layer conformance', () => {
  it('exports a Layer that satisfies Layer.Layer<STTEngine, never, never>', () => {
    // The compiler is the real assertion here: if `WebSpeechSTTLive`
    // ever drifts from the service shape (or from the error / R
    // types), this assignment fails to compile. The runtime check
    // below keeps the test meaningful even when strictness slips.
    const layer: Layer.Layer<STTEngine, never, never> = WebSpeechSTTLive;
    expect(typeof WebSpeechSTTLive).toBe('object');
    expect(layer).toBeDefined();
  });

  it('module loads without throwing even in jsdom (no SpeechRecognition global)', () => {
    // If the module referenced `window.SpeechRecognition` at top
    // level (instead of behind a guard), this import + the
    // capability check below would explode. They don't, so we
    // assert `isWebSpeechSTTSupported()` returns false in jsdom.
    expect(isWebSpeechSTTSupported()).toBe(false);
  });
});

describe('WebSpeechSTT — service behaviour in unsupported environments', () => {
  it('isSupported() returns false in jsdom (no SpeechRecognition global)', async () => {
    const supported = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        return yield* svc.isSupported();
      }).pipe(Effect.provide(WebSpeechSTTLive)),
    );
    expect(supported).toBe(false);
  });

  it('start() fails synchronously with SttUnsupportedError { reason: no-speech-api }', async () => {
    // The failure happens inside the returned Effect (before the
    // Stream is ever materialised), so `Effect.runPromiseExit`
    // captures it cleanly. We don't need to actually run the Stream.
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        return yield* svc.start({ lang: 'ru-RU', interim: true });
      }).pipe(Effect.provide(WebSpeechSTTLive)),
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') return;
    // The cause is a Cause<SttUnsupportedError>; for a tagged
    // plain-object failure it's iterable as the error itself.
    const errStr = JSON.stringify(exit.cause);
    expect(errStr).toContain('"reason":"no-speech-api"');
    expect(errStr).toContain('"_tag":"SttUnsupported"');
  });

  it('stop() is a no-op (returns void, does not throw) when never started', async () => {
    // stop() with no active instance is idempotent. We assert via
    // the Layer the same way the orchestrator would consume it.
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.stop();
      }).pipe(Effect.provide(WebSpeechSTTLive)),
    );
    // No assertion on the resolved value (Effect.void → undefined);
    // reaching this line means the no-op did not throw.
  });
});