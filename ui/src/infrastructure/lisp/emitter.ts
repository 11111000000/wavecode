/**
 * Emitter: AST → JS code string.
 *
 * Strategy:
 *   - Function-call form: (head a b c)  →  head(a, b, c)
 *   - Bare symbol as data: rev          →  "rev"
 *   - Number / string: emitted as-is.
 *
 * Method-chain heuristic:
 *   When a `(method arg...)` appears as an argument of a list call,
 *   AND the parent's head is a pattern constructor, AND `method` is
 *   in KNOWN_METHODS, the arg becomes `.method(args...)` chained on
 *   the parent's call result. Otherwise it is a positional argument.
 *
 * Pattern constructors: stack, s, note, n, seq, cat, arrange, run,
 *   rand, silence, add, mul, sub, div, fast, slow, every, ...
 * Methods (chain-only): slow, fast, gain, speed, lpf, hpf, lp, room,
 *   delay, jux, rev, every, iter, chunk, mask, struct, euclid,
 *   euclidRot, off, range, sustain, attack, decay, release, pan,
 *   shape, crush, coarse, cut, orbit, enhance, vowel, phaser,
 *   vibrato, tremolo, slice, fit, early, late, ri, ribbon, add,
 *   sub, mul, div, round, floor, ceil, fix, ply, snap, chop,
 *   striate, weave, echo, rev2, reverb, freeze, loopAt, begin, end,
 *   speedUp, slowDown, chunkBack, iterBack, plyBack, rand, irand,
 *   perlin, saw, square, sine, tri, noise.
 *
 * Empty list `()` → `Pattern.empty()` (Strudel sentinel).
 */

import type { Expr } from './parser';

/**
 * Constructors that produce a single Pattern (chainable).
 * s/note/n/range/etc. — also in KNOWN_METHODS so they chain on a
 * single-pattern parent like `n("...").s("saw")`.
 *
 * Anything NOT here (stack/seq/cat/every/jux/...) keeps all args
 * positional. To chain a method on a stack, wrap it: `(slow 2 (stack ...))`.
 */
const SINGLE_PATTERN_CONSTRUCTORS: ReadonlySet<string> = new Set([
  's',
  'note',
  'n',
  'silence',
  'run',
  'rand',
  'range',
  'irand',
  'perlin',
  'saw',
  'square',
  'sine',
  'tri',
  'noise',
]);

const KNOWN_METHODS: ReadonlySet<string> = new Set([
  'slow',
  'fast',
  'gain',
  'speed',
  'lpf',
  'hpf',
  'lp',
  'hp',
  'delay',
  'room',
  'size',
  'jux',
  'rev',
  'iter',
  'chunk',
  'mask',
  'struct',
  'euclid',
  'euclidRot',
  'off',
  's',
  'note',
  'n',
  'sustain',
  'decay',
  'attack',
  'release',
  'pan',
  'shape',
  'crush',
  'coarse',
  'cut',
  'orbit',
  'enhance',
  'vowel',
  'phaser',
  'vibrato',
  'tremolo',
  'slice',
  'fit',
  'early',
  'late',
  'ri',
  'ribbon',
  'add',
  'mul',
  'sub',
  'div',
  'round',
  'floor',
  'ceil',
  'invert',
  'fix',
  'ply',
  'snap',
  'chop',
  'striate',
  'weave',
  'echo',
  'rev2',
  'reverb',
  'freeze',
  'loopAt',
  'begin',
  'end',
  'speedUp',
  'slowDown',
  'chunkBack',
  'iterBack',
  'plyBack',
]);

const isSinglePatternConstructor = (name: string): boolean =>
  SINGLE_PATTERN_CONSTRUCTORS.has(name);

const escapeString = (s: string): string =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

/** Render a single value (atom or list) as a JS expression. */
const renderValue = (e: Expr): string => {
  if (e.kind === 'num') return String(e.value);
  if (e.kind === 'str') return `"${escapeString(e.value)}"`;
  if (e.kind === 'sym') return `"${e.value}"`;
  if (e.kind === 'empty') return 'Pattern.empty()';
  return renderCall(e);
};

/**
 * Render a list `(head args...)`.
 * Each arg is rendered positionally, except: arg-list whose head is in
 * KNOWN_METHODS AND whose parent head is a PATTERN_CONSTRUCTOR — that
 * arg becomes `.method(args)` chained on the result.
 */
const renderCall = (e: Expr & { kind: 'list' }): string => {
  const head = e.items[0];
  if (head === undefined) throw new Error('renderCall on empty list');
  if (head.kind !== 'sym') {
    throw new Error(
      `head must be a symbol, got ${head.kind} (${'value' in head ? head.value : '?'})`,
    );
  }

  const headName = head.value;
  const args = e.items.slice(1);
  const parentIsSingleCtor = isSinglePatternConstructor(headName);

  const renderedArgs: string[] = [];
  const chainCalls: string[] = [];

  for (const a of args) {
    if (
      a.kind === 'list' &&
      a.items[0]?.kind === 'sym' &&
      KNOWN_METHODS.has(a.items[0].value) &&
      parentIsSingleCtor
    ) {
      const methodName = a.items[0].value;
      const methodArgs = a.items.slice(1).map(renderValue);
      chainCalls.push(`.${methodName}(${methodArgs.join(', ')})`);
    } else {
      renderedArgs.push(renderValue(a));
    }
  }

  let base: string;
  if (renderedArgs.length === 0) {
    base = `${headName}()`;
  } else {
    base = `${headName}(${renderedArgs.join(', ')})`;
  }

  return base + chainCalls.join('');
};

/** Render top-level expressions. Multiple top-level exprs are joined with `, ` (sequential eval). */
export const emit = (exprs: ReadonlyArray<Expr>): string =>
  exprs.map(renderValue).join(', ');