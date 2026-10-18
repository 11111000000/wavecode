import {
  For,
  Show,
  createSignal,
  onMount,
  onCleanup,
  createMemo,
} from 'solid-js';
import { Effect } from 'effect';
import {
  applyMelodyEditToLayer,
  clearMelodyDraft,
  commitMelodyDraft,
  dirtyMelodyCount,
  enterMelodyEdit,
  enterMelodySketch,
  enterMelodyView,
  getMelodyDraft,
  getMelodyLastCommitted,
  getMelodyMode,
  isMelodyDraftClean,
  toggleMelodyCell,
  isMelodyCellActive,
} from '../state/melodyGridState';
import { canEditMelodyLayer } from '~/domain/music/melodyExtract';
import {
  MELODY_COLS,
  MELODY_PITCH_HIGH,
  MELODY_PITCH_LOW,
  melodyPitchRows,
  type MelodyMode,
} from '~/domain/music/melodyGridTypes';
import { noteNumberToName, singleNoteSnippet } from '~/domain/music/notes';
import { dispatch, appStore } from '../state/appStore';
import { evalScore, scheduleGridEdit } from '../state/audioActions';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';

/**
 * <MelodyGrid /> — 16-step × 36-pitch piano-roll grid with three
 * explicit interaction modes.
 *
 *   - view   — read-only mirror of the score's first `note(…)` /
 *              `n(…)` string arg. Tap = preview via Web Audio +
 *              raw `OscillatorNode` (no Strudel evaluator); no
 *              state change.
 *   - sketch — ephemeral draft buffer. Tap = preview + toggle a
 *              cell. `↑ commit` writes the draft to the score
 *              via `commitMelodyDraft` + eval.
 *   - edit   — direct, in-place edit of the first `note(…)` /
 *              `n(…)` call's string arg inside the top stack.
 *              Every tap splices the cell back to the live score
 *              (debounced 50ms `scheduleGridEdit` hot-swap).
 *              Gated on `canEditMelodyLayer(score)` — disabled
 *              with tooltip otherwise.
 *
 * The mode pill (3-segment toggle) is the ONLY way to switch
 * modes (mirrors `StepGrid`). The playhead column highlight
 * is driven by `AudioEngine.getCycleProgress()` — same pattern
 * as the drum StepGrid and `TransportPanel`.
 *
 * Drum + melody grids are deliberately separate components and
 * separate state slices — they target different AST subtrees and
 * never touch each other's args.
 */

const ROWS = melodyPitchRows();

/**
 * Compose a short preview snippet that plays a single MIDI note
 * via triangle wave (matches pianoRecStore's preview path — no
 * need to re-evaluate Strudel for tap preview).
 */
const previewMidi = (midi: number): void => {
  const name = noteNumberToName(midi).toLowerCase();
  void singleNoteSnippet(name);
  // Bypass Strudel eval for tap preview: use a raw oscillator
  // cycle. We mirror `previewSample` from the drum StepGrid —
  // direct `OscillatorNode` on the shared AudioContext, < 500ms
  // of sound, no scheduling overhead.
  try {
    const audioCtx = (
      window as unknown as { __wavecodeAudioCtx?: AudioContext }
    ).__wavecodeAudioCtx;
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.25, t0 + 0.005);
    gain.gain.linearRampToValueAtTime(0.025, t0 + 0.4);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.55);
    osc.onended = (): void => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  } catch {
    /* preview is best-effort */
  }
};

export function MelodyGrid() {
  const [flashKey, setFlashKey] = createSignal<{ step: number; midi: number } | null>(
    null,
  );
  const [beat, setBeat] = createSignal(0);
  const [confirmOpen, setConfirmOpen] = createSignal(false);

  // Sync playhead to AudioEngine.getCycleProgress() — same RAF
  // pattern as drum StepGrid.
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
          setBeat(Math.floor(p * MELODY_COLS) % MELODY_COLS);
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  // Edit-mode gate: the toggle is disabled when the score has no
  // top-level `note(…)` / `n(…)` call to splice.
  const editGate = createMemo(() => {
    const ok = canEditMelodyLayer(appStore.score);
    return {
      ok,
      reason: ok
        ? ''
        : 'Edit mode requires a top-level note(…) or n(…) call. Use Sketch to add a melody layer.',
    };
  });

  const onCellTap = (step: number, midi: number): void => {
    const mode = getMelodyMode();
    previewMidi(midi);
    setFlashKey({ step, midi });
    setTimeout(() => setFlashKey(null), 200);

    if (mode === 'view') {
      // View: tap = preview only. No state change.
      return;
    }

    toggleMelodyCell(step, midi);

    if (mode === 'sketch') {
      // Sketch: just toggle the draft. User commits explicitly.
      return;
    }

    if (mode === 'edit') {
      // Edit: toggle the cell AND splice it back to the live score.
      const newScore = applyMelodyEditToLayer(appStore.score);
      if (newScore !== null) {
        dispatch({ type: 'replaceScore', text: newScore });
        scheduleGridEdit(newScore, appStore.layerMix);
      }
    }
  };

  const onClear = (): void => {
    if (getMelodyMode() === 'sketch' && !isMelodyDraftClean()) {
      setConfirmOpen(true);
      return;
    }
    clearMelodyDraft();
    const m = getMelodyMode();
    if (m === 'view') enterMelodyView(appStore.score);
    else if (m === 'sketch') enterMelodySketch(appStore.score);
    else enterMelodyEdit(appStore.score);
  };

  const onCommit = (): void => {
    const newScore = commitMelodyDraft(appStore.score);
    if (newScore !== null) {
      dispatch({ type: 'replaceScore', text: newScore });
      void evalScore();
    }
  };

  const setMode = (next: MelodyMode): void => {
    if (getMelodyMode() === next) return;
    const score = appStore.score;
    if (next === 'view') {
      enterMelodyView(score);
    } else if (next === 'sketch') {
      enterMelodySketch(score);
    } else {
      const result = enterMelodyEdit(score);
      if (!result.ok) enterMelodyView(score);
    }
  };

  const bpmLabel = createMemo((): string => {
    // cps * 60 (≈ BPM at 1 cycle = 1 beat default convention).
    const cps = appStore.transportState.cps;
    const bpm = Math.round(cps * 60);
    return Number.isFinite(bpm) && bpm > 0 ? `${bpm} BPM` : '120 BPM';
  });

  return (
    <div class="melody-grid" role="grid" aria-label="Melody step sequencer 16×36">
      <div class="melody-grid-toolbar">
        <div class="melody-grid-mode-pill" role="group" aria-label="Tap mode">
          <button
            type="button"
            class="melody-grid-mode-btn"
            data-active={getMelodyMode() === 'view' ? 'true' : 'false'}
            aria-pressed={getMelodyMode() === 'view'}
            onClick={() => setMode('view')}
            title="Read-only mirror of the score's melody. Tap to preview a note."
          >
            view
          </button>
          <button
            type="button"
            class="melody-grid-mode-btn"
            data-active={getMelodyMode() === 'sketch' ? 'true' : 'false'}
            aria-pressed={getMelodyMode() === 'sketch'}
            onClick={() => setMode('sketch')}
            title="Ephemeral draft. Tap to toggle cells, then ↑ commit to write to score."
          >
            sketch
          </button>
          <button
            type="button"
            class="melody-grid-mode-btn"
            data-active={getMelodyMode() === 'edit' ? 'true' : 'false'}
            aria-pressed={getMelodyMode() === 'edit'}
            data-disabled={editGate().ok ? 'false' : 'true'}
            aria-disabled={!editGate().ok}
            disabled={!editGate().ok}
            onClick={() => setMode('edit')}
            title={editGate().ok
              ? 'Direct in-place edit of the first note(…) / n(…) call. Every tap is a commit.'
              : editGate().reason}
          >
            edit
          </button>
        </div>
        <button
          type="button"
          class="melody-grid-btn"
          onClick={onClear}
          title="Reset grid from score in current mode"
        >
          ↻ reset
        </button>
        <Show when={getMelodyMode() === 'sketch'}>
          <button
            type="button"
            class="melody-grid-btn melody-grid-btn-primary"
            onClick={onCommit}
            disabled={isMelodyDraftClean()}
            data-testid="melody-grid-commit"
            title={isMelodyDraftClean()
              ? 'No changes to commit'
              : `Write draft to score (${dirtyMelodyCount()} cells changed)`}
          >
            ↑ commit
            {!isMelodyDraftClean() ? ` (${dirtyMelodyCount()})` : ''}
          </button>
        </Show>
        <span
          class="melody-grid-hint"
          data-testid="melody-grid-mode-hint"
          aria-live="polite"
        >
          {getMelodyMode() === 'view' &&
            `16-step × 36-pitch piano-roll — read-only mirror of the score's first note(…) call. Tap to preview.`}
          {getMelodyMode() === 'sketch' &&
            (isMelodyDraftClean()
              ? 'Piano-roll sketch — tap cells, then ↑ commit.'
              : `Piano-roll sketch — ${dirtyMelodyCount()} cell${dirtyMelodyCount() === 1 ? '' : 's'} unsaved.`)}
          {getMelodyMode() === 'edit' &&
            (editGate().ok
              ? 'Piano-roll edit — every tap splices note(…) in place + hot-swaps scheduler.'
              : editGate().reason)}
        </span>
        <span class="melody-grid-bpm" data-testid="melody-grid-bpm">
          {bpmLabel()}
        </span>
      </div>
      <div
        class="melody-grid-rows"
        style={{
          'grid-template-columns':
            `minmax(56px, max-content) repeat(${MELODY_COLS}, minmax(0, 1fr))`,
        }}
      >
        {/* Header row: beat numbers 1..16. */}
        <div class="melody-grid-row melody-grid-row-header" aria-hidden="true">
          <div class="melody-grid-row-label melody-grid-row-label-header">
            pitch
          </div>
          <For each={Array.from({ length: MELODY_COLS })}>
            {(_, colIdx) => {
              const isBeat = (): boolean => beat() === colIdx();
              return (
                <div
                  class={
                    'melody-grid-col-header' + (isBeat() ? ' beat' : '')
                  }
                >
                  {colIdx() + 1}
                </div>
              );
            }}
          </For>
        </div>
        {/* Pitch rows: high → low so the visual order is "treble on top" (piano-roll convention). */}
        <For each={[...ROWS].reverse()}>
          {(midi) => {
            const isBlack = (): boolean => {
              const pc = ((midi % 12) + 12) % 12;
              return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
            };
            const rowLabel = (): string => noteNumberToName(midi);
            return (
              <div class="melody-grid-row" role="row">
                <div
                  class={
                    'melody-grid-row-label'
                    + (isBlack() ? ' melody-grid-row-label--black-key' : '')
                  }
                  title={rowLabel()}
                >
                  <span class="melody-grid-row-pitch">{rowLabel()}</span>
                </div>
                <For each={Array.from({ length: MELODY_COLS })}>
                  {(_, colIdx) => {
                    const active = (): boolean =>
                      isMelodyCellActive(colIdx(), midi);
                    const isFlash = (): boolean =>
                      flashKey()?.step === colIdx() && flashKey()?.midi === midi;
                    const isBeat = (): boolean => beat() === colIdx();
                    const isDirty = (): boolean => {
                      if (getMelodyMode() === 'view') return false;
                      const d = getMelodyDraft();
                      const lc = getMelodyLastCommitted();
                      const inDraft = d.some(
                        (c) => c.step === colIdx() && c.midi === midi,
                      );
                      const inLast = lc.some(
                        (c) => c.step === colIdx() && c.midi === midi,
                      );
                      return inDraft !== inLast;
                    };
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        class={
                          'melody-cell'
                          + (active() ? ' active' : '')
                          + (isDirty() ? ' dirty' : '')
                          + (isFlash() ? ' tap-flash' : '')
                          + (isBeat() ? ' beat' : '')
                        }
                        aria-label={`${rowLabel()} step ${colIdx() + 1}`}
                        aria-pressed={active()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onCellTap(colIdx(), midi);
                        }}
                      >
                        <Show when={active()}>
                          <span class="melody-cell-dot" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={confirmOpen()}>
        <div class="melody-grid-confirm-backdrop" role="presentation" />
        <div
          class="melody-grid-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="melody-grid-confirm-title"
        >
          <h3
            id="melody-grid-confirm-title"
            class="melody-grid-confirm-title"
          >
            Discard unsaved changes?
          </h3>
          <p class="melody-grid-confirm-body">
            {dirtyMelodyCount()} cell
            {dirtyMelodyCount() === 1 ? '' : 's'} in your sketch differ
            from the current score. Closing the sheet will discard them.
          </p>
          <div class="melody-grid-confirm-actions">
            <button
              type="button"
              class="melody-grid-btn"
              onClick={() => setConfirmOpen(false)}
            >
              Keep editing
            </button>
            <button
              type="button"
              class="melody-grid-btn"
              onClick={() => {
                clearMelodyDraft();
                setConfirmOpen(false);
              }}
            >
              Discard
            </button>
            <button
              type="button"
              class="melody-grid-btn melody-grid-btn-primary"
              onClick={() => {
                const newScore = commitMelodyDraft(appStore.score);
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
 * Helper used by App.tsx on sheet open: same contract as the
 * drum StepGrid's `syncGridFromScore`. Re-seeds the draft from
 * the live score when the mode warrants it (view mode always,
 * sketch mode only if the draft is empty, edit mode if the
 * score is parseable).
 */
export const syncMelodyFromScore = (): void => {
  const mode = getMelodyMode();
  if (mode === 'view') {
    enterMelodyView(appStore.score);
  } else if (mode === 'sketch') {
    if (isMelodyDraftClean() && getMelodyDraft().length === 0) {
      enterMelodySketch(appStore.score);
    }
  } else {
    const result = enterMelodyEdit(appStore.score);
    if (!result.ok) enterMelodyView(appStore.score);
  }
};

// Keep names referenced to satisfy strict-mode unused-locals
// when these are conditionally compiled out.
void MELODY_PITCH_LOW;
void MELODY_PITCH_HIGH;
