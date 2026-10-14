import {
  emptyGrid,
  gridToScore,
  type Grid,
  GRID_ROWS,
} from '~/domain/music/gridTypes';
import { parseStackTopLayers } from '~/domain/layers/parseStack';

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
 * See `math/wavecode-step-grid-modes/packet.md` synthesis (c).
 */

/** A single top-level `s(…)` layer inside the score's stack. */
type SampleLayer = {
  readonly source: string;
  /** True if this layer's first token is `s(`. */
  readonly isSample: boolean;
};

/**
 * Extract every top-level `stack(...)` layer as `(source, isSample)`.
 * Falls back to a single-layer view if no outer stack is present.
 * Paren-aware split via `parseStackTopLayers`.
 */
const collectLayers = (score: string): ReadonlyArray<SampleLayer> => {
  const layers = parseStackTopLayers(score);
  return layers.map((l) => ({
    source: l.source,
    isSample: /^s\s*\(/i.test(l.source.trim()),
  }));
};

/**
 * Can the score be edited in-place? Requires exactly 4 sample
 * layers AND no non-sample layers (so the splices don't reorder
 * the user's other tracks) AND a top-level stack.
 *
 * If a non-sample layer exists alongside s-layers, we still
 * return `true` (the user has explicit consent by being in edit
 * mode), but `editGridLayer` only mutates the s-layers and
 * leaves the others alone.
 */
export const canEditGridLayer = (score: string): boolean => {
  if (score.trim() === '') return false;
  const layers = collectLayers(score);
  if (layers.length === 0) return false;
  const sampleCount = layers.filter((l) => l.isSample).length;
  return sampleCount === GRID_ROWS.length;
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

  const layers = collectLayers(score);
  // Index in `gridToScore(grid)` corresponds to the i-th sample
  // row (GRID_ROWS[i] = sample token for that row).
  const gridSnippet = gridToScore(grid);
  const gridSnippetRows = gridSnippet
    .split('\n')
    .filter((l) => /^ {2}s\(/.test(l))
    .map((l) => l.replace(/,\s*$/, '').trim());

  // Build the new stack body: replace each s(…) layer with the
  // corresponding gridSnippetRows entry; pass through other layers.
  const newBodyParts: string[] = [];
  let sampleIdx = 0;
  for (const layer of layers) {
    if (layer.isSample) {
      const replacement = gridSnippetRows[sampleIdx] ?? gridSnippetRows[gridSnippetRows.length - 1] ?? '';
      newBodyParts.push(replacement);
      sampleIdx += 1;
    } else {
      newBodyParts.push(layer.source);
    }
  }

  // Reassemble: keep the original outer `stack(...)` wrapper but
  // with the new body. We do this by finding the outer stack's
  // open/close paren byte offsets in the ORIGINAL score (NOT
  // trimmed) so leading/trailing whitespace + comments
  // surrounding the stack call are preserved verbatim.
  const closeIdx = findOutermostStackClose(score);
  if (closeIdx === -1) return null;
  const openIdx = findOutermostStackOpen(score);
  if (openIdx === -1) return null;
  const head = score.slice(0, openIdx + 1);
  const tail = score.slice(closeIdx);
  // Preserve original indentation style: each new body part on its
  // own line, indented with 2 spaces (matches gridToScore default).
  const newBody = newBodyParts.map((p) => `  ${p}`).join(',\n');
  return `${head}\n${newBody}\n${tail}`;
};

/** Find byte offset of the `(` of the top-level `stack(...)`. -1 if none. */
const findOutermostStackOpen = (src: string): number => {
  const i = skipWsAndComments(src, 0);
  if (src.slice(i, i + 5) !== 'stack') return -1;
  let j = i + 5;
  j = skipWsAndComments(src, j);
  if (src[j] !== '(') return -1;
  return j;
};

/** Find byte offset of the matching `)` of the top-level `stack(...)`. */
const findOutermostStackClose = (src: string): number => {
  const open = findOutermostStackOpen(src);
  if (open === -1) return -1;
  let depth = 1;
  let inStr: '"' | "'" | '`' | null = null;
  for (let i = open + 1; i < src.length; i += 1) {
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

const skipWsAndComments = (src: string, i: number): number => {
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
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

/** Export the empty-grid helper for use in the rewrite. */
export const blankGrid = emptyGrid;
