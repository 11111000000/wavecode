import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import {
  gridAsScore,
  toggleCellState,
  clearGridState,
  getGrid,
  loadFromScore,
} from '../state/gridState';
import { dispatch, appStore } from '../state/appStore';
import { evalScore } from '../state/audioActions';
import {
  GRID_COLS,
  type GridRowSample,
} from '~/domain/music/gridTypes';

const ROW_LABELS: ReadonlyArray<{ sample: GridRowSample; label: string }> = [
  { sample: 'bd', label: 'kick' },
  { sample: 'sd', label: 'snare' },
  { sample: 'hh', label: 'hihat' },
  { sample: 'cp', label: 'clap' },
];

/**
 * <StepGrid /> — 4×8 drum-pad grid, mobile-friendly tap targets.
 *
 * Tap = toggle cell + emit tap-flash + auto-eval (so user hears result).
 * `↻ clear` resets grid. `↑ load` copies synthesized score into main
 * editor and triggers eval.
 */
export function StepGrid() {
  const [flashKey, setFlashKey] = createSignal<{ row: number; col: number } | null>(null);
  const [beat, setBeat] = createSignal(0);

  // Animate playhead: RAF tick counter, 0..GRID_COLS-1 cycling at 120 BPM
  // (8th notes = 60/120/2 = 0.25s = 4 ticks at 60Hz). Modest visual aid.
  let raf = 0;
  let last = performance.now();
  onMount(() => {
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      if (dt >= 0.125) {
        setBeat((b) => (b + 1) % GRID_COLS);
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const onCellTap = (row: number, col: number) => {
    toggleCellState(row, col);
    setFlashKey({ row, col });
    setTimeout(() => setFlashKey(null), 200);
    // Auto-eval so user hears result
    if (appStore.score.trim().length > 0) {
      // Only re-eval if there's already a playing score. Otherwise user
      // would need to click ▶ Запуск to start audio context (autoplay
      // policy). Just dispatch into score + let user click Запуск.
      const newScore = gridAsScore();
      dispatch({ type: 'replaceScore', text: newScore });
      void evalScore();
    } else {
      dispatch({ type: 'replaceScore', text: gridAsScore() });
    }
  };

  const onClear = () => {
    clearGridState();
  };

  const onLoad = () => {
    const newScore = gridAsScore();
    dispatch({ type: 'replaceScore', text: newScore });
    void evalScore();
  };

  const onLoadFromCurrent = () => {
    loadFromScore(appStore.score);
  };

  return (
    <div class="step-grid" role="grid" aria-label="Drum step sequencer 4×8">
      <div class="step-grid-toolbar">
        <button
          type="button"
          class="step-grid-btn"
          onClick={onLoadFromCurrent}
          title="Parse current score into grid (best-effort)"
        >
          ↓ read score
        </button>
        <button
          type="button"
          class="step-grid-btn"
          onClick={onClear}
          title="Clear all cells"
        >
          ↻ clear
        </button>
        <button
          type="button"
          class="step-grid-btn step-grid-btn-primary"
          onClick={onLoad}
          title="Load synthesized score into editor and play"
        >
          ↑ load & play
        </button>
        <span class="step-grid-hint">
          4×{GRID_COLS} drum pads — tap to toggle, auto-eval. Generates `stack(s('bd …'), s('sd …'), s('hh …'), s('cp …'))`.
        </span>
      </div>
      <div class="step-grid-rows">
        <For each={ROW_LABELS}>
          {(rowDef, rowIdx) => (
            <div class="step-grid-row" role="row">
              <div class="step-grid-row-label" title={rowDef.sample}>
                <span class="step-grid-row-sample">{rowDef.sample}</span>
                <span class="step-grid-row-name">{rowDef.label}</span>
              </div>
              <For each={Array.from({ length: GRID_COLS })}>
                {(_, colIdx) => {
                  const active = (): boolean => !!getGrid()[rowIdx()]?.[colIdx()];
                  const isFlash = (): boolean =>
                    flashKey()?.row === rowIdx() && flashKey()?.col === colIdx();
                  const isBeat = (): boolean => beat() === colIdx();
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      class={
                        'step-cell'
                        + (active() ? ' active' : '')
                        + (isFlash() ? ' tap-flash' : '')
                        + (isBeat() ? ' beat' : '')
                      }
                      aria-label={`${rowDef.sample} step ${colIdx() + 1}`}
                      aria-pressed={active()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onCellTap(rowIdx(), colIdx());
                      }}
                    >
                      <Show when={active()}>
                        <span class="step-cell-dot" />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
