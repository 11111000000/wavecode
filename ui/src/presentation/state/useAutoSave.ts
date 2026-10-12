import { createEffect } from 'solid-js';
import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { appStore } from './appStore';

/**
 * Two debounced IDB writes — `score` (500ms) and `messages` (500ms).
 * Each createEffect subscribes to its own store slice; whichever changes
 * last clears its own timer and re-schedules. Separate timers so a noisy
 * messages log doesn't push back a score save (and vice versa).
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

  let saveMessagesTimer: number | undefined;
  createEffect(() => {
    const messages = appStore.messages;
    if (saveMessagesTimer !== undefined) window.clearTimeout(saveMessagesTimer);
    saveMessagesTimer = window.setTimeout(() => {
      const plain = JSON.parse(JSON.stringify(messages));
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveMessages(plain);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });
};
