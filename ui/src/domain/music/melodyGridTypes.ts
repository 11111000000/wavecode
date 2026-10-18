/**
 * Melody Grid types: 16 columns (steps) × 36 pitch rows (C3..B5).
 *
 * Complements the drum StepGrid (`./gridTypes.ts`). The two grids are
 * independent domains — drum is a boolean matrix (`Grid`); melody is
 * a sparse `(step, midi)` tuple list (`MelodyCell`). They use
 * different AST targets (s("…") vs note(…)/n(…)) and have different
 * structural gates; we deliberately keep the state separate
 * (`melodyGridState.ts` instead of merging into `gridState.ts`).
 *
 * Pitch range:
 *   - low  = 48 → C3 (the lowest key of the on-screen piano).
 *   - high = 83 → B5 (cover two+ octaves of typical bass–lead range).
 *   - 84-48+1 = 36 pitch rows. Y-axis is ascending low → high so
 *     that the visual reading matches piano-roll convention
 *     (low pitch at the bottom).
 *
 * Step count:
 *   - 16 = 1/16 grid. Matches the `pianoTranscribe` quantize
 *     default (16 divisions per quarter) so a piano take and
 *     a grid composition occupy the same time surface.
 */

export const MELODY_COLS = 16;
export const MELODY_PITCH_LOW = 48; // C3
export const MELODY_PITCH_HIGH = 83; // B5

export type MelodyPitchRange = {
  readonly low: number;
  readonly high: number;
};

/** Single cell: one note on/off at (step, midi). Rests are not
 *  stored — gaps are implicit from the absence of a cell. */
export type MelodyCell = {
  readonly step: number;
  readonly midi: number;
};

/** Lazy sequence of cells in column-major order (sorted by `step`
 *  ascending, then `midi` ascending within each step). The list
 *  is sparse: missing (step, midi) pairs are OFF. */
export type MelodyGrid = ReadonlyArray<MelodyCell>;

/** Empty melody (no cells). */
export const emptyMelody = (): MelodyGrid => [];

/** True iff the cell list has no entries. */
export const isMelodyEmpty = (g: MelodyGrid): boolean => g.length === 0;

/** Build the full ascending list of pitch rows in the supported
 *  range (inclusive on both ends). Used by `<MelodyGrid />` to
 *  iterate rows. */
export const melodyPitchRows = (): ReadonlyArray<number> => {
  const out: number[] = [];
  for (let n = MELODY_PITCH_LOW; n <= MELODY_PITCH_HIGH; n += 1) {
    out.push(n);
  }
  return out;
};

/** Sorted index of `midi` within `melodyPitchRows()`. Used to
 *  find the row index of a tapped cell. */
export const indexOfPitch = (midi: number): number => midi - MELODY_PITCH_LOW;

/**
 * Add a cell (no-op if already present). Returns a new list
 * sorted by `(step, midi)`. Pure.
 */
export const addCell = (g: MelodyGrid, cell: MelodyCell): MelodyGrid => {
  if (g.some((c) => c.step === cell.step && c.midi === cell.midi)) return g;
  const next = [...g, cell];
  next.sort((a, b) => a.step - b.step || a.midi - b.midi);
  return next;
};

/** Remove a cell (no-op if not present). Returns a new list
 *  preserving original order. Pure. */
export const removeCell = (g: MelodyGrid, step: number, midi: number): MelodyGrid =>
  g.filter((c) => !(c.step === step && c.midi === midi));

/** Toggle a cell: present → remove, absent → add. Pure. */
export const toggleCellInMelody = (
  g: MelodyGrid,
  step: number,
  midi: number,
): MelodyGrid => {
  if (g.some((c) => c.step === step && c.midi === midi)) {
    return removeCell(g, step, midi);
  }
  return addCell(g, { step, midi });
};

/** True iff a cell is active in `g`. */
export const isCellActive = (g: MelodyGrid, step: number, midi: number): boolean =>
  g.some((c) => c.step === step && c.midi === midi);

/** Two melodies have identical cell sets. Used for `dirtyCount`
 *  computation. Order-independent. */
export const melodiesEqual = (a: MelodyGrid, b: MelodyGrid): boolean => {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((c) => `${c.step}:${c.midi}`));
  for (const c of b) {
    if (!setA.has(`${c.step}:${c.midi}`)) return false;
  }
  return true;
};

/** Number of cells that differ between two melodies. Order-
 *  independent (set-based). 0 ≤ result ≤ a.length + b.length. */
export const countMelodyDiff = (a: MelodyGrid, b: MelodyGrid): number => {
  const setA = new Set(a.map((c) => `${c.step}:${c.midi}`));
  const setB = new Set(b.map((c) => `${c.step}:${c.midi}`));
  let n = 0;
  for (const k of setA) if (!setB.has(k)) n += 1;
  for (const k of setB) if (!setA.has(k)) n += 1;
  return n;
};

/**
 * MelodyGrid interaction mode (parallels `GridMode` for the drum
 * grid — three orthogonal user intentions that previously looked
 * identical from a tap).
 *
 *   - `view`   — read-only mirror of the score's first melody
 *                call. Tap = preview via Web Audio, no state change.
 *   - `sketch` — ephemeral draft buffer. Tap = preview + toggle a
 *                draft cell. Draft is NOT in the score until the
 *                user explicitly presses `↑ commit`. Sheet close
 *                with dirty draft shows a confirm dialog.
 *   - `edit`   — direct, in-place edit of the first `note(…)` /
 *                `n(…)` call's string arg inside the top stack.
 *                Every tap splices the cell back to the live score
 *                (debounced 50ms hot-swap via `scheduleGridEdit`).
 *                Gated on `canEditMelodyLayer(score)` returning
 *                true — disabled with tooltip otherwise.
 *
 * See decisions/wavecode-melody-grid.yaml for the design rationale.
 */
export type MelodyMode = 'view' | 'sketch' | 'edit';

export const MELODY_MODES: ReadonlyArray<MelodyMode> = ['view', 'sketch', 'edit'];
