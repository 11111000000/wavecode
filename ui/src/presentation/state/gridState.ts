import { createSignal } from 'solid-js';
import {
  emptyGrid,
  toggleCell,
  setCell,
  gridToScore,
  isGridEmpty,
  type Grid,
  GRID_ROWS,
  GRID_COLS,
} from '~/domain/music/gridTypes';

/**
 * Step Grid reactive state.
 *
 * Holds the current 4×8 drum-pad layout. `gridToScore(grid)` synthesizes
 * a Strudel `stack(...)` snippet. Used by <StepGrid /> UI; loaded back
 * into the main score via `loadToScore()` dispatch.
 */

const [grid, setGrid] = createSignal<Grid>(emptyGrid());

export const getGrid = (): Grid => grid();
export const setGridDirect = (g: Grid): void => {
  setGrid(g);
};

export const toggleCellState = (row: number, col: number): Grid => {
  const next = toggleCell(grid(), row, col);
  setGrid(next);
  return next;
};

export const clearGridState = (): void => {
  setGrid(emptyGrid());
};

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
      // setCell is immutable — re-assign next each iteration. Bug
      // history: prior code discarded the return value, leaving
      // grid empty for every score. (Discovered when
      // wavecode-step-grid-autoload-and-sync exposed the silent
      // no-op via auto-load-on-sheet-open.)
      if (!isRest) next = setCell(next, r, c, true);
    }
  }
  setGrid(next);
  return next;
};

export const isGridEmptyState = (): boolean => isGridEmpty(grid());
export const gridAsScore = (): string => gridToScore(grid());

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
  // Allow `stack ( … )` (rare, but legal in Strudel).
  j = skipWhitespaceAndComments(src, j);
  if (src[j] !== '(') return -1;
  // Confirm this is "stack(" not "stackStartOfSomethingElse(...)" — by
  // requiring that what follows the `(` is whitespace, comment, or close-paren.
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

/**
 * True iff `raw` has `stack(` as its first executable token at the top
 * level (a leading comment block doesn't disqualify it).
 */
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
 *      Mixer indexes top-level layers; the existing layers stay first,
 *      then the new grid layers are concatenated (consistent with
 *      wavecode-track-mixer's setLayerCount pathway).
 *   3. editor has a non-stack score → wrap both in a new `stack(...)`.
 *
 * Pure: takes `currentScore` as a string, returns a new string.
 * Paren-aware split operates directly on the original text so user
 * comments BEFORE the splice are preserved verbatim.
 */
export const appendGridToScore = (currentScore: string, grid: Grid): string => {
  if (currentScore.trim() === '') return gridToScore(grid);

  const stackStart = findTopLevelStackAt(currentScore);
  if (stackStart !== -1) {
    // Locate the opening `(` after `stack`
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

  // Case 3: non-stack score — wrap both in a new stack.
  const gridBody = stripStackWrapper(gridToScore(grid))
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');
  const trimmedCurrent = currentScore.trim();
  return `stack(\n${trimmedCurrent},\n${gridBody}\n)`;
};
