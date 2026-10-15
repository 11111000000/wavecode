import { createEffect } from 'solid-js';
import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { appStore } from './appStore';

/**
 * Two debounced IDB writes — `tracks` (500ms) and `activeTrackId`
 * (500ms) and `gridState` (handled separately by useGridStateAutoSave).
 * Each createEffect subscribes to its own store slice; whichever
 * changes last clears its own timer and re-schedules. Separate
 * timers so a noisy tracks log doesn't push back an active-id save
 * (and vice versa).
 *
 * Note: this hook is intentionally the only writer of the tracks
 * and activeTrackId IDB keys. Reducer events mutate in-memory
 * state; the persistence layer mirrors that state to IDB.
 */
export const useAutoSave = (): void => {
  let saveTracksTimer: number | undefined;
  createEffect(() => {
    const tracks = appStore.tracks;
    if (saveTracksTimer !== undefined) window.clearTimeout(saveTracksTimer);
    saveTracksTimer = window.setTimeout(() => {
      const plain = JSON.parse(JSON.stringify(tracks));
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveTracks(plain);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });

  let saveActiveTimer: number | undefined;
  createEffect(() => {
    const id = appStore.activeTrackId;
    if (saveActiveTimer !== undefined) window.clearTimeout(saveActiveTimer);
    saveActiveTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveActiveTrackId(id);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });
};
