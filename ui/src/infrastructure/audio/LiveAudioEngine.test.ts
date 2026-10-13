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