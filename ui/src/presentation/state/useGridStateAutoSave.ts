import { createEffect } from 'solid-js';
import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo, type GridStateSnapshot } from '~/domain/services';
import {
  getDraftGrid,
  getLastCommittedGrid,
  getMode,
} from './gridState';

/**
 * Debounced IDB write of StepGrid state (mode + draft + lastCommitted).
 * 500ms debounce matches `useAutoSave` for score/messages.
 *
 * Mounted by `useAppBootstrap` so the auto-save runs for the lifetime
 * of the app. Restoration happens once in `useAppBootstrap.onMount`
 * (before this effect starts running, so the first createEffect run
 * is a no-op write of the initial state).
 */
export const useGridStateAutoSave = (): void => {
  let saveTimer: number | undefined;
  createEffect(() => {
    const mode = getMode();
    const draft = getDraftGrid();
    const lastCommitted = getLastCommittedGrid();
    // Touch the inputs so Solid registers the dependency.
    const snapshot: GridStateSnapshot = { mode, draftGrid: draft, lastCommittedGrid: lastCommitted };
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const repo = yield* Repo;
          yield* repo.saveGridState(snapshot);
        }).pipe(Effect.provide(AppLayer)),
      );
    }, 500);
  });
};
