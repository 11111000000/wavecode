import { For, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Effect } from 'effect';
import { GRID_COLS, GRID_ROWS } from '~/domain/music/gridTypes';
import {
  TERM_GESTURE_ROWS,
  TERM_ROW_LABELS,
  TERM_TARGET_OPTIONS,
  buildTermGrid,
  isTermCellActive,
  termProgress,
} from '~/domain/gesture/term';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import {
  clearGestureTermHits,
  commitTermPattern,
  gestureActive,
  gestureTermHits,
  gestureTermMode,
  gestureTermTarget,
  previewTermPattern,
  setGestureTermTarget,
} from '../state/gestureStore';

/**
 * <TermBox /> — «термин-бокс»: визуальная запись ритма жестами.
 *
 * Бокс показывает ЧЕТЫРЕ вещи, без которых режим терминовки нечитаем:
 *
 *   1. СЕТКУ 4×8 — куда легли попадания (строка = барабан, колонка = доля
 *      цикла). Ячейки горят там, где есть записанный удар.
 *   2. ЦЕЛЕВУЮ ДЛИНУ — сколько ударов пользователь собирается отбить
 *      (4 / 8 / 16). Прогресс «3 / 8 ударов»; на цели запись останавливается.
 *   3. МАППИНГ ЖЕСТ→СТРОКА — легенда «щипок → бочка» и т.д., с подсветкой
 *      жеста, который распознан прямо сейчас.
 *   4. КУКУЛУ — курсор текущей доли цикла: он показывает, куда ляжет
 *      следующий удар (та же асинхронная фаза, что у `<StepGrid />`).
 *
 * Действия: «прослушать» (один цикл записанного ритма), «готово» (записать
 * в сетку) и «очистить».
 *
 * Сетка здесь ТОЛЬКО ЧИТАЕТСЯ: ритм записывается жестами, а не кликами —
 * для ручной правки есть обычная сетка редактора.
 */
export function TermBox() {
  const [beat, setBeat] = createSignal(0);

  // The playhead follows AudioEngine.getCycleProgress() — the same async
  // phase the StepGrid uses. When the transport is stopped the progress is
  // 0, so the cursor sticks to the first column instead of lying about a
  // phantom position.
  let raf = 0;
  let lastWrite = 0;
  onMount(() => {
    const loop = (now: number): void => {
      if (now - lastWrite >= 14) {
        lastWrite = now;
        void Effect.runPromise(
          Effect.gen(function* () {
            const audio = yield* AudioEngine;
            return yield* audio.getCycleProgress();
          }).pipe(Effect.provide(AppLayer)),
        ).then((progress) => {
          const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
          setBeat(Math.floor(p * GRID_COLS) % GRID_COLS);
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const hits = (): ReturnType<typeof gestureTermHits> => gestureTermHits();
  const grid = createMemo(() => buildTermGrid(hits()));
  const progress = createMemo(() => termProgress(hits(), gestureTermTarget()));

  const cellActive = (row: number, col: number): boolean =>
    isTermCellActive(grid(), row, col);

  return (
    <div class="gesture-term" data-term-active={gestureTermMode() ? 'true' : 'false'}>
      <div class="gesture-term-head">
        <span class="gesture-term-title">терминовка</span>
        <span
          class="gesture-term-progress"
          data-complete={progress().complete ? 'true' : 'false'}
          data-testid="term-progress"
        >
          {progress().hits} / {progress().target} ударов
        </span>
      </div>

      <div class="gesture-term-legend" aria-label="Какой жест в какую строку">
        <For each={TERM_GESTURE_ROWS}>
          {(row) => (
            <span
              class="gesture-term-chip"
              data-active={gestureActive() === row.gesture ? 'true' : 'false'}
            >
              <span class="gesture-term-chip-gesture">{row.label}</span>
              <span class="gesture-term-chip-arrow">→</span>
              <span class="gesture-term-chip-row">{TERM_ROW_LABELS[row.sample]}</span>
            </span>
          )}
        </For>
      </div>

      <div class="gesture-term-target" role="group" aria-label="Целевая длина записи">
        <span class="gesture-term-target-label">длина</span>
        <For each={TERM_TARGET_OPTIONS}>
          {(target) => (
            <button
              type="button"
              class="gesture-term-target-btn"
              data-cta={`term-target-${target}`}
              data-active={gestureTermTarget() === target ? 'true' : 'false'}
              aria-pressed={gestureTermTarget() === target}
              onClick={() => setGestureTermTarget(target)}
            >
              {target}
            </button>
          )}
        </For>
        <span class="gesture-term-target-hint">
          {progress().complete
            ? 'цель достигнута — «готово» запишет ритм в сетку'
            : 'ударов'}
        </span>
      </div>

      <div class="gesture-term-grid" role="grid" aria-label="Сетка записи ритма 4×8">
        <For each={GRID_ROWS}>
          {(sample, rowIdx) => (
            <div class="gesture-term-row" role="row">
              <div class="gesture-term-row-label" title={TERM_ROW_LABELS[sample]}>
                <span class="gesture-term-row-sample">{sample}</span>
                <span class="gesture-term-row-name">{TERM_ROW_LABELS[sample]}</span>
              </div>
              <For each={Array.from({ length: GRID_COLS })}>
                {(_, colIdx) => (
                  <div
                    role="gridcell"
                    class={
                      'gesture-term-cell'
                      + (cellActive(rowIdx(), colIdx()) ? ' active' : '')
                      + (beat() === colIdx() ? ' beat' : '')
                    }
                    data-active={cellActive(rowIdx(), colIdx()) ? 'true' : 'false'}
                    aria-label={`${sample} доля ${colIdx() + 1}`}
                  />
                )}
              </For>
            </div>
          )}
        </For>
      </div>

      <div class="gesture-term-actions">
        <button
          type="button"
          class="gesture-btn"
          data-cta="term-preview"
          aria-label="Прослушать записанный ритм"
          disabled={hits().length === 0}
          onClick={() => {
            previewTermPattern();
          }}
        >
          прослушать
        </button>
        <button
          type="button"
          class="gesture-btn gesture-btn--primary"
          data-cta="term-commit"
          aria-label="Готово — записать собранный ритм в сетку"
          disabled={hits().length === 0}
          onClick={() => {
            commitTermPattern();
          }}
        >
          готово ({hits().length})
        </button>
        <button
          type="button"
          class="gesture-btn"
          data-cta="term-clear"
          aria-label="Очистить собранный ритм"
          disabled={hits().length === 0}
          onClick={() => clearGestureTermHits()}
        >
          очистить
        </button>
      </div>
    </div>
  );
}
