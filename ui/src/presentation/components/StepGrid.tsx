import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { Effect } from 'effect';
import {
  toggleCellState,
  clearGridState,
  getGrid,
  loadFromScore,
  appendGridToScore,
} from '../state/gridState';
import { dispatch, appStore } from '../state/appStore';
import { evalScore, previewSample } from '../state/audioActions';
import {
  GRID_COLS,
  type GridRowSample,
} from '~/domain/music/gridTypes';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';

const ROW_LABELS: ReadonlyArray<{ sample: GridRowSample; label: string }> = [
  { sample: 'bd', label: 'kick' },
  { sample: 'sd', label: 'snare' },
  { sample: 'hh', label: 'hihat' },
  { sample: 'cp', label: 'clap' },
];

/**
 * <StepGrid /> — 4×8 drum-pad grid, mobile-friendly tap targets.
 *
 * Tap = toggle cell + emit tap-flash + drum preview (no `audio.eval`,
 * no score replacement — see wavecode-step-append-sync packet).
 * `↻ clear` resets grid. `↑ load & play` merges synthesized score
 * into the current editor score (stack-concat or wrap-into-stack) and
 * triggers eval; it does NOT delete the user's existing composition.
 */
export function StepGrid() {
  const [flashKey, setFlashKey] = createSignal<{ row: number; col: number } | null>(null);
  const [beat, setBeat] = createSignal(0);

  // Sync playhead to AudioEngine.getCycleProgress() — same pattern as
  // TransportPanel. We don't tick on our own clock; when audio is
  // stopped, getCycleProgress returns 0, so beat() sticks to column 0
  // instead of lying about a phantom playhead position.
  let raf = 0;
  let lastWrite = 0;
  onMount(() => {
    const loop = (now: number) => {
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

  const onCellTap = (row: number, col: number) => {
    toggleCellState(row, col);
    previewSample(ROW_LABELS[row]!.sample);
    setFlashKey({ row, col });
    setTimeout(() => setFlashKey(null), 200);
  };

  const onClear = () => {
    clearGridState();
  };

  const onLoad = () => {
    const newScore = appendGridToScore(appStore.score, getGrid());
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
