/**
 * FallbackSTT tests — the retry policy, which is the only thing this
 * file decides. Both engines are in-process fakes; the real engines
 * are covered by their own tests.
 *
 * What is asserted
 * ----------------
 *   - `network` from the primary (the Android-Chrome-without-Google-
 *     services case) retries on the secondary and its chunks flow.
 *   - `permission-denied` does NOT retry: the second engine calls the
 *     same `getUserMedia` and would be refused identically.
 *   - `aborted` does not retry (barge-in / explicit cancel).
 *   - Both failing surfaces the PRIMARY error, because the UI copy is
 *     calibrated to it.
 *   - `stop()` reaches both engines, because the wrapper does not
 *     track which one is currently recording.
 */

import { describe, it, expect } from 'vitest';
import type { Context} from 'effect';
import { Effect, Layer, Stream } from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';
import type { TranscriptChunk } from '~/domain/voice/Transcript';
import { makeFallbackSTT } from './FallbackSTT';

const finalChunk = (text: string): TranscriptChunk => ({
  kind: 'final',
  text,
  confidence: 0.9,
  lang: 'ru-RU',
  timestampMs: 1_700_000_000_000,
});

const err = (
  reason: SttUnsupportedError['reason'],
  message: string = reason,
): SttUnsupportedError => ({ _tag: 'SttUnsupported', reason, message });

type FakeSpec = {
  readonly onStart: 'chunks' | 'fail';
  readonly chunks?: ReadonlyArray<TranscriptChunk>;
  readonly failWith?: SttUnsupportedError;
};

const makeFake = (spec: FakeSpec) => {
  const calls = { start: 0, stop: 0 };
  const service: Context.Tag.Service<typeof STTEngine> = {
    isSupported: () => Effect.succeed(true),
    start: (_opts: SttStartOptions) =>
      Effect.suspend(() => {
        calls.start += 1;
        return spec.onStart === 'fail'
          ? Effect.fail(spec.failWith ?? err('network'))
          : Effect.succeed(Stream.fromIterable(spec.chunks ?? []));
      }),
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

describe('FallbackSTT — retry policy', () => {
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