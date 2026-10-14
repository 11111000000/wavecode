import { For, Show, createSignal, onMount, onCleanup, createMemo } from 'solid-js';
import { Effect } from 'effect';
import {
  applyEditToLayer,
  clearDraft,
  commitDraft,
  dirtyCellCount,
  enterEdit,
  enterSketch,
  enterView,
  getDraftGrid,
  getLastCommittedGrid,
  getMode,
  toggleCellInDraft,
  isDraftClean,
} from '../state/gridState';
import { canEditGridLayer } from '~/application/useCases/editGridLayer';
import { dispatch, appStore } from '../state/appStore';
import { evalScore, previewSample, scheduleGridEdit } from '../state/audioActions';
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
 * <StepGrid /> — 4×8 drum-pad grid with three explicit interaction modes.
 *
 *   - view   — read-only mirror of the score. Tap = preview only.
 *              Default mode; safest for browsing/inspecting.
 *   - sketch — ephemeral draft buffer. Tap = preview + toggle cell.
 *              `↑ commit (N unsaved)` button writes draft to score
 *              via `appendGridToScore` + eval. Sheet close with dirty
 *              draft shows a confirm dialog.
 *   - edit   — direct, in-place edit of 4 `s("…")` rows. Tap = preview
 *              + write that cell back to the live score (debounced 50ms
 *              hot-swap). Gated on `canEditGridLayer(score)` — disabled
 *              with tooltip when the score doesn't have exactly 4
 *              s-layers in a top-level stack.
 *
 * The mode pill (3-segment toggle) is the ONLY way to switch modes.
 * The playhead cursor (`.beat` column) is still driven by
 * `AudioEngine.getCycleProgress()` — see `wavecode-step-append-sync`.
 */
export function StepGrid() {
  const [flashKey, setFlashKey] = createSignal<{ row: number; col: number } | null>(null);
  const [beat, setBeat] = createSignal(0);
  const [confirmOpen, setConfirmOpen] = createSignal(false);

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

  // Edit-mode gate: the toggle is disabled when the score isn't a
  // 4-s-layer top-level stack. Computed reactively so it updates as
  // the user edits the score.
  const editGate = createMemo(() => {
    const ok = canEditGridLayer(appStore.score);
    return {
      ok,
      reason: ok
        ? ''
        : 'Edit mode requires top-level stack(...) with exactly 4 s("…") rows. Use Sketch to add a drum layer.',
    };
  });

  // Mode-aware tap handler.
  const onCellTap = (row: number, col: number): void => {
    const mode = getMode();
    previewSample(ROW_LABELS[row]!.sample);
    setFlashKey({ row, col });
    setTimeout(() => setFlashKey(null), 200);

    if (mode === 'view') {
      // View mode: tap = preview only. No state change.
      return;
    }

    toggleCellInDraft(row, col);

    if (mode === 'sketch') {
      // Sketch: just toggle the draft. User commits explicitly via
      // the ↑ commit button. No eval, no audio hot-swap.
      return;
    }

    if (mode === 'edit') {
      // Edit: toggle the cell AND splice it into the live score via
      // editGridLayer, then hot-swap the scheduler (debounced 50ms).
      // The current score from `appStore.score` is the source of
      // truth — the scheduler will pick it up at the next lookahead.
      const newScore = applyEditToLayer(appStore.score);
      if (newScore !== null) {
        dispatch({ type: 'replaceScore', text: newScore });
        scheduleGridEdit(newScore, appStore.layerMix);
      }
    }
  };

  const onClear = (): void => {
    if (getMode() === 'sketch' && !isDraftClean()) {
      // In sketch mode with a dirty draft, clearing is destructive.
      // Show the confirm dialog so the user can Save / Discard /
      // Keep editing.
      setConfirmOpen(true);
      return;
    }
    clearDraft();
    // Re-seed from current score in the new mode's default state.
    const m = getMode();
    if (m === 'view') enterView(appStore.score);
    else if (m === 'sketch') enterSketch(appStore.score);
    else enterEdit(appStore.score);
  };

  const onCommit = (): void => {
    const newScore = commitDraft(appStore.score);
    if (newScore !== null) {
      dispatch({ type: 'replaceScore', text: newScore });
      void evalScore();
    }
  };

  const setMode = (next: 'view' | 'sketch' | 'edit'): void => {
    if (getMode() === next) return;
    const score = appStore.score;
    if (next === 'view') {
      enterView(score);
    } else if (next === 'sketch') {
      enterSketch(score);
    } else {
      const result = enterEdit(score);
      if (!result.ok) {
        // Should not happen because the toggle is disabled in this
        // case, but be defensive: revert to view.
        enterView(score);
      }
    }
  };

  return (
    <div class="step-grid" role="grid" aria-label="Drum step sequencer 4×8">
      <div class="step-grid-toolbar">
        <div class="step-grid-mode-pill" role="group" aria-label="Tap mode">
          <button
            type="button"
            class="step-grid-mode-btn"
            data-active={getMode() === 'view' ? 'true' : 'false'}
            aria-pressed={getMode() === 'view'}
            onClick={() => setMode('view')}
            title="Read-only mirror of the score. Tap = preview only."
          >
            view
          </button>
          <button
            type="button"
            class="step-grid-mode-btn"
            data-active={getMode() === 'sketch' ? 'true' : 'false'}
            aria-pressed={getMode() === 'sketch'}
            onClick={() => setMode('sketch')}
            title="Ephemeral draft. Tap to toggle cells, then ↑ commit to write to score."
          >
            sketch
          </button>
          <button
            type="button"
            class="step-grid-mode-btn"
            data-active={getMode() === 'edit' ? 'true' : 'false'}
            aria-pressed={getMode() === 'edit'}
            data-disabled={editGate().ok ? 'false' : 'true'}
            aria-disabled={!editGate().ok}
            disabled={!editGate().ok}
            onClick={() => setMode('edit')}
            title={editGate().ok
              ? 'Direct in-place edit of 4 s("…") rows. Every tap is a commit.'
              : editGate().reason}
          >
            edit
          </button>
        </div>
        <button
          type="button"
          class="step-grid-btn"
          onClick={onClear}
          title="Reset grid from score in current mode"
        >
          ↻ reset
        </button>
        <Show when={getMode() === 'sketch'}>
          <button
            type="button"
            class="step-grid-btn step-grid-btn-primary"
            onClick={onCommit}
            disabled={isDraftClean()}
            data-testid="step-grid-commit"
            title={isDraftClean()
              ? 'No changes to commit'
              : `Write draft to score (${dirtyCellCount()} cells changed)`}
          >
            ↑ commit{!isDraftClean() ? ` (${dirtyCellCount()})` : ''}
          </button>
        </Show>
        <span class="step-grid-hint" data-testid="step-grid-mode-hint">
          {getMode() === 'view' && '4×8 drum pads — read-only mirror. Tap to preview a hit.'}
          {getMode() === 'sketch' && (isDraftClean()
            ? '4×8 drum pads — sketch a beat, then ↑ commit.'
            : `4×8 drum pads — ${dirtyCellCount()} cell${dirtyCellCount() === 1 ? '' : 's'} unsaved.`)}
          {getMode() === 'edit' && (editGate().ok
            ? '4×8 drum pads — every tap writes the s("…") row + re-evaluates the scheduler.'
            : editGate().reason)}
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
                  const active = (): boolean => {
                    const g = getDraftGrid();
                    return !!g[rowIdx()]?.[colIdx()];
                  };
                  const isFlash = (): boolean =>
                    flashKey()?.row === rowIdx() && flashKey()?.col === colIdx();
                  const isBeat = (): boolean => beat() === colIdx();
                  // "Dirty" = draft cell differs from lastCommitted.
                  // For view mode they're always equal so this is false.
                  const isDirty = (): boolean => {
                    if (getMode() === 'view') return false;
                    const g = getDraftGrid();
                    const lc = getLastCommittedGrid();
                    return !!g[rowIdx()]?.[colIdx()] !== !!lc[rowIdx()]?.[colIdx()];
                  };
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      class={
                        'step-cell'
                        + (active() ? ' active' : '')
                        + (isDirty() ? ' dirty' : '')
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
      <Show when={confirmOpen()}>
        <div class="step-grid-confirm-backdrop" role="presentation" />
        <div
          class="step-grid-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-grid-confirm-title"
        >
          <h3 id="step-grid-confirm-title" class="step-grid-confirm-title">
            Discard unsaved changes?
          </h3>
          <p class="step-grid-confirm-body">
            {dirtyCellCount()} cell{dirtyCellCount() === 1 ? '' : 's'} in your sketch differ from
            the current score. Closing the sheet will discard them.
          </p>
          <div class="step-grid-confirm-actions">
            <button
              type="button"
              class="step-grid-btn"
              onClick={() => setConfirmOpen(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              class="step-grid-btn"
              onClick={() => {
                clearDraft();
                setConfirmOpen(false);
              }}
            >
              Discard
            </button>
            <button
              type="button"
              class="step-grid-btn step-grid-btn-primary"
              onClick={() => {
                const newScore = commitDraft(appStore.score);
                if (newScore !== null) {
                  dispatch({ type: 'replaceScore', text: newScore });
                  void evalScore();
                }
                setConfirmOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Helper used by App.tsx on sheet open: if the draft is empty AND
 * the score has been mutated outside (different from lastCommitted),
 * re-seed the draft from the current score. This is the "auto-load
 * on open" contract inherited from `wavecode-step-grid-autoload-and-sync`,
 * updated to be mode-aware: view mode always parses the current
 * score; sketch mode preserves a non-empty draft; edit mode is gated.
 */
export const syncGridFromScore = (): void => {
  const mode = getMode();
  if (mode === 'view') {
    enterView(appStore.score);
  } else if (mode === 'sketch') {
    if (isDraftClean() && getDraftGrid().every((r) => r.every((c) => !c))) {
      enterSketch(appStore.score);
    }
  } else {
    const result = enterEdit(appStore.score);
    if (!result.ok) enterView(appStore.score);
  }
};
