/**
 * Live AudioEngine — real Strudel in main thread.
 *
 * Worker NOT used: Web Audio API is main-thread only (browser limitation).
 * `@strudel/webaudio` is bound to AudioContext. Pattern eval is fast
 * (<10ms for typical snippets); main thread is not blocked.
 *
 * If pattern parsing becomes a bottleneck later, split:
 *   - Main: AudioContext + audio playback
 *   - Worker: snippet transpile + AST validation
 * Use `new Worker(new URL('./strudel.worker.ts', import.meta.url), { type: 'module' })`.
 */

import { Effect, Layer, type Context } from 'effect';
import { AudioEngine } from '~/domain/services';

type WebAudioModule = {
  evalScope: (code: string, evalFn?: unknown) => Promise<unknown>;
  webaudio: unknown;
  hush: () => void;
};

let cached: WebAudioModule | null = null;

const ensureLoaded = async (): Promise<WebAudioModule> => {
  if (cached) return cached;
  const mod = await import('@strudel/webaudio');
  cached = {
    evalScope: mod.evalScope,
    webaudio: mod.webaudio,
    hush: mod.hush,
  };
  return cached;
};

const impl: Context.Tag.Service<typeof AudioEngine> = {
  eval: (snippet: string) =>
    Effect.gen(function* () {
      const { evalScope, webaudio } = yield* Effect.tryPromise(() => ensureLoaded());
      yield* Effect.tryPromise({
        try: () => evalScope(snippet, webaudio) as Promise<unknown>,
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      });
    }),
  stop: () =>
    Effect.tryPromise({
      try: async () => {
        const { hush } = await ensureLoaded();
        hush();
      },
      catch: () => null as null,
    }).pipe(Effect.catchAll(() => Effect.void)),
};

export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  impl as never,
);