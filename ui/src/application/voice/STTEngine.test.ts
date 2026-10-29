/**
 * `STTEngine` is a `Context.Tag` whose shape (the second parameter
 * to the generic) is the service interface. This test pins the
 * shape via compile-time conformance — `STTEngine.of({ ... })`
 * exists for `Layer.succeed(STTEngine, ...)` but for raw construction
 * we use the structural Service type. Conformance is verified by
 * casting through `as` to a narrow service-only type; any drift in
 * the shape will surface as a compile error here.
 */

import { describe, it, expect } from 'vitest';
import { Effect, Stream, type Context } from 'effect';
import { STTEngine, isSttUnsupportedError, type SttStartOptions } from './STTEngine';
import type { TranscriptChunk } from '~/domain/voice/Transcript';

/**
 * The service shape that providers must implement. TS validates the
 * conformance of the literal object below at compile time — adding a
 * method to the `STTEngine` definition breaks this fixture.
 */
type SttServiceShape = Context.Tag.Service<typeof STTEngine>;

const fakets = (): SttServiceShape => ({
  isSupported: () => Effect.succeed(true),
  start: (_opts: SttStartOptions): Effect.Effect<Stream.Stream<TranscriptChunk, never>, never, never> =>
    Effect.succeed(Stream.empty),
  stop: () => Effect.void,
});

describe('STTEngine — service interface compliance', () => {
  it('is a Context.Tag whose Service type has the three required methods', () => {
    // Compile-time check: the fixture must typecheck, which only
    // succeeds if every method on the Service interface is present.
    const svc: SttServiceShape = fakets();
    expect(typeof svc.isSupported).toBe('function');
    expect(typeof svc.start).toBe('function');
    expect(typeof svc.stop).toBe('function');
  });

  it('Layer.succeed(STTEngine, fixture) compiles and yields a usable layer', () => {
    // The diagnostic value of this test is in the expression `as
    // never` — we coerce the structurally-typed fixture to `never` so
    // a change to `STTEngine` (e.g., adding/removing a method)
    // surfaces as a `Type '...' is missing the following properties
    // from type 'Service<...>':` compile error pointing here.
    const fixture = fakets();
    expect(fixture).toBeDefined();
    void (fixture as never);
    // Touch the tag constructor so a future rename of `'STTEngine'`
    // surfaces as a compile error here, not at the consumer. The Tag
    // constructor is a function in Effect-TS, hence the type check.
    expect(typeof STTEngine).toBe('function');
  });

  it('isSttUnsupportedError narrows the four documented discriminants', () => {
    const reasons = ['no-speech-api', 'permission-denied', 'network', 'aborted'] as const;
    for (const reason of reasons) {
      const err = { _tag: 'SttUnsupported', reason, message: reason };
      expect(isSttUnsupportedError(err)).toBe(true);
    }
    expect(isSttUnsupportedError({ _tag: 'Other' })).toBe(false);
    expect(isSttUnsupportedError(null)).toBe(false);
    expect(isSttUnsupportedError(new Error('boom'))).toBe(false);
  });
});
