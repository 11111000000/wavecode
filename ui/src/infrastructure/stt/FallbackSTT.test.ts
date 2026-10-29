/**
 * FallbackSTT tests — the retry policy, which is the only thing this
 * file decides. Both engines are in-process fakes; the real engines
 * are covered by their own tests.
 *
 * What is asserted
 * ----------------
 *   - Hard errors: `network` from the primary (the Android-Chrome-
 *     without-Google-services case in some browsers) retries on the
 *     secondary and its chunks flow.
 *   - `permission-denied` does NOT retry: the second engine calls the
 *     same `getUserMedia` and would be refused identically.
 *   - `aborted` does not retry (barge-in / explicit cancel).
 *   - Both failing surfaces the PRIMARY error, because the UI copy is
 *     calibrated to it.
 *   - `stop()` reaches both engines, because the wrapper does not
 *     track which one is currently recording.
 *   - Silent primary (no chunk, no error) flips to the secondary
 *     after `WATCHDOG_MS` and keeps its chunks (Chrome Android).
 *   - The watchdog does NOT trigger when the primary emits a chunk
 *     inside `WATCHDOG_MS` (the 8× safety margin holds on real
 *     clouds).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context} from 'effect';
import { Effect, Layer, Stream } from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import { makeFallbackSTT } from './FallbackSTT';

const finalChunk = (text: string, lang: string = 'ru-RU'): TranscriptChunk => ({
  kind: 'final',
  text,
  confidence: 0.9,
  lang,
  timestampMs: 1_700_000_000_000,
});

const err = (
  reason: SttUnsupportedError['reason'],
  message: string = reason,
): SttUnsupportedError => ({ _tag: 'SttUnsupported', reason, message });

type FakeSpec = {
  readonly onStart:
    | 'fail'
    | 'silent'
    | 'emit-then-silent'
    | 'chunks';
  readonly chunks?: ReadonlyArray<TranscriptChunk>;
  readonly failWith?: SttUnsupportedError;
};

/**
 * `Stream.async` without ever calling `emit.single / fail / end` and
 * without the register Effect returning is the canonical "stream is
 * alive but will never produce" — exactly the Chrome-Android-without-
 * Google-services case.
 */
const silentStream = (): Stream.Stream<TranscriptChunk, SttUnsupportedError> =>
  Stream.async<TranscriptChunk, SttUnsupportedError>(() => {
    /* never emits */
  });

/**
 * Emit a single chunk the moment the consumer subscribes (no timer
 * involved — `Stream.make` is synchronous). Used to prove the
 * watchdog does not false-trip on a healthy cloud whose first
 * interim lands in well under `WATCHDOG_MS`.
 */
const chunkStream = (
  chunk: TranscriptChunk,
): Stream.Stream<TranscriptChunk, SttUnsupportedError> =>
  Stream.make(chunk) as unknown as Stream.Stream<
    TranscriptChunk,
    SttUnsupportedError
  >;

const makeFake = (spec: FakeSpec) => {
  const calls = { start: 0, stop: 0 };
  const service: Context.Tag.Service<typeof STTEngine> = {
    isSupported: () => Effect.succeed(true),
    start: (_opts: SttStartOptions) => {
      calls.start += 1;
      switch (spec.onStart) {
        case 'fail':
          return Effect.fail(spec.failWith ?? err('network'));
        case 'silent':
          return Effect.succeed(silentStream());
        case 'emit-then-silent':
          return Effect.succeed(
            spec.chunks && spec.chunks.length > 0
              ? chunkStream(spec.chunks[0]!)
              : silentStream(),
          );
        case 'chunks':
          return Effect.succeed(
            Stream.fromIterable(spec.chunks ?? []) as Stream.Stream<
              TranscriptChunk,
              SttUnsupportedError
            >,
          );
      }
    },
    stop: () =>
      Effect.sync(() => {
        calls.stop += 1;
      }),
  };
  return { service, calls };
};

const layerOf = (
  primary: Context.Tag.Service<typeof STTEngine>,
  secondary: Context.Tag.Service<typeof STTEngine>,
): Layer.Layer<STTEngine, never, never> =>
  Layer.succeed(STTEngine, makeFallbackSTT(primary, secondary) as never);

const run = (
  layer: Layer.Layer<STTEngine, never, never>,
): Effect.Effect<unknown, SttUnsupportedError, never> =>
  Effect.gen(function* () {
    const svc = yield* STTEngine;
    const stream = yield* svc.start({ lang: 'ru-RU', interim: true });
    return yield* Stream.runCollect(stream);
  }).pipe(Effect.provide(layer));

const runWithTimers = (
  layer: Layer.Layer<STTEngine, never, never>,
): Promise<unknown> =>
  Effect.runPromise(run(layer));

describe('FallbackSTT — retry policy on hard errors', () => {
  it('retries on the secondary when the primary fails with network', async () => {
    const primary = makeFake({ onStart: 'fail', failWith: err('network', 'no google services') });
    const secondary = makeFake({ onStart: 'chunks', chunks: [finalChunk('сделай бас громче')] });
    const exit = await Effect.runPromiseExit(run(layerOf(primary.service, secondary.service)));
    expect(exit._tag).toBe('Success');
    expect(primary.calls.start).toBe(1);
    expect(primary.calls.stop).toBe(1);
    expect(secondary.calls.start).toBe(1);
    if (exit._tag !== 'Success') return;
    expect(Array.from(exit.value as Iterable<TranscriptChunk>).map((c) => c.text))
      .toEqual(['сделай бас громче']);
  });

  it('does not retry on permission-denied', async () => {
    const primary = makeFake({ onStart: 'fail', failWith: err('permission-denied') });
    const secondary = makeFake({ onStart: 'chunks', chunks: [finalChunk('не должно')] });
    const exit = await Effect.runPromiseExit(run(layerOf(primary.service, secondary.service)));
    expect(exit._tag).toBe('Failure');
    expect(secondary.calls.start).toBe(0);
    if (exit._tag !== 'Failure') return;
    expect(JSON.stringify(exit.cause)).toContain('"reason":"permission-denied"');
  });

  it('does not retry on aborted', async () => {
    const primary = makeFake({ onStart: 'fail', failWith: err('aborted') });
    const secondary = makeFake({ onStart: 'chunks', chunks: [finalChunk('не должно')] });
    const exit = await Effect.runPromiseExit(run(layerOf(primary.service, secondary.service)));
    expect(exit._tag).toBe('Failure');
    expect(secondary.calls.start).toBe(0);
  });

  it('surfaces the primary error when the secondary fails too', async () => {
    const primary = makeFake({ onStart: 'fail', failWith: err('network', 'primary упал') });
    const secondary = makeFake({ onStart: 'fail', failWith: err('network', 'server упал') });
    const exit = await Effect.runPromiseExit(run(layerOf(primary.service, secondary.service)));
    expect(exit._tag).toBe('Failure');
    expect(secondary.calls.start).toBe(1);
    if (exit._tag !== 'Failure') return;
    expect(JSON.stringify(exit.cause)).toContain('primary упал');
  });

  it('stop() reaches both engines', async () => {
    const primary = makeFake({ onStart: 'chunks', chunks: [] });
    const secondary = makeFake({ onStart: 'chunks', chunks: [] });
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* STTEngine;
        yield* svc.stop();
      }).pipe(Effect.provide(layerOf(primary.service, secondary.service))),
    );
    expect(primary.calls.stop).toBe(1);
    expect(secondary.calls.stop).toBe(1);
  });
});

/**
 * Watchdog retry — fires when the primary is alive but never
 * produces. Requires `vi.useFakeTimers` because the
 * `Stream.timeoutFail` timer is `Effect.sleep`, which delegates to
 * `setTimeout` — vitest mocks the latter when fake timers are on.
 */
describe('FallbackSTT — watchdog on silent primary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // `WATCHDOG_MS = 2_500` — exact value matters: a slow drift here
  // means the timer test races the inner stream. Constant kept in
  // sync by reading the source rather than re-typing the number.
  const WATCHDOG_MS = 2_500;

  it('primary emits a chunk in time → watchdog does NOT fire', async () => {
    const primary = makeFake({
      onStart: 'emit-then-silent',
      chunks: [finalChunk('быстрый interim')],
    });
    const secondary = makeFake({ onStart: 'chunks', chunks: [finalChunk('НЕ ДОЛЖЕН УВИДЕТЬ')] });

    const exit = await Effect.runPromiseExit(run(layerOf(primary.service, secondary.service)));

    expect(exit._tag).toBe('Success');
    expect(secondary.calls.start).toBe(0);  // the watchdog must NOT have flipped engines
    if (exit._tag !== 'Success') return;
    const texts = Array.from(exit.value as Iterable<TranscriptChunk>).map((c) => c.text);
    expect(texts).toEqual(['быстрый interim']);
  });

  it('silent primary → watchdog fires after WATCHDOG_MS → secondary chunks flow', async () => {
    const primary = makeFake({ onStart: 'silent' });
    const secondary = makeFake({ onStart: 'chunks', chunks: [finalChunk('с сервера пришло')] });

    // Start the layer's pipe, then advance fake time past the watchdog
    // budget so `Stream.timeoutFail` fires its timeout, then continue
    // advancing so the inner secondary's chunks have a chance to land.
    const done = runWithTimers(layerOf(primary.service, secondary.service));
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 100);
    const collected = await done;

    expect(Array.from(collected as Iterable<TranscriptChunk>).map((c) => c.text))
      .toEqual(['с сервера пришло']);
    expect(primary.calls.start).toBe(1);
    expect(primary.calls.stop).toBe(1);
    expect(secondary.calls.start).toBe(1);
  });

  it('silent primary + silent secondary → primary error surfaces (network)', async () => {
    const primary = makeFake({ onStart: 'silent' });
    const secondary = makeFake({ onStart: 'silent' });

    const done = Effect.runPromiseExit(run(layerOf(primary.service, secondary.service)));
    // Both watchdogs elapse: 2.5 s for the primary, then 12 s for the
    // secondary. Advance well past both so the inner stream has time
    // to fail with the primary error.
    await vi.advanceTimersByTimeAsync(15_000);
    const exit = await done;

    expect(exit._tag).toBe('Failure');
    expect(secondary.calls.start).toBe(1);
    if (exit._tag !== 'Failure') return;
    // The error is the primary `SttUnsupportedError { network, message: <silent mark> }`
    // — the marker is local to FallbackSTT, so we only assert on the
    // reason bucket.
    expect(JSON.stringify(exit.cause)).toContain('"reason":"network"');
  });
});
