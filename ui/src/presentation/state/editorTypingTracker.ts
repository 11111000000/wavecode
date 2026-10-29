import { createEffect, createRoot, onCleanup, untrack } from 'solid-js';
import { appStore } from './appStore';

/**
 * Tracks score changes from manual typing and groups them into a single
 * undo checkpoint via `coalesceLatestHistoryEntry`.
 *
 * Behavior:
 *   - On every appStore.score change, restart a 600ms debounce timer.
 *   - When the timer fires (typing paused for 600ms), dispatch
 *     `coalesceLatestHistoryEntry` so the reducer drops the most
 *     recent intermediate history entry.
 *   - Programmatic replaceScore (e.g. preset load, undo/redo, IDB-load)
 *     goes through the same code path but the debounce absorbs rapid
 *     bursts and coalesces them into a single checkpoint.
 *
 * Why 600ms: macOS NSUndoManager defaults to 800ms; web IDEs use
 * 500–1000ms. 600ms is in the middle — fast enough that an explicit
 * pause feels acknowledged, slow enough that burst typing collapses
 * cleanly.
 */

export const TYPING_DEBOUNCE_MS = 600;

export const installTypingTracker = (dispatch: (event: { readonly type: 'coalesceLatestHistoryEntry' }) => void): (() => void) => {
  const dispose = createRoot((disposeFn) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastScore = untrack(() => appStore.score);

    createEffect(() => {
      const score = appStore.score;
      if (score === lastScore) return;
      lastScore = score;

      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        dispatch({ type: 'coalesceLatestHistoryEntry' });
      }, TYPING_DEBOUNCE_MS);
    });

    onCleanup(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    });

    return disposeFn;
  });

  return dispose;
};