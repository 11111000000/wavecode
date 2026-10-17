/**
 * Strudel-score AST walker.
 *
 * Helpers over a `ScoreAST` that the rest of wavecode uses:
 *
 *   findTopStack(ast)        — locate the top-level `stack(...)`
 *                              call (the score's mixer/grid
 *                              container). Returns `null` if the
 *                              score has no top-level stack — in
 *                              which case the rest of the system
 *                              treats the whole score as a single
 *                              implicit layer.
 *
 *   countSLayers(stack)      — number of top-level args whose
 *                              leading token is `s(`. Used by
 *                              `canEditGridLayer` to decide
 *                              whether the StepGrid edit-mode is
 *                              applicable (exactly 4 → enabled).
 *
 *   getStackArgs(stack)      — raw text + span of each top-level
 *                              arg, in order. Used by `parseStack.ts`
 *                              to feed the mixer panel.
 *
 *   validateForEdit(score)   — `{ ok, layerCount, reason }` for
 *                              the StepGrid edit-mode pill.
 *
 *   validateForMixer(score)  — `LayerDescriptor[]` shaped like
 *                              the legacy `parseStackTopLayers`.
 *
 * The walker is intentionally thin — all real work is on top of
 * the AST shape produced by `parser.ts`. No string surgery here.
 */

import type { ScoreAST, ScoreNode, StackNode, CallNode, Arg } from './ast';
import { parseScore, argLeadingName, argText } from './parser';

/**
 * Find the first `StackNode` reachable from the AST root.
 *
 * "Top-level" here means "the first stack encountered by a
 * depth-first walk from the program root" — which is what the
 * legacy regex parser did. It finds:
 *
 *   - a stack that IS the program's outermost call:
 *     `stack(...)` at column 0
 *   - a stack inside `cat([stack(...), ...])` (one level deep):
 *     the first `stack(...)` token in source order
 *
 * Preserving the depth-first semantics matters for backward
 * compatibility: the prior regex parser returned the first
 * `stack(` it could find (its parens balanced), so for the
 * Creep preset (`cat([stack(...), stack(...), ...])`) it
 * returned the intro-section stack. `parseStackTopLayers`
 * then split THAT body into 3 layers.
 *
 * For the StepGrid edit-mode precondition, the same depth-first
 * rule applies — `canEditGridLayer` checks whether exactly 4
 * `s(…)` rows are in the first stack found, regardless of
 * whether it is the program's outermost call.
 *
 * Returns `null` only if the AST contains no stack node at all.
 */
export const findTopStack = (ast: ScoreAST): StackNode | null => {
  for (const node of ast.nodes) {
    const found = findStackInNode(node);
    if (found) return found;
  }
  return null;
};

/**
 * Recursive depth-first search for a StackNode. The recursion
 * walks into CallNode args by re-parsing each arg's raw text
 * (when it might contain a stack) — necessary because args
 * inside `[...]` brackets appear as a single `expr` arg whose
 * text starts with `[stack(...)]`. Re-parsing the arg's
 * lexeme surfaces the inner stack(s) without changing the
 * parent parser's bracket-depth tracking.
 *
 * Stacks inside stack args are NOT visited recursively — that
 * would over-count `s(…)` rows for nested-stack mixer rows.
 * The legacy regex parser was a single `stack(` lookup, so we
 * match that depth-1 behaviour.
 */
const findStackInNode = (node: ScoreNode): StackNode | null => {
  if (node.kind === 'stack') return node;
  if (node.kind === 'call') {
    for (const arg of node.args) {
      if (arg.kind === 'number') continue;
      const text = arg.kind === 'expr' ? arg.text : arg.kind === 'string' ? `${arg.quote}${arg.value}${arg.quote}` : arg.name;
      if (!text.includes('stack(')) continue;
      const innerAst = parseScore(text);
      const found = findTopStack(innerAst);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Convenience: parse `text` and return its top-level stack
 * (or `null`). Combines `parseScore` + `findTopStack`.
 */
export const findTopStackOf = (text: string): StackNode | null => findTopStack(parseScore(text));

/**
 * Count the args of `stack` whose leading function is `s`.
 * Comparison is case-insensitive and tolerates whitespace
 * between the identifier and `(`.
 */
export const countSLayers = (stack: StackNode): number => {
  let n = 0;
  for (const arg of stack.args) {
    if (argLeadingName(arg)?.toLowerCase() === 's') n += 1;
  }
  return n;
};

/**
 * Raw text + span of each top-level arg of `stack`, in order.
 * Returned shape mirrors the legacy `parseStackTopLayers` output
 * (without the friendly-name classification — that lives in
 * `parseStack.ts` to keep the walker name-agnostic).
 */
export const getStackArgs = (stack: StackNode): ReadonlyArray<{ readonly source: string; readonly span: { readonly start: number; readonly end: number } }> => {
  const out: { source: string; span: { start: number; end: number } }[] = [];
  for (const arg of stack.args) {
    out.push({ source: argText(arg), span: { start: arg.span.start, end: arg.span.end } });
  }
  return out;
};

/**
 * Discriminated cause for `validateForEdit` returning `{ ok: false }`.
 *
 * Use this instead of a free-form `string` so the UI can render a
 * different icon / copy per cause without `reason.startsWith('нет')`
 * text comparisons. The numeric `layerCount` on the result still
 * carries the exact count for `wrong-count` cases (the UI may want
 * to show "у вас N, нужно 4").
 */
export type EditInvalidReason = 'empty' | 'no-top-stack' | 'wrong-count';

/**
 * Result of `validateForEdit(score)` — drives the StepGrid
 * edit-mode pill state and the corresponding error message.
 */
export type ValidateForEditResult = {
  readonly ok: boolean;
  readonly layerCount: number;
  /** Null when `ok === true`; otherwise a specific `EditInvalidReason`. */
  readonly reason: EditInvalidReason | null;
};

/**
 * Edit-mode precondition: there is a top-level stack AND it
 * contains exactly 4 `s(…)` rows (matches the StepGrid's 4-row
 * drum-pad layout — see `ui/src/domain/music/gridTypes.ts`).
 */
export const validateForEdit = (text: string): ValidateForEditResult => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, layerCount: 0, reason: 'empty' };
  }
  const stack = findTopStackOf(text);
  if (!stack) {
    return { ok: false, layerCount: 0, reason: 'no-top-stack' };
  }
  const sl = countSLayers(stack);
  if (sl === 4) return { ok: true, layerCount: sl, reason: null };
  return { ok: false, layerCount: sl, reason: 'wrong-count' };
};

/**
 * Result of `validateForMixer(score)` — the row list the
 * MixerPanel renders. Shape is intentionally compatible with
 * the legacy `LayerDescriptor[]` from `parseStack.ts` so the
 * panel does not need to be rewritten.
 */
export type MixerLayer = {
  readonly index: number;
  readonly source: string;
  readonly name: string;
};

const detectName = (source: string, index: number): string => {
  const trimmed = source.trim();
  const firstToken = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  const fn = firstToken?.[1];
  if (fn === undefined) return `Layer ${index}`;
  switch (fn) {
    case 'note': {
      const pitch = trimmed.match(/([a-gA-G])(\d)/);
      if (pitch && pitch[1] && pitch[2]) {
        const letter = pitch[1];
        const octRaw = pitch[2];
        const oct = Number.parseInt(octRaw, 10);
        if (oct <= 2) return `Bass (${letter.toLowerCase()}${oct})`;
        if (oct >= 5) return `Lead (${letter.toLowerCase()}${oct})`;
        return 'Piano';
      }
      return 'Piano';
    }
    case 'n': return 'Arp';
    case 's': return 'Samples';
    case 'stack': return 'Sub-stack';
    case 'cat': return 'Sequence';
    case 'silence': return 'Silence';
    default: return fn;
  }
};

/**
 * The mixer row list. If there is no top-level stack, fall
 * back to a single-layer view of the whole score (preserves
 * the legacy behaviour).
 */
export const validateForMixer = (text: string): ReadonlyArray<MixerLayer> => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const stack = findTopStackOf(text);
  if (!stack) {
    return [{ index: 0, source: trimmed, name: detectName(trimmed, 0) }];
  }
  const out: MixerLayer[] = [];
  let index = 0;
  for (const arg of stack.args) {
    const source = argText(arg);
    const stripped = source.replace(/\/\/.*$/gm, '').trim();
    if (!stripped) continue;
    out.push({ index, source, name: detectName(stripped, index) });
    index += 1;
  }
  return out;
};

// (Re-export parseScore from the walker surface so consumers
//  can import everything they need from one place.)
export { parseScore };
// (Re-export argLeadingName so other domain code can classify args
//  without importing the parser directly.)
export { argLeadingName };

// Convenience: enumerate the top-level nodes of an AST.
export const topLevelNodes = (ast: ScoreAST): ReadonlyArray<ScoreNode> => ast.nodes;

/** Sum of top-level node spans, exposed for tests / future use. */
export const astLength = (ast: ScoreAST): number => ast.length;

/** Type guard: `node` is a StackNode. */
export const isStackNode = (node: ScoreNode): node is StackNode => node.kind === 'stack';

/** Type guard: `node` is a CallNode. */
export const isCallNode = (node: ScoreNode): node is CallNode =>
  node.kind === 'call';

/** Type guard: `arg` is a string arg. */
export const isStringArg = (arg: Arg): arg is Extract<Arg, { kind: 'string' }> =>
  arg.kind === 'string';

/** Type guard: `arg` is a numeric arg. */
export const isNumberArg = (arg: Arg): arg is Extract<Arg, { kind: 'number' }> =>
  arg.kind === 'number';