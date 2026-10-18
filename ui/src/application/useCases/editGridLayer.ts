import {
  emptyGrid,
  gridToScore,
  type Grid,
  GRID_ROWS,
} from '~/domain/music/gridTypes';
import {
  findTopStackOf,
  countSLayers,
  argLeadingName,
  replaceLayerSources,
} from '~/domain/strudel';

/**
 * In-place edit of the 4 `s("…")` layers of a top-level `stack(...)`.
 *
 * Used by `gridState.applyEditToLayer` in **edit** mode: the user
 * tapped a cell, we want to splice the corresponding `s("…")` row
 * inside the existing stack — preserving the rest of the score,
 * including non-`s(…)` layers (bass, arp, etc.) and the
 * outer stack structure.
 *
 * Pure: returns a new score string. Returns `null` if the score
 * does not satisfy the edit-mode precondition (≠ 4 s-layers in a
 * top-level stack, or no top-level stack at all). The caller
 * falls back to `appendGridToScore` (sketch semantics) in that
 * case.
 *
 * Round-trip property (loadFromScore ∘ editGridLayer ∘ gridToScore):
 *   loadFromScore(gridToScore(g)) === g
 *   gridToScore(loadedScore(g)) when score is exactly 4 s-rows
 *   → synthesizes the same snippet back.
 *
 * See decisions/wavecode-step-grid-modes.yaml synthesis (c).
 */

/**
 * Can the score be edited in-place? Requires a top-level stack
 * whose first non-comment node IS that stack AND exactly 4
 * `s(…)` rows in it.
 *
 * If a non-sample layer exists alongside s-layers, we still
 * return `true` (the user has explicit consent by being in edit
 * mode), but `editGridLayer` only mutates the s-layers and
 * leaves the others alone.
 *
 * Implemented via the Strudel-score AST: the walker counts
 * top-level `s(…)` rows structurally, so it cannot be fooled
 * by `s("…")` substrings inside comments or string literals
 * (the failure mode of the prior regex parser).
 */
export const canEditGridLayer = (score: string): boolean => {
  if (score.trim() === '') return false;
  const stack = findTopStackOf(score);
  if (stack === null) return false;
  return countSLayers(stack) === GRID_ROWS.length;
};

/**
 * Splice the 4 `s("…")` rows of a top-level `stack(...)` with the
 * corresponding rows of `gridToScore(grid)`. Non-sample layers
 * (e.g. `note(…)`, `n(…)`) are preserved verbatim.
 *
 * Returns the new score string. Returns `null` if the score
 * does NOT satisfy the precondition (caller falls back to
 * `appendGridToScore`).
 */
export const editGridLayer = (score: string, grid: Grid): string | null => {
  if (!canEditGridLayer(score)) return null;

  // gridToScore(grid) returns
  //   stack(
  //     s("…"),
  //     s("…"),
  //     …
  //   )
  // — one `  s("…"),` row per GRID_ROWS entry, with a trailing comma.
  // For splice we need the bare `s("…")` (no comma) since the comma
  // already lives in the original score between args.
  const gridSnippet = gridToScore(grid);
  const gridRows = gridSnippet
    .split('\n')
    .filter((l) => /^ {2}s\(/.test(l))
    .map((l) => l.replace(/,\s*$/, '').trim());

  const stack = findTopStackOf(score);
  if (stack === null) return null;

  // Match each s-row in the score with the corresponding s-row from
  // gridToScore, in source order. Non-s args (note/n/…) are left
  // untouched — their bytes are never rewritten.
  const edits: { index: number; source: string }[] = [];
  let gridSampleIdx = 0;
  for (let i = 0; i < stack.args.length; i += 1) {
    if (gridSampleIdx >= gridRows.length) break;
    if (argLeadingName(stack.args[i]!)?.toLowerCase() !== 's') continue;
    edits.push({ index: i, source: gridRows[gridSampleIdx]! });
    gridSampleIdx += 1;
  }
  // Note: edits.length may be < stack.args.length when the grid
  // produced fewer rows than the stack has s-layers; replaceLayerSources
  // splices ONLY the listed indices, leaving the rest verbatim.
  const result = replaceLayerSources(score, edits);
  return result.ok ? result.score : null;
};

/** Export the empty-grid helper for use in the rewrite. */
export const blankGrid = emptyGrid;
