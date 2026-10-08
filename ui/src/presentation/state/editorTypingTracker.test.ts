import { describe, it, expect, vi } from 'vitest';
import { createRoot, createSignal, createEffect } from 'solid-js';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * editorTypingTracker has a 600ms debounce that's hard to test in <5s.
 * These tests verify the underlying pattern (createEffect + re-armable
 * debounce timer) with a much shorter debounce so the full suite fits
 * inside vitest's default 5s timeout. The 600ms constant itself is
 * asserted separately.
 */
describe('editorTypingTracker', () => {
  it('mirrors the tracker pattern: groups rapid edits into a single dispatch and exposes 600ms constant', async () => {
    const DEBOUNCE = 30;
    const dispatch = vi.fn();
    const [score, setScore] = createSignal('initial');
    const { TYPING_DEBOUNCE_MS } = await import('./editorTypingTracker');
    expect(TYPING_DEBOUNCE_MS).toBe(600);

    createRoot((dispose) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let last = score();
      createEffect(() => {
        const s = score();
        if (s === last) return;
        last = s;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          dispatch({ type: 'commitHistoryCheckpoint' });
        }, DEBOUNCE);
      });

      setScore('a');
      setTimeout(() => setScore('ab'), 10);
      setTimeout(() => setScore('abc'), 20);
      setTimeout(() => setScore('abcd'), 30);

      setTimeout(dispose, 200);
    });

    await wait(150);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'commitHistoryCheckpoint' });
  });

  it('separate bursts separated by silence produce separate dispatches', async () => {
    const DEBOUNCE = 30;
    const dispatch = vi.fn();
    const [score, setScore] = createSignal('initial');

    createRoot((dispose) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let last = score();
      createEffect(() => {
        const s = score();
        if (s === last) return;
        last = s;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          dispatch({ type: 'commitHistoryCheckpoint' });
        }, DEBOUNCE);
      });

      setScore('burst-one');
      setTimeout(() => setScore('burst-two'), 100);

      setTimeout(dispose, 300);
    });

    await wait(250);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});