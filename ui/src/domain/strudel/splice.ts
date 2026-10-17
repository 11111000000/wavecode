/**
 * AST-based score splice: append a snippet into the top-level
 * `stack(...)` of an existing score, OR in-place replace one or more
 * top-level layer sources.
 *
 * Single source of truth for the "append-stack" slot shared by the
 * piano recorder, the mic/whistle panel, AND the StepGrid's in-place
 * row-replace. Replaces three hand-rolled paren-walker copies
 * (`skipWhitespaceAndComments` + `findTopLevelStackAt` +
 * `findStackClose`) that lived in `gridState.ts`, `pianoRecStore.ts`
 * and `micStore.ts`, and which broke when a comment or string literal
 * contained a stray `stack(` / `s("…")` token.
 *
 * Purity: no Web APIs, no Solid signals, no `@strudel/*` imports —
 * only the AST produced by `parser.ts` / `walker.ts`.
 *
 * `appendToTopStack` behaviour (identical to the legacy walker for
 * well-formed input):
 *
 *   1. empty / whitespace-only editor        → snippet verbatim
 *   2. first non-comment statement is a
 *      top-level `stack(...)`                → splice the snippet INSIDE
 *                                               the stack, comma-aware
 *   3. any other score (bare `note(…)`, a
 *      `cat([…])` container, leading code)   → wrap both in a fresh
 *                                               `stack(...)`
 *   4. first statement is a `stack(` but it
 *      is unterminated (no closing paren)    → `{ ok: false }` so the
 *                                               caller can warn instead
 *                                               of emitting broken code
 *
 * `replaceLayerSources` behaviour:
 *
 *   1. no top-level stack (or unbalanced)    → `{ ok: false }`
 *   2. any edit.index out of range / duplicate → `{ ok: false }`
 *   3. otherwise                            → in-place byte-range
 *                                               replacement via AST
 *                                               spans, preserving every
 *                                               character between edited
 *                                               rows verbatim (whitespace,
 *                                               commas, comments).
 */

import { parseScore } from './parser';
import { isStackNode } from './walker';
import type { ScoreAST, StackNode } from './ast';

/**
 * Result of `appendToTopStack`. `ok: false` means the score HAS a
 * top-level `stack(` call but it is unbalanced — splicing would
 * corrupt the buffer, so the caller should surface a warning and
 * preserve the user's recording for retry.
 */
export type AppendToStackResult =
  | { readonly ok: true; readonly score: string }
  | { readonly ok: false; readonly reason: 'unbalanced-stack' };

/**
 * One in-place edit for `replaceLayerSources`: substitute the i-th
 * top-level `stack(...)` arg's source bytes with `source`.
 */
export type LayerEdit = {
  readonly index: number;
  readonly source: string;
};

/**
 * Result of `replaceLayerSources`. `ok: false` reasons:
 *   - `no-top-stack`        — the score's first non-comment statement
 *                             is not a `StackNode` (or the stack is
 *                             unbalanced and thus unspliceable)
 *   - `index-out-of-range`  — some `edit.index` is outside
 *                             `[0, stack.args.length)`, OR two edits
 *                             target the same index
 */
export type ReplaceLayersResult =
  | { readonly ok: true; readonly score: string; readonly replaced: number }
  | {
      readonly ok: false;
      readonly reason: 'no-top-stack' | 'index-out-of-range';
    };

const indent = (s: string): string =>
  s.split('\n').map((l) => '  ' + l).join('\n');

/**
 * Resolve the top-level `StackNode` of `currentScore`, or `null` if
 * the first non-comment statement is not a stack (or the stack is
 * unbalanced and thus unspliceable).
 */
const resolveTopStack = (currentScore: string): StackNode | null => {
  if (currentScore.trim() === '') return null;
  const ast: ScoreAST = parseScore(currentScore);
  const firstNode = ast.nodes.find((n) => n.kind !== 'comment');
  if (firstNode === undefined || !isStackNode(firstNode)) return null;
  // Unbalanced stack: refuse so we never emit broken code.
  if (currentScore[firstNode.span.end - 1] !== ')') return null;
  return firstNode;
};

export const appendToTopStack = (
  currentScore: string,
  snippet: string,
): AppendToStackResult => {
  if (currentScore.trim() === '') {
    return { ok: true, score: snippet };
  }

  const ast: ScoreAST = parseScore(currentScore);
  // Only the FIRST non-comment top-level node can be the splice target.
  // This mirrors the legacy `findTopLevelStackAt`, which required the
  // first non-trivia token to be `stack` — a `foo()\nstack(...)` score
  // is wrapped, not spliced, preserving the old contract.
  const firstNode = ast.nodes.find((n) => n.kind !== 'comment');
  if (firstNode !== undefined && isStackNode(firstNode)) {
    // A balanced `stack(...)` ends its span with the closing `)`. The
    // parser's permissive mode still yields a StackNode for unbalanced
    // input, but the span then ends at the last arg, not at `)`.
    const closeIdx = firstNode.span.end - 1;
    if (currentScore[closeIdx] !== ')') {
      return { ok: false, reason: 'unbalanced-stack' };
    }
    const head = currentScore.slice(0, closeIdx).replace(/\s+$/, '');
    const tail = currentScore.slice(closeIdx);
    const inner = indent(snippet);
    const headNeedsComma = /,\s*$/.test(head);
    return {
      ok: true,
      score: `${head}${headNeedsComma ? '' : ','}\n${inner}\n${tail}`,
    };
  }

  // No top-level stack → wrap both in a fresh stack(...).
  const trimmedCurrent = currentScore.trim();
  return {
    ok: true,
    score: `stack(\n${trimmedCurrent},\n${indent(snippet)}\n)`,
  };
};

/**
 * In-place byte-range replacement of one or more top-level stack
 * layer sources. Each `edits[i]` substitutes
 * `currentScore.slice(arg.span.start, arg.span.end)` for `edits[i].source`.
 *
 * Edits are applied right-to-left (highest start first) so byte offsets
 * remain valid throughout. Every character of `currentScore` outside
 * the replaced spans is preserved verbatim — including the commas
 * between args, surrounding whitespace, and comments. Empty `edits`
 * is a no-op that returns the original score.
 */
export const replaceLayerSources = (
  currentScore: string,
  edits: ReadonlyArray<LayerEdit>,
): ReplaceLayersResult => {
  if (edits.length === 0) {
    return { ok: true, score: currentScore, replaced: 0 };
  }
  const stack = resolveTopStack(currentScore);
  if (stack === null) {
    return { ok: false, reason: 'no-top-stack' };
  }
  const argCount = stack.args.length;
  // Validate every edit up front so a partial splice is impossible.
  const seen = new Set<number>();
  for (const e of edits) {
    if (
      !Number.isInteger(e.index)
      || e.index < 0
      || e.index >= argCount
      || seen.has(e.index)
    ) {
      return { ok: false, reason: 'index-out-of-range' };
    }
    seen.add(e.index);
  }
  // Apply right-to-left so earlier offsets stay valid.
  const ordered = [...edits].sort((a, b) => b.index - a.index);
  let out = currentScore;
  for (const e of ordered) {
    const arg = stack.args[e.index]!;
    out = out.slice(0, arg.span.start) + e.source + out.slice(arg.span.end);
  }
  return { ok: true, score: out, replaced: edits.length };
};
