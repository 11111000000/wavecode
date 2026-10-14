import { createSignal } from 'solid-js';
import {
  emptyGrid,
  toggleCell,
  setCell,
  gridToScore,
  isGridEmpty,
  type Grid,
  type GridMode,
  GRID_ROWS,
  GRID_COLS,
  gridsEqual,
  countGridDiff,
} from '~/domain/music/gridTypes';
import { canEditGridLayer, editGridLayer as editGridLayerUseCase } from '~/application/useCases/editGridLayer';

/**
 * Step Grid reactive state — MODE-AWARE.
 *
 * Three signals form the full state:
 *   - `mode()` — current interaction mode (view | sketch | edit).
 *   - `draftGrid()` — what the UI renders. In view mode this mirrors
 *     the score. In sketch mode it's the user's draft (may differ
 *     from lastCommitted). In edit mode it's always equal to
 *     lastCommitted (every tap is a commit).
 *   - `lastCommittedGrid()` — grid at the moment of the last
 *     commit/parse. Used to compute `dirtyCellCount()`.
 *
 * Back-compat: `getGrid` is an alias for `getDraftGrid`; old
 * callers still work without modification. New callers should
 * use `getMode` and `getDirtyCellCount` to render mode-aware UI.
 *
 * See `math/wavecode-step-grid-modes` packet for the design.
 */

// --- Mode signal -------------------------------------------------------------

const [mode, setMode] = createSignal<GridMode>('view');

export const getMode = (): GridMode => mode();
export const setModeDirect = (m: GridMode): void => {
  setMode(m);
};

// --- Grid signals ------------------------------------------------------------

const [draftGrid, setDraftGridSignal] = createSignal<Grid>(emptyGrid());
const [lastCommittedGrid, setLastCommittedGridSignal] = createSignal<Grid>(emptyGrid());

/** Current visible grid (what `<StepGrid />` renders). */
export const getDraftGrid = (): Grid => draftGrid();
/** Back-compat alias. */
export const getGrid = (): Grid => draftGrid();

/** Grid at the moment of the last commit/parse. */
export const getLastCommittedGrid = (): Grid => lastCommittedGrid();

/** Direct setter for the lastCommitted signal (used by IDB restore). */
export const setLastCommittedGrid = (g: Grid): void => {
  setLastCommittedGridSignal(g);
};

/** Number of cells that differ between draft and lastCommitted (0..32). */
export const dirtyCellCount = (): number =>
  countGridDiff(draftGrid(), lastCommittedGrid());

const setDraftGrid = (g: Grid): void => {
  setDraftGridSignal(g);
};

/** Replace the draft without touching lastCommitted (use sparingly). */
export const setGridDirect = (g: Grid): void => {
  setDraftGrid(g);
};

// --- Cell toggles (draft-only) ----------------------------------------------

/** Toggle a cell in the draft. Caller is responsible for triggering
 * the right side effect per mode (preview / commit / hot-swap).
 * Returns the new draft. */
export const toggleCellInDraft = (row: number, col: number): Grid => {
  const next = toggleCell(draftGrid(), row, col);
  setDraftGrid(next);
  return next;
};

/** Back-compat alias for older callers (StepGrid legacy). */
export const toggleCellState = (row: number, col: number): Grid =>
  toggleCellInDraft(row, col);

/** Clear the draft (and lastCommitted in sketch mode so the next
 * view-mode read is consistent). */
export const clearDraft = (): void => {
  const empty = emptyGrid();
  setDraftGridSignal(empty);
  setLastCommittedGridSignal(empty);
};

/** Back-compat alias. */
export const clearGridState = (): void => clearDraft();

// --- Mode transitions --------------------------------------------------------

/**
 * Enter view mode. The grid is parsed from the score and both
 * draft and lastCommitted are set to the same value (so dirty
 * count is 0).
 */
export const enterView = (score: string): void => {
  const parsed = loadFromScoreInternal(score);
  setDraftGridSignal(parsed);
  setLastCommittedGridSignal(parsed);
  setMode('view');
};

/**
 * Enter sketch mode. The draft is kept if it's non-empty (the
 * user is mid-draft), otherwise parsed from the score. This
 * matches the existing "draft is sacred once started" contract.
 */
export const enterSketch = (score: string): void => {
  const current = draftGrid();
  if (isGridEmpty(current)) {
    const parsed = loadFromScoreInternal(score);
    setDraftGridSignal(parsed);
    setLastCommittedGridSignal(parsed);
  }
  setMode('sketch');
};

/**
 * Enter edit mode. Requires a parseable score (4 s-layers in a
 * top-level stack). Returns `{ ok: true }` on success, or
 * `{ ok: false, reason }` on failure (caller should disable
 * the mode button and show a tooltip).
 */
export const enterEdit = (score: string): { readonly ok: boolean; readonly reason?: string } => {
  if (!canEditGridLayer(score)) {
    return {
      ok: false,
      reason:
        'Edit mode requires a top-level stack(...) with exactly 4 s("…") rows. Switch to Sketch to add a drum layer.',
    };
  }
  const parsed = loadFromScoreInternal(score);
  setDraftGridSignal(parsed);
  setLastCommittedGridSignal(parsed);
  setMode('edit');
  return { ok: true };
};

// --- Commit / apply ----------------------------------------------------------

/**
 * Sketch mode ↑ commit. Returns the new score (so the caller can
 * dispatch `replaceScore`) and advances lastCommitted = draft.
 * Pure on the score string; pure on the grid (advances the
 * lastCommitted snapshot). Returns the new score, or null if
 * the draft is empty (nothing to commit).
 */
export const commitDraft = (currentScore: string): string | null => {
  const draft = draftGrid();
  if (isGridEmpty(draft)) return null;
  const newScore = appendGridToScore(currentScore, draft);
  setLastCommittedGridSignal(draft);
  return newScore;
};

/**
 * Edit-mode per-tap. Splices the current draft into the score
 * via `editGridLayer` (in-place 4-row replacement) and returns
 * the new score. Falls back to `appendGridToScore` semantics if
 * the score is no longer parseable (user edited outside the
 * grid between taps). Returns null only if BOTH paths fail
 * (e.g. score is empty).
 */
export const applyEditToLayer = (currentScore: string): string | null => {
  const draft = draftGrid();
  const inPlace = editGridLayerUseCase(currentScore, draft);
  if (inPlace !== null) {
    setLastCommittedGridSignal(draft);
    return inPlace;
  }
  // Fallback: score no longer matches the 4-s-layer shape (user
  // edited outside the grid). Use the sketch-merge path.
  if (isGridEmpty(draft)) return null;
  const fallback = appendGridToScore(currentScore, draft);
  setLastCommittedGridSignal(draft);
  return fallback;
};

// --- Internal helpers --------------------------------------------------------

/** Best-effort parse of a score into a grid (uses `loadFromScore` below). */
const loadFromScoreInternal = (score: string): Grid => loadFromScore(score);

// --- Score parsing (preserved from before; back-compat) ---------------------

/** Load a Strudel snippet back into grid (best-effort: parses `s("...")` rows). */
export const loadFromScore = (snippet: string): Grid => {
  const rowRegex = /s\(\s*"([^"]+)"\s*\)/g;
  const matches = [...snippet.matchAll(rowRegex)];
  let next: Grid = emptyGrid();
  for (let r = 0; r < GRID_ROWS.length && r < matches.length; r += 1) {
    const tokens = (matches[r]![1] ?? '').trim().split(/\s+/);
    for (let c = 0; c < GRID_COLS && c < tokens.length; c += 1) {
      const tok = tokens[c]!.toLowerCase();
      const isRest = tok === '~' || tok === '.';
      if (!isRest) next = setCell(next, r, c, true);
    }
  }
  setDraftGridSignal(next);
  return next;
};

export const isGridEmptyState = (): boolean => isGridEmpty(draftGrid());

/** Render the current draft as a Strudel stack snippet. */
export const gridAsScore = (): string => gridToScore(draftGrid());

/** Same, using a passed-in grid (pure; does not touch signals). */
export const draftAsScore = (g: Grid): string => gridToScore(g);

// --- Score merging (preserved from before; back-compat) ---------------------

/**
 * Skip whitespace AND line-comments starting at index `i`. Returns the
 * offset of the first non-whitespace, non-`//`-comment character.
 */
const skipWhitespaceAndComments = (src: string, i: number): number => {
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    break;
  }
  return i;
};

/**
 * Find the offset where `stack` (followed by `(`) appears at the top
 * level — i.e. as the first non-trivial token once whitespace/comments
 * are skipped. Returns -1 if no such top-level `stack(` exists.
 */
const findTopLevelStackAt = (src: string): number => {
  const i = skipWhitespaceAndComments(src, 0);
  if (src.slice(i, i + 5) !== 'stack') return -1;
  let j = i + 5;
  j = skipWhitespaceAndComments(src, j);
  if (src[j] !== '(') return -1;
  const peek = src[j + 1];
  if (peek !== undefined && peek !== ' ' && peek !== '\t' && peek !== '\n' && peek !== '\r' && peek !== '/' && peek !== ')') {
    return -1;
  }
  return i;
};

/**
 * Find the offset of the closing `)` for a top-level `stack(...)` call
 * that starts at the given index (i.e. immediately after the opening
 * paren). Returns -1 if no balanced closing paren is found before end-of
 * input. Walks the string respecting nested parens, single/double/backtick
 * quotes and line-comments.
 */
const findStackClose = (src: string, afterOpenParen: number): number => {
  let depth = 1;
  let inStr: '"' | "'" | '`' | null = null;
  for (let i = afterOpenParen; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** True iff `raw` has `stack(` as its first executable token at the top level. */
export const hasTopLevelStack = (raw: string): boolean =>
  findTopLevelStackAt(raw) !== -1;

/**
 * Strip the outer `stack(...)` wrapper from a grid snippet. The body
 * `s("…"),\n  s("…"),\n  s("…"),\n  s("…")` becomes inline comma-list.
 */
const stripStackWrapper = (snippet: string): string =>
  snippet
    .replace(/^\s*stack\s*\(\s*\n?/, '')
    .replace(/\n?\)\s*$/, '');

/**
 * Merge the current grid into an existing editor score.
 *
 * Rules (per wavecode-step-append-sync packet):
 *   1. empty editor → grid snippet (just `stack(s("…"), …)`) standalone.
 *   2. editor already has top-level `stack(...)` → append grid snippet as
 *      an additional comma-separated layer INSIDE the existing call.
 *   3. editor has a non-stack score → wrap both in a new `stack(...)`.
 */
export const appendGridToScore = (currentScore: string, grid: Grid): string => {
  if (currentScore.trim() === '') return gridToScore(grid);

  const stackStart = findTopLevelStackAt(currentScore);
  if (stackStart !== -1) {
    let i = stackStart + 5;
    i = skipWhitespaceAndComments(currentScore, i);
    const openParen = i;
    const closeIdx = findStackClose(currentScore, openParen + 1);
    if (closeIdx !== -1) {
      const head = currentScore.slice(0, closeIdx).replace(/\s+$/, '');
      const tail = currentScore.slice(closeIdx);
      const gridBody = stripStackWrapper(gridToScore(grid))
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n');
      const headNeedsComma = /,\s*$/.test(head);
      return `${head}${headNeedsComma ? '' : ','}\n${gridBody}\n${tail}`;
    }
  }

  const gridBody = stripStackWrapper(gridToScore(grid))
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');
  const trimmedCurrent = currentScore.trim();
  return `stack(\n${trimmedCurrent},\n${gridBody}\n)`;
};

// --- Re-exports for back-compat ----------------------------------------------

/** Back-compat: true iff the draft and lastCommitted are equal. */
export const isDraftClean = (): boolean => gridsEqual(draftGrid(), lastCommittedGrid());
