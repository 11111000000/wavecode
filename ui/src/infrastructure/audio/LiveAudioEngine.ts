import { Effect, Layer } from 'effect';
import { AudioEngine } from '~/domain/services';

/**
 * Live AudioEngine — реальный Strudel runtime в main thread.
 *
 * Использует `webaudioRepl()` из `@strudel/webaudio`, который:
 *   - создаёт AudioContext,
 *   - запускает Cyclist scheduler,
 *   - подключает superdough для синтеза и сэмплов,
 *   - патчит mini-notation: stack, slow, fast, every, sometimes, jux и т.д.
 *
 * Web Audio API живёт только в main thread (browser limitation), Worker
 * не используется. Pattern eval быстрый (<10ms для типичных snippets),
 * main thread не блокируется.
 *
 * Известная проблема superdough (см. git history):
 * `createPeriodicWave(real, imag)` падает с IndexSizeError если
 * `real.length < 2` — бывает при пустых partials для custom waveforms.
 * Фикс: monkey-patch, дополняющий массивы до min length 2.
 */

const MIN_PERIODIC_WAVE_LENGTH = 2;

const patchCreatePeriodicWave = (): void => {
  if ((window as unknown as { __patchedPeriodicWave?: boolean }).__patchedPeriodicWave) return;
  const proto = AudioContext.prototype as unknown as {
    createPeriodicWave: (
      real: Float32Array,
      imag: Float32Array,
      constraints?: PeriodicWaveConstraints,
    ) => PeriodicWave;
  };
  const original = proto.createPeriodicWave.bind(proto);
  proto.createPeriodicWave = (real, imag, constraints) => {
    const padded = (arr: Float32Array): Float32Array => {
      if (arr.length >= MIN_PERIODIC_WAVE_LENGTH) return arr;
      const out = new Float32Array(MIN_PERIODIC_WAVE_LENGTH);
      out.set(arr);
      return out;
    };
    return original(padded(real), padded(imag), constraints);
  };
  (window as unknown as { __patchedPeriodicWave?: boolean }).__patchedPeriodicWave = true;
};

type ReplHandle = {
  evaluate: (code: string) => Promise<unknown>;
  stop: () => void;
};

let cachedRepl: Promise<ReplHandle> | null = null;

const loadRepl = (): Promise<ReplHandle> => {
  if (cachedRepl) return cachedRepl;
  cachedRepl = (async () => {
    patchCreatePeriodicWave();
    const webaudio = await import('@strudel/webaudio');
    const repl = webaudio.webaudioRepl();
    return {
      evaluate: (code) => repl.evaluate(code),
      stop: () => repl.stop(),
    };
  })();
  return cachedRepl;
};

export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  {
    eval: (snippet: string) =>
      Effect.gen(function* () {
        const repl = yield* Effect.tryPromise(() => loadRepl());
        yield* Effect.tryPromise({
          try: () => repl.evaluate(snippet),
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        });
      }),
    stop: () =>
      Effect.tryPromise({
        try: async () => {
          const repl = await loadRepl();
          repl.stop();
        },
        catch: () => null as null,
      }).pipe(Effect.catchAll(() => Effect.void)),
  },
);

/**
 * Eagerly bootstrap Strudel globals. Idempotent — safe to call multiple times.
 * Вызывается в onMount, чтобы LLM-возвраты работали до первого клика Eval.
 */
export const ensureAudioLoaded = (): Promise<void> =>
  loadRepl()
    .then(() => undefined)
    .catch(() => undefined);
