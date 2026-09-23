/**
 * Live AudioEngine — real Strudel in main thread.
 *
 * Worker NOT used: Web Audio API is main-thread only (browser limitation).
 * `@strudel/webaudio` is bound to AudioContext. Pattern eval is fast
 * (<10ms for typical snippets); main thread is not blocked.
 *
 * Используем `webaudioRepl(snippet)` — это eval + auto-play через WebAudio.
 * (Раньше использовался `evalScope` из `@strudel/webaudio`, но он там не
 * экспортируется — `evalScope` живёт в `@strudel/core`.)
 *
 * If pattern parsing becomes a bottleneck later, split:
 *   - Main: AudioContext + audio playback
 *   - Worker: snippet transpile + AST validation
 * Use `new Worker(new URL('./strudel.worker.ts', import.meta.url), { type: 'module' })`.
 */

import { Effect, Layer, type Context } from 'effect';
import { AudioEngine } from '~/domain/services';

type WebAudioModule = {
  webaudioRepl: (code: string) => Promise<unknown>;
  hush: () => void;
};

let cached: WebAudioModule | null = null;

const ensureLoaded = async (): Promise<WebAudioModule> => {
  if (cached) return cached;
  const mod = await import('@strudel/webaudio');
  cached = {
    webaudioRepl: mod.webaudioRepl,
    hush: mod.hush,
  };
  return cached;
};

const impl: Context.Tag.Service<typeof AudioEngine> = {
  eval: (snippet: string) =>
    Effect.gen(function* () {
      const { webaudioRepl, hush } = yield* Effect.tryPromise(() => ensureLoaded());

      // Stop any existing patterns before starting new ones.
      try { hush(); } catch { /* ignore */ }

      yield* Effect.tryPromise({
        try: () => webaudioRepl(snippet) as Promise<unknown>,
        catch: (err) => {
          // eslint-disable-next-line no-console
          console.error('[wavecode audio] eval failed:', err);
          return err instanceof Error ? err : new Error(String(err));
        },
      });
    }),
  stop: () =>
    Effect.tryPromise({
      try: async () => {
        const { hush } = await ensureLoaded();
        hush();
      },
      catch: (err) => {
        // eslint-disable-next-line no-console
        console.warn('[wavecode audio] stop failed:', err);
        return null as null;
      },
    }).pipe(Effect.catchAll(() => Effect.void)),
};

export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  impl as never,
);