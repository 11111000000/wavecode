/**
 * Live AudioEngine — real Strudel in main thread.
 *
 * Worker NOT used: Web Audio API is main-thread only (browser limitation).
 *
 * Как это работает в Strudel v1:
 *   1. Импортируем core/mini/tonal/webaudio модули
 *   2. Их exports пробрасываем на globalThis — это создаёт глобалы
 *      s(), n(), stack(), slow() и т.д., которые использует юзер-код
 *   3. Юзер-код eval'ится через Function() с globalThis-scope
 *   4. Получившийся Pattern передаётся в webaudioOutput() для воспроизведения
 *
 * Источник: https://codeberg.org/uzu/strudel/src/branch/main/website/src/...
 * (REPL реализация использует тот же подход)
 */

import { Effect, Layer, type Context } from 'effect';
import { AudioEngine } from '~/domain/services';

type WebAudioModule = {
  webaudioOutput: (pattern: unknown, ...rest: unknown[]) => unknown;
  hush: () => void;
};

let webaudioCache: WebAudioModule | null = null;
let bootstrapped = false;

const ensureLoaded = async (): Promise<WebAudioModule> => {
  if (webaudioCache && bootstrapped) return webaudioCache;

  // Load only the modules we need: webaudio (for output+hush) and core/mini/tonal
  // (for s/n/stack/slow/etc. primitives exposed to user code).
  // NB: NOT @strudel/transpiler — broken peer-dep in v1.x browser bundle.
  const [webaudio, core, mini, tonal] = await Promise.all([
    import('@strudel/webaudio'),
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
  ]);

  webaudioCache = webaudio;

  if (!bootstrapped) {
    for (const mod of [core, mini, tonal, webaudio]) {
      for (const [name, value] of Object.entries(mod)) {
        (globalThis as unknown as Record<string, unknown>)[name] = value;
      }
    }
    bootstrapped = true;
  }

  return webaudio;
};

/**
 * Evaluate user code in globalThis scope (where s, n, stack etc. live).
 * Returns the Pattern object (or undefined).
 *
 * Используем wrap-стратегию как @strudel/core:
 *   user snippet → `(async () => { <snippet> })()` → return result.
 * Это позволяет коду содержать комментарии, объявления переменных, и
 * возвращать значение последнего expression-statement.
 *
 * NB: мы НЕ используем @strudel/transpiler (сломан peer-dep в browser bundle),
 * просто компилируем snippet через Function(). Наш default score не требует
 * транспиляции — это plain JS: `stack(n(...).s(...), n(...).s(...)).slow(2)`.
 */
const evaluateSnippet = async (snippet: string): Promise<unknown> => {
  const fn = new Function(
    `"use strict";return (async () => { ${snippet} })()`,
  );
  return fn();
};

const impl: Context.Tag.Service<typeof AudioEngine> = {
  eval: (snippet: string) =>
    Effect.gen(function* () {
      const webaudio = yield* Effect.tryPromise(() => ensureLoaded());

      // Stop any existing patterns first (avoid layering).
      try { webaudio.hush(); } catch { /* ignore */ }

      yield* Effect.tryPromise({
        try: async () => {
          const pattern = await evaluateSnippet(snippet);
          if (pattern && typeof pattern === 'object') {
            webaudio.webaudioOutput(pattern);
          }
        },
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
        const webaudio = await ensureLoaded();
        webaudio.hush();
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