/**
 * Golden pairs: canonical Lisp ↔ JS for the wavecode Lisp dialect.
 *
 * Each pair is a `lisp` source that, when transpiled, MUST produce
 * exactly the `js` string. These pairs double as:
 *   1. regression tests (goldenPairs.test.ts)
 *   2. LLM few-shot examples (lispPrompt.ts)
 *   3. documentation of the dialect (this file's comments)
 *
 * Categories:
 *   1. Single-pattern constructors (5)
 *   2. Method chains on single-pattern (5)
 *   3. Stack compositions (5)
 *   4. Higher-order transforms — every / jux / rev / off (5)
 *   5. Mini-notation preservation in strings (5)
 *   6. Edge cases — empty stack, negative numbers, decimals, comments (5+)
 *
 * Round-trip identity is verified by the test; runtime equivalence
 * (i.e. `eval(js)` produces the same Pattern) is verified by manual
 * smoke-test in `tests/e2e/lisp-transpiler.spec.ts`.
 */

export type GoldenPair = {
  /** Canonical Lisp source. Whitespace/indent is informational — lexer ignores it. */
  readonly lisp: string;
  /** Exact expected JS output of the Lisp transpiler. */
  readonly js: string;
  /** Short human description of what this pair demonstrates. */
  readonly intent: string;
  /** Category for grouping in docs/tests. */
  readonly category:
    | 'single-ctor'
    | 'method-chain'
    | 'stack'
    | 'higher-order'
    | 'mini-notation'
    | 'edge-case';
};

export const GOLDEN_PAIRS: ReadonlyArray<GoldenPair> = [
  // ── 1. Single-pattern constructors ────────────────────────────────────
  {
    lisp: '(note "c4")',
    js: 'note("c4")',
    intent: 'simplest constructor — single note',
    category: 'single-ctor',
  },
  {
    lisp: '(note "a4 b4 c5")',
    js: 'note("a4 b4 c5")',
    intent: 'mini-notation sequence in string',
    category: 'single-ctor',
  },
  {
    lisp: '(s "bd sd hh")',
    js: 's("bd sd hh")',
    intent: 'sound constructor with drum pattern',
    category: 'single-ctor',
  },
  {
    lisp: '(n "0 4 7")',
    js: 'n("0 4 7")',
    intent: 'numeric sequence (MIDI by number)',
    category: 'single-ctor',
  },
  {
    lisp: '(range 0 7)',
    js: 'range(0, 7)',
    intent: 'numeric range constructor',
    category: 'single-ctor',
  },

  // ── 2. Method chains on single-pattern ────────────────────────────────
  {
    lisp: '(note "a4" (slow 2))',
    js: 'note("a4").slow(2)',
    intent: 'single method chain',
    category: 'method-chain',
  },
  {
    lisp: '(note "a4 b4 c5" (slow 2) (gain 0.5))',
    js: 'note("a4 b4 c5").slow(2).gain(0.5)',
    intent: 'multi-method chain',
    category: 'method-chain',
  },
  {
    lisp: '(s "sawtooth" (lpf 800) (decay 0.3))',
    js: 's("sawtooth").lpf(800).decay(0.3)',
    intent: 'synth + filter + envelope',
    category: 'method-chain',
  },
  {
    lisp: '(n "[55,59,62]*2" (s "sawtooth") (gain 0.18) (lpf 1800))',
    js: 'n("[55,59,62]*2").s("sawtooth").gain(0.18).lpf(1800)',
    intent: 'classic n.s() chain — n as constructor, s as method',
    category: 'method-chain',
  },
  {
    lisp: '(note "c4" (fast 1.5) (room 0.4) (delay 0.2))',
    js: 'note("c4").fast(1.5).room(0.4).delay(0.2)',
    intent: 'multi-effect chain — fast+reverb+delay',
    category: 'method-chain',
  },

  // ── 3. Stack compositions ────────────────────────────────────────────
  {
    lisp: '(stack (note "a4") (s "bd"))',
    js: 'stack(note("a4"), s("bd"))',
    intent: 'minimal stack — two patterns',
    category: 'stack',
  },
  {
    lisp: '(stack (note "a4 b4 c5") (s "bd sd hh") (s "sawtooth"))',
    js: 'stack(note("a4 b4 c5"), s("bd sd hh"), s("sawtooth"))',
    intent: 'three-layer stack',
    category: 'stack',
  },
  {
    lisp: '(stack (note "<g2 b2 c3>" (s "sawtooth") (gain 0.35) (lpf 400)) (s "bd*4" (gain 0.5)))',
    js: 'stack(note("<g2 b2 c3>").s("sawtooth").gain(0.35).lpf(400), s("bd*4").gain(0.5))',
    intent: 'stack with chains on inner patterns',
    category: 'stack',
  },
  {
    lisp: '(stack (note "a4") (s "bd"))',
    js: 'stack(note("a4"), s("bd"))',
    intent: 'stack with bare note (no chain)',
    category: 'stack',
  },
  {
    lisp: '(slow 2 (stack (note "a4 b4 c5") (s "bd sd hh")))',
    js: 'slow(2, stack(note("a4 b4 c5"), s("bd sd hh")))',
    intent: 'wrap stack in slow — chain on outer slow',
    category: 'stack',
  },

  // ── 4. Higher-order transforms ────────────────────────────────────────
  {
    lisp: '(every 4 (jux rev) (s "bd notes"))',
    js: 'every(4, jux(rev), s("bd notes"))',
    intent: 'every + jux + rev — function arg positional',
    category: 'higher-order',
  },
  {
    lisp: '(every 3 (fast 2) (note "a4 b4 c5"))',
    js: 'every(3, fast(2), note("a4 b4 c5"))',
    intent: 'every wraps fast as function-arg',
    category: 'higher-order',
  },
  {
    lisp: '(jux rev (s "bd sd hh"))',
    js: 'jux(rev, s("bd sd hh"))',
    intent: 'jux with bare function + pattern',
    category: 'higher-order',
  },
  {
    lisp: '(off 0.125 (note "c5") (s "sawtooth"))',
    js: 'off(0.125, note("c5"), s("sawtooth"))',
    intent: 'off — multi-arg positional',
    category: 'higher-order',
  },
  {
    lisp: '(chunk 4 (note "a4 b4 c5 d5"))',
    js: 'chunk(4, note("a4 b4 c5 d5"))',
    intent: 'chunk with size + pattern',
    category: 'higher-order',
  },

  // ── 5. Mini-notation preservation ─────────────────────────────────────
  {
    lisp: '(note "<g2 b2 c3 c3>*2")',
    js: 'note("<g2 b2 c3 c3>*2")',
    intent: 'mini-notation with *2 + angle brackets',
    category: 'mini-notation',
  },
  {
    lisp: '(s "bd*4, ~ sd ~ sd, hh*8")',
    js: 's("bd*4, ~ sd ~ sd, hh*8")',
    intent: 'multi-voice mini-notation with rests',
    category: 'mini-notation',
  },
  {
    lisp: '(note "[55,59,62] [60,64,67]")',
    js: 'note("[55,59,62] [60,64,67]")',
    intent: 'chord brackets in sequence',
    category: 'mini-notation',
  },
  {
    lisp: '(s "bd@3 sd")',
    js: 's("bd@3 sd")',
    intent: '@-operator — euclidean-ish',
    category: 'mini-notation',
  },
  {
    lisp: '(note "<[c4,e4,g4] [d4,f4,a4]>")',
    js: 'note("<[c4,e4,g4] [d4,f4,a4]>")',
    intent: 'angle brackets + nested chords',
    category: 'mini-notation',
  },

  // ── 6. Edge cases ─────────────────────────────────────────────────────
  {
    lisp: '(stack)',
    js: 'stack()',
    intent: 'empty stack — still valid call',
    category: 'edge-case',
  },
  {
    lisp: '(note "c4" (fast -1.5))',
    js: 'note("c4").fast(-1.5)',
    intent: 'negative number in chain',
    category: 'edge-case',
  },
  {
    lisp: ';; comment only\n(note "a4")',
    js: 'note("a4")',
    intent: 'line comment stripped',
    category: 'edge-case',
  },
  {
    lisp: '#| block comment |# (note "a4")',
    js: 'note("a4")',
    intent: 'block comment stripped',
    category: 'edge-case',
  },
  {
    lisp: '(note "a\\"b c4")',
    js: 'note("a\\"b c4")',
    intent: 'escaped quote inside string',
    category: 'edge-case',
  },
  {
    lisp: '()',
    js: 'Pattern.empty()',
    intent: 'empty list — sentinel for "no pattern"',
    category: 'edge-case',
  },
  {
    lisp: '(note "c4" (gain 0.001))',
    js: 'note("c4").gain(0.001)',
    intent: 'small fractional gain',
    category: 'edge-case',
  },
  {
    lisp: '(stack\n  (note "a4 b4" (slow 2))\n  (s "bd sd"))',
    js: 'stack(note("a4 b4").slow(2), s("bd sd"))',
    intent: 'multi-line stack with newlines+indent',
    category: 'edge-case',
  },
];

/** Per-category counts — exposed for documentation / prompt use. */
export const GOLDEN_PAIR_COUNTS: Readonly<Record<GoldenPair['category'], number>> =
  GOLDEN_PAIRS.reduce(
    (acc, p) => ({ ...acc, [p.category]: (acc[p.category] ?? 0) + 1 }),
    {} as Record<GoldenPair['category'], number>,
  );
