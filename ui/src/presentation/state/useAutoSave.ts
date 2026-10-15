import { createEffect } from 'solid-js';
import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { appStore } from './appStore';

/**
 * Two debounced IDB writes — `score` (500ms) and `dialogs` (500ms).
 * `activePresetId` is debounced separately as well. Each createEffect
 * subscribes to its own store slice; whichever changes last clears
 * its own timer and re-schedules. Separate timers so a noisy
 * dialog log doesn't push back a score save (and vice versa).
 */
export const useAutoSave = (): void => {
  let saveTimer: number | undefined;
  createEffect(() => {
    const score = appStore.score;
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveScore(score);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  let saveDialogsTimer: number | undefined;
  createEffect(() => {
    const dialogs = appStore.dialogs;
    if (saveDialogsTimer !== undefined) window.clearTimeout(saveDialogsTimer);
    saveDialogsTimer = window.setTimeout(() => {
      const plain = JSON.parse(JSON.stringify(dialogs));
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveDialogs(plain);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  let saveActiveTimer: number | undefined;
  createEffect(() => {
    const id = appStore.activePresetId;
    if (saveActiveTimer !== undefined) window.clearTimeout(saveActiveTimer);
    saveActiveTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveActivePresetId(id);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });
};
