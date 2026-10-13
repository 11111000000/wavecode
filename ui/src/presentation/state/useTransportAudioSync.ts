import { Effect } from 'effect';
import { onCleanup, createRoot, createEffect, untrack } from 'solid-js';
import { cps, swingAmount, swingDivisor } from './transportState';
import { reEvalScoreWithTransport } from './audioActions';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';

/**
 * Mount once at app-level: subscribe to transport signals and push
 * changes to AudioEngine.
 *
 *   cps(): debounced 100ms → `audio.setCps(c)` — hot-swap, no re-eval.
 *   swingAmount()/swingDivisor(): debounced 100ms →
 *     `reEvalScoreWithTransport()` — перепарсит score с новой
 *     `.swing(...)` обёрткой. Strudel API не поддерживает hot-swap
 *     для swing, требует `repl.evaluate(snippet)`.
 *
 * Re-eval запускается ТОЛЬКО если `AudioContext.state === 'running'`
 * — slider drag сам по себе не должен будить звук (юзер не нажимал
 * Play). Если ctx suspended/closed — обновляем lastEvaluatedSwing для
 * идемпотентности, eval не делаем.
 *
 * Skip при равенстве с lastEvaluatedSwing — Solid не пере-запускает
 * эффект при одинаковом значении, но защищаемся от лишних таймеров
 * после HMR / dispose+remount.
 *
 * Fire-and-forget — UI не блокируется. Идемпотентно: повторный
 * вызов installTransportAudioSync() — no-op. Изолировано от unit-тестов
 * transportState (тесты не вызывают install, см. `__resetForTesting`).
 */

const SYNC_DEBOUNCE_MS = 100;

type SwingSig = { readonly amount: number; readonly divisor: string };

let installed = false;

export const installTransportAudioSync = (): void => {
  if (installed) return;
  installed = true;

  createRoot(() => {
    let cpsTimer: ReturnType<typeof setTimeout> | null = null;
    let swingTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPushedCps: number | null = null;
    let lastEvaluatedSwing: SwingSig | null = null;

    createEffect(() => {
      const c = cps();
      const previous = untrack(() => lastPushedCps);
      if (c === previous) return;
      lastPushedCps = c;
      if (cpsTimer !== null) clearTimeout(cpsTimer);
      cpsTimer = setTimeout(() => {
        cpsTimer = null;
        void Effect.runPromise(
          Effect.gen(function* () {
            const audio = yield* AudioEngine;
            yield* audio.setCps(c);
          }).pipe(Effect.provide(AppLayer)),
        );
      }, SYNC_DEBOUNCE_MS);
    });

    createEffect(() => {
      const a = swingAmount();
      const d = swingDivisor();
      const previous = untrack(() => lastEvaluatedSwing);
      if (previous !== null && previous.amount === a && previous.divisor === d) return;
      lastEvaluatedSwing = { amount: a, divisor: d };
      if (swingTimer !== null) clearTimeout(swingTimer);
      swingTimer = setTimeout(() => {
        swingTimer = null;
        // Gate: re-eval only if audio is actually playing. Slider drag
        // alone must not start the engine — that is evalScore()'s job
        // (Play button). Persisted swing value still updates via the
        // signal+reducer above; user just needs to hit Play to hear it.
        const ctx = (
          window as unknown as { __wavecodeAudioCtx?: AudioContext }
        ).__wavecodeAudioCtx;
        if (!ctx || ctx.state !== 'running') return;
        void reEvalScoreWithTransport();
      }, SYNC_DEBOUNCE_MS);
    });

    onCleanup(() => {
      if (cpsTimer !== null) clearTimeout(cpsTimer);
      if (swingTimer !== null) clearTimeout(swingTimer);
    });
  });
};

/**
 * Test-only escape hatch: сбрасывает module-level `installed` флаг,
 * чтобы следующий `installTransportAudioSync()` создал новый
 * `createRoot`. В prod не вызывается — оставлено под `__` префиксом.
 */
export const __resetTransportAudioSyncForTesting = (): void => {
  installed = false;
};
