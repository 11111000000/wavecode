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
 * A `stack(...)` node together with its span expressed in ABSOLUTE
 * offsets of the score text it came from.
 *
 * `StackNode.span` is relative to whatever string the node was parsed
 * from — for a stack nested inside `cat(…)` that string is the arg's
 * raw text, not the score. Splicing code (`injectMix`) needs absolute
 * offsets, so `collectStacks` re-bases them here.
 */
export type StackRef = {
  readonly node: StackNode;
  readonly start: number;
  readonly end: number;
  /**
   * The stack's args with every span re-based onto the ORIGINAL score.
   * `node.args` keeps the parser-local offsets (relative to the arg
   * text that was re-parsed), which are useless for splicing.
   */
  readonly args: ReadonlyArray<Arg>;
};

/**
 * Collect EVERY `stack(...)` node reachable from the AST, in source
 * order, descending into `cat(...)` args and bracketed `[…]` exprs.
 * Spans are re-based onto the ORIGINAL score text.
 *
 * Why this exists alongside `findTopStack`: `findTopStack` keeps the
 * legacy "first stack wins, depth-1" semantics that
 * `validateForEdit` / `canEditGridLayer` depend on (the StepGrid
 * precondition is about the FIRST stack only). But the mixer needs a
 * different answer — every multi-section preset ships as
 * `cat(stack(…), stack(…), …)`, one stack per section, and the mixer
 * used to render only section 1's rows. For `edm-house` that meant 4
 * rows for an 8-section arrangement whose drop stacks add 7 layers
 * each, so half the instrument mix had no mute/gain control at all.
 *
 * Nested stacks inside a collected stack are NOT descended into —
 * they stay collapsed as one `Sub-stack` row, matching the pre-existing
 * depth-1 treatment and keeping the row count bounded.
 *
 * `parseText` defaults to `parseScore`; tests inject a stub.
 */
export const collectStacks = (
  ast: ScoreAST,
  parseText: (text: string) => ScoreAST = parseScore,
): ReadonlyArray<StackRef> => {
  const found: StackRef[] = [];
  const seen = new Set<number>();

  const push = (node: StackNode, offset: number): void => {
    if (seen.has(offset + node.span.start)) return;
    seen.add(offset + node.span.start);
    found.push({
      node,
      start: offset + node.span.start,
      end: offset + node.span.end,
      args: node.args.map((arg) => ({
        ...arg,
        span: {
          ...arg.span,
          start: offset + arg.span.start,
          end: offset + arg.span.end,
        },
      })),
    });
  };

  // Args inside `[…]` brackets arrive as a single `expr` whose text
  // starts with `[stack(...), …]`; args of a bare `cat(stack(…), …)`
  // arrive as one `expr` per top-level comma. Walking EVERY node of the
  // re-parsed arg (rather than just `nodes[0]`) covers both shapes.
  const walkInner = (arg: Arg, base: number): void => {
    if (arg.kind !== 'expr') return;
    if (!arg.text.includes('stack(')) return;
    const argBase = base + arg.span.start;
    for (const inner of parseText(arg.text).nodes) {
      if (inner.kind === 'stack') push(inner, argBase);
      else if (inner.kind === 'call') for (const a of inner.args) walkInner(a, argBase);
    }
  };

  for (const node of ast.nodes) {
    if (node.kind === 'stack') {
      push(node, 0);
      continue;
    }
    if (node.kind === 'call') for (const arg of node.args) walkInner(arg, 0);
  }
  return found;
};

/** `collectStacks(parseScore(text))` — convenience for string input. */
export const collectStacksOf = (text: string): ReadonlyArray<StackRef> =>
  collectStacks(parseScore(text));

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
  /**
   * 0-based ordinal of the owning `stack(...)` within the score.
   * Multi-section presets (`cat(stack(…), stack(…), …)`) use this so
   * the mixer can label each group; single-stack scores are all 0.
   */
  readonly section: number;
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
 * The mixer row list — one row per top-level layer of EVERY
 * `stack(...)` in the score, in source order.
 *
 * Before this rewrite it returned the first `stack(...)` only
 * (`findTopStackOf`), because the legacy regex parser had the same
 * "first `stack(` wins" behaviour. That was fine when presets were
 * single `stack(…)` arrangements, but every shipping preset is
 * multi-section: `creep` is `cat(stack(…), …)` with 6 sections
 * (29 layers total) and `edm-house` has 8 sections / 44 layers.
 * The mixer showed 2 and 4 rows respectively — a third of the actual
 * instrument mix, with no indication that the rest existed. Users
 * read that as "the mixer is broken", which it was.
 *
 * Grouping: rows from the same stack share a `section` ordinal, so
 * the panel can render a header per section and collapse long scores.
 *
 * Fallback: a score with no `stack(…)` at all is still a single row
 * (`section: 0`), preserving the legacy behaviour for bare patterns
 * like `note("c3 e3 g3")`.
 */
export const validateForMixer = (text: string): ReadonlyArray<MixerLayer> => {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const stacks = collectStacksOf(trimmed);
  if (stacks.length === 0) {
    return [{ index: 0, source: trimmed, name: detectName(trimmed, 0), section: 0 }];
  }
  const out: MixerLayer[] = [];
  let index = 0;
  for (let section = 0; section < stacks.length; section += 1) {
    const stack = stacks[section]!.node;
    for (const arg of stack.args) {
      const source = argText(arg);
      const stripped = source.replace(/\/\/.*$/gm, '').trim();
      if (!stripped) continue;
      out.push({ index, source, name: detectName(stripped, index), section });
      index += 1;
    }
  }
  return out;
};

/**
 * Row count `validateForMixer` will produce for `text`.
 *
 * The MixerPanel uses this to reconcile `appStore.layerMix` length
 * when the score changes (preset switch, AI edit, undo). Kept as a
 * separate export so the panel does not allocate the descriptor array
 * just to read `.length`.
 */
export const countMixerLayers = (text: string): number => validateForMixer(text).length;

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