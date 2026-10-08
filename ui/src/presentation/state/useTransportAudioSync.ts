import { Effect } from 'effect';
import { onCleanup, createRoot, createEffect, untrack } from 'solid-js';
import { cps } from './transportState';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';

/**
 * Mount once at app-level: subscribe to `cps()` signal and push changes to
 * AudioEngine.setCps(), debounced. Fire-and-forget — UI не блокируется.
 *
 * Идемпотентно: повторный вызов — no-op. Изолировано от тестов
 * transportState (тесты не вызывают эту функцию).
 */

const SYNC_DEBOUNCE_MS = 100;

let installed = false;

export const installTransportAudioSync = (): void => {
  if (installed) return;
  installed = true;

  createRoot(() => {
    let audioTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPushed: number | null = null;

    createEffect(() => {
      const c = cps();
      // untrack lastPushed для безопасного чтения — это не сигнал, но
      // мы всё равно держим его внутри reactive scope.
      const previous = untrack(() => lastPushed);
      if (c === previous) return;
      lastPushed = c;
      if (audioTimer !== null) clearTimeout(audioTimer);
      audioTimer = setTimeout(() => {
        audioTimer = null;
        void Effect.runPromise(
          Effect.gen(function* () {
            const audio = yield* AudioEngine;
            yield* audio.setCps(c);
          }).pipe(Effect.provide(AppLayer)),
        );
      }, SYNC_DEBOUNCE_MS);
    });

    onCleanup(() => {
      if (audioTimer !== null) clearTimeout(audioTimer);
    });
  });
};
