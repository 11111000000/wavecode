import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { AudioEngine, type AppEnv } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';

/**
 * LiveAudioEngine.setCps — race-free integration with debug.cps.
 *
 * Bug history (wavecode-step-grid-autoload-and-sync):
 *   useTransportAudioSync's createEffect fires 100ms after cps() seeds.
 *   If no eval has happened by then, cachedRepl is null, so the inner
 *   repl.setCps is never reached and never updates debugState.cps.
 *   The next audio.eval then captures evalCps=0 and the playhead
 *   sticks at column 0 forever.
 *
 * Fix: outer service.setCps must update debugState.cps SYNCHRONOUSLY
 * regardless of cachedRepl state.
 */

const runWith = <A>(eff: Effect.Effect<A, never, AppEnv>): Promise<A> =>
  Effect.runPromise(Effect.provide(eff, AppLayer)) as Promise<A>;

describe('AudioEngine.setCps — race against cachedRepl', () => {
  it('updates debug.cps even when cachedRepl is null (early setCps)', async () => {
    const { getDebug } = await import('~/infrastructure/audio/LiveAudioEngine');
    const before = getDebug().cps;
    expect(before).toBe(0);
    await runWith(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.setCps(0.5);
      }),
    );
    const after = getDebug().cps;
    expect(after).toBe(0.5);
  });

  it('getCycleProgress returns a value in [0, 1]', async () => {
    await import('~/infrastructure/audio/LiveAudioEngine');
    const p = await runWith(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        return yield* audio.getCycleProgress();
      }),
    );
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
/**
 * Boot-order invariant for superdough's AudioWorklet modules.
 *
 * `initAudio()` resolves superdough's AudioContext internally and calls
 * `audioWorklet.addModule()` on it, creating its own context if none is
 * set. Worklet processors live in a per-BaseAudioContext registry, so
 * pinning the context AFTER the worklets load leaves the app context
 * with an empty registry and every worklet-backed node throws per hap:
 *
 *   [getTrigger] error: Failed to construct 'AudioWorkletNode'
 *
 * Nothing covered this ordering before, which is how the bug shipped.
 */
describe('primeSuperdoughAudio — worklet context ordering', () => {
  const fakeCtx = {} as AudioContext;

  const makeRuntime = () => {
    const calls: string[] = [];
    const contexts: unknown[] = [];
    return {
      calls,
      contexts,
      runtime: {
        registerSynthSounds: () => calls.push('registerSynthSounds'),
        setAudioContext: (ctx: AudioContext) => {
          calls.push('setAudioContext');
          contexts.push(ctx);
        },
        initAudio: async () => {
          calls.push('initAudio');
        },
      } as unknown as Parameters<typeof import('./LiveAudioEngine').primeSuperdoughAudio>[0],
    };
  };

  it('pins the app AudioContext BEFORE loading worklet modules', async () => {
    const { primeSuperdoughAudio } = await import('~/infrastructure/audio/LiveAudioEngine');
    const { calls, contexts, runtime } = makeRuntime();
    await primeSuperdoughAudio(runtime, fakeCtx);
    expect(calls).toEqual(['setAudioContext', 'initAudio']);
    expect(contexts).toEqual([fakeCtx]);
  });

  it('does not throw when initAudio fails — audio must still start', async () => {
    const { primeSuperdoughAudio } = await import('~/infrastructure/audio/LiveAudioEngine');
    const { calls, runtime } = makeRuntime();
    const failing = {
      ...runtime,
      initAudio: async () => {
        calls.push('initAudio');
        throw new Error('worklet load failed');
      },
    } as unknown as Parameters<typeof import('./LiveAudioEngine').primeSuperdoughAudio>[0];
    await expect(primeSuperdoughAudio(failing, fakeCtx)).resolves.toBeUndefined();
    // The context was still pinned first, so a later retry can succeed.
    expect(calls).toEqual(['setAudioContext', 'initAudio']);
  });
});
