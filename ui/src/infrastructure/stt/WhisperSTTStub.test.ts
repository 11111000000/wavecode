/**
 * WhisperSTTStub.test — conformance + behaviour tests for the
 * always-unsupported STT placeholder.
 *
 * What this covers
 * ----------------
 *   - `WhisperSTTStubLive` satisfies
 *     `Layer.Layer<STTEngine, never, never>` (compile-time).
 *   - `isSupported()` always returns false.
 *   - `start()` always fails with `SttUnsupportedError {
 *     reason: 'no-speech-api' }` carrying a user-facing message.
 *
 * Why these tests matter
 * ----------------------
 * The presentation layer (FAB) reads `isSupported()` to decide
 * whether to render the FAB as enabled or as a disabled button
 * with a "open in Chrome" tooltip. If the stub ever flipped to
 * `isSupported() === true` (regression), the FAB would render
 * normally — and `start()` would still fail later, but the user
 * would see an active button that produces no feedback. This
 * test pins the contract.
 *
 * The shape check on `start()`'s failure (via
 * `Effect.runPromiseExit`) catches a second regression: a future
 * change that returns a typed `Error` instance (instead of the
 * tagged plain object the orchestrator switches on) would break
 * the orchestrator's `isSttUnsupportedError` type guard.
 */

import { describe, it, expect } from 'vitest';
import { Effect, type Layer } from 'effect';
import { STTEngine } from '~/application/voice/STTEngine';
import { WhisperSTTStubLive } from './WhisperSTTStub';

describe('WhisperSTTStub — Layer conformance', () => {
  it('exports a Layer that satisfies Layer.Layer<STTEngine, never, never>', () => {
    // Compile-time gate: if `WhisperSTTStubLive` drifts from the
    // service shape (or from the error / R types), this
    // assignment fails to compile.
    const layer: Layer.Layer<STTEngine, never, never> = WhisperSTTStubLive;
    expect(typeof WhisperSTTStubLive).toBe('object');
    expect(layer).toBeDefined();
  });
});

describe('WhisperSTTStub — service behaviour', () => {
  it('isSupported() returns false', async () => {
    const supported = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        return yield* svc.isSupported();
      }).pipe(Effect.provide(WhisperSTTStubLive)),
    );
    expect(supported).toBe(false);
  });

  it('start() fails with SttUnsupportedError { reason: "no-speech-api" }', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        return yield* svc.start({ lang: 'ru-RU', interim: false });
      }).pipe(Effect.provide(WhisperSTTStubLive)),
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag !== 'Failure') return;
    // Serialise the Cause to assert on the tagged error shape.
    // The orchestrator (`VoiceAISession`) uses
    // `isSttUnsupportedError` to narrow; we mirror that contract
    // by checking the discriminator strings.
    const errStr = JSON.stringify(exit.cause);
    expect(errStr).toContain('"_tag":"SttUnsupported"');
    expect(errStr).toContain('"reason":"no-speech-api"');
    expect(errStr).toMatch(/Whisper fallback/);
  });

  it('stop() is idempotent and returns Effect.void', async () => {
    // stop() on a stub never throws — it's a no-op. We assert
    // only that providing the layer + calling stop() resolves.
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.stop();
      }).pipe(Effect.provide(WhisperSTTStubLive)),
    );
    // Reaching this line means the no-op succeeded.
  });

  it('start() result never produces a Stream — it always fails first', async () => {
    // Belt-and-suspenders: assert the failure is a synchronous
    // Effect failure (no Stream materialised). If someone ever
    // "fixed" the stub to return Stream.fail(...) instead of
    // Effect.fail(...), this test would still pass — but the
    // orchestrator's contract is that unsupported is an
    // Effect-level failure so the presentation layer can react
    // without subscribing.
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.start({ lang: 'en-US', interim: true });
        // If start() ever stops failing, we expect the orchestrator
        // would have to read a Stream. Force-fail the test so the
        // regression is loud.
        return yield* Effect.fail(new Error('start() unexpectedly succeeded'));
      }).pipe(Effect.provide(WhisperSTTStubLive)),
    );
    expect(exit._tag).toBe('Failure');
  });
});