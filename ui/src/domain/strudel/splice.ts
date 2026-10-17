/**
 * AST-based score splice: append a snippet into the top-level
 * `stack(...)` of an existing score.
 *
 * This is the single source of truth for the "append-stack" slot
 * shared by the piano recorder, the mic/whistle panel, and (later)
 * the StepGrid. It replaces three hand-rolled paren-walker copies
 * (`skipWhitespaceAndComments` + `findTopLevelStackAt` +
 * `findStackClose`) that lived in `gridState.ts`, `pianoRecStore.ts`
 * and `micStore.ts`, and which broke when a comment or string literal
 * contained a stray `stack(` / `s("…")` token.
 *
 * Behaviour (identical to the legacy walker for well-formed input):
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
 * Purity: no Web APIs, no Solid signals, no `@strudel/*` imports —
 * only the AST produced by `parser.ts` / `walker.ts`.
 */

import { parseScore } from './parser';
import { isStackNode } from './walker';
import type { ScoreAST } from './ast';

/**
 * Result of `appendToTopStack`. `ok: false` means the score HAS a
 * top-level `stack(` call but it is unbalanced — splicing would
 * corrupt the buffer, so the caller should surface a warning and
 * preserve the user's recording for retry.
 */
export type AppendToStackResult =
  | { readonly ok: true; readonly score: string }
  | { readonly ok: false; readonly reason: 'unbalanced-stack' };

const indent = (s: string): string =>
  s.split('\n').map((l) => '  ' + l).join('\n');

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
