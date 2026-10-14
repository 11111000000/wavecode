import { describe, it, expect } from 'vitest';

import { tokenize, LispSyntaxError } from './lexer';
import { parse } from './parser';
import { emit } from './emitter';
import { lispTranspiler } from './transpiler';

const transpile = (src: string): string => {
  const tokens = tokenize(src);
  const ast = parse(tokens);
  return emit(ast);
};

describe('lisp/lexer', () => {
  it('tokenizes atoms and parens', () => {
    const t = tokenize('(note "a4" 42)');
    expect(t.map((x) => x.kind)).toEqual(['lparen', 'symbol', 'string', 'number', 'rparen']);
  });

  it('tokenizes negative and fractional numbers', () => {
    const t = tokenize('-1.5 0.25 -3');
    const nums = t.filter((x) => x.kind === 'number');
    expect(nums.map((x) => (x as { value: number }).value)).toEqual([-1.5, 0.25, -3]);
  });

  it('strips line comments', () => {
    const t = tokenize('; hello\n(note "a4") ; tail');
    expect(t.map((x) => x.kind)).toEqual(['lparen', 'symbol', 'string', 'rparen']);
  });

  it('strips nested block comments', () => {
    const t = tokenize('#| outer #| inner |# still outer |# (note "a4")');
    expect(t).toHaveLength(4);
  });

  it('throws on unterminated string', () => {
    expect(() => tokenize('(note "a4)')).toThrow(LispSyntaxError);
  });

  it('handles string escapes', () => {
    const t = tokenize('"a\\"b\\nc"');
    const str = t.find((x) => x.kind === 'string');
    expect((str as { value: string }).value).toBe('a"b\nc');
  });
});

describe('lisp/parser', () => {
  it('parses nested lists', () => {
    const ast = parse(tokenize('(a (b c) d)'));
    expect(ast).toHaveLength(1);
    expect(ast[0]?.kind).toBe('list');
  });

  it('marks () as Expr#1', () => {
    const ast = parse(tokenize('()'));
    expect(ast[0]).toEqual({ kind: 'empty' });
  });

  it('parses multiple top-level expressions', () => {
    const ast = parse(tokenize('(a) (b c) 42'));
    expect(ast).toHaveLength(3);
  });

  it('throws on missing close paren', () => {
    expect(() => parse(tokenize('(note "a4"'))).toThrow(LispSyntaxError);
  });
});

describe('lisp/emitter', () => {
  it('renders atoms', () => {
    expect(transpile('42')).toBe('42');
    expect(transpile('3.14')).toBe('3.14');
    expect(transpile('"a4 b4"')).toBe('"a4 b4"');
    // bare symbol → identifier (a Strudel function), NOT a string.
    expect(transpile('rev')).toBe('rev');
    expect(transpile('sawtooth')).toBe('sawtooth');
  });

  it('renders a function call', () => {
    expect(transpile('(note "a4")')).toBe('note("a4")');
  });

  it('renders multiple positional args', () => {
    expect(transpile('(stack (note "a4") (s "bd"))')).toBe(
      'stack(note("a4"), s("bd"))',
    );
  });

  it('chains methods on single-pattern constructors (note)', () => {
    expect(transpile('(note "a4" (slow 2) (gain 0.5))')).toBe(
      'note("a4").slow(2).gain(0.5)',
    );
  });

  it('chains methods on single-pattern constructors (n.s.gain)', () => {
    // n(...) is a single-pattern ctor, (s "saw") is a known method → chain.
    expect(transpile('(n "[55,59,62]*2" (s "sawtooth") (gain 0.18) (lpf 1800))')).toBe(
      'n("[55,59,62]*2").s("sawtooth").gain(0.18).lpf(1800)',
    );
  });

  it('does NOT chain on collection constructors (stack)', () => {
    // (stack (note "a4") (s "bd")) — args are positional, never chained.
    expect(transpile('(stack (note "a4") (s "bd"))')).toBe(
      'stack(note("a4"), s("bd"))',
    );
  });

  it('does NOT chain on higher-order functions (every)', () => {
    // (every 4 (jux rev) (s "bd")) — every is not single-pattern ctor.
    expect(transpile('(every 4 (jux rev) (s "bd"))')).toBe(
      'every(4, jux(rev), s("bd"))',
    );
  });

  it('stack keeps all args positional; chain via outer wrap', () => {
    // (stack ... (slow 2)) — slow becomes positional. To chain on the
    // whole stack, wrap: (slow 2 (stack ...)).
    expect(transpile('(stack (note "a4") (s "bd") (slow 2))')).toBe(
      'stack(note("a4"), s("bd"), slow(2))',
    );
    expect(transpile('(slow 2 (stack (note "a4") (s "bd")))')).toBe(
      'slow(2, stack(note("a4"), s("bd")))',
    );
  });

  it('regression: stack never wraps args as method calls', () => {
    // s and note are KNOWN_METHODS too, but parent (stack) is collection →
    // all args stay positional, otherwise we'd emit stack().s("a") which
    // is a no-op on empty stack.
    expect(transpile('(stack (s "a") (note "b") (gain 0.5))')).toBe(
      'stack(s("a"), note("b"), gain(0.5))',
    );
  });

  it('renders empty list as Pattern.empty()', () => {
    expect(transpile('()')).toBe('Pattern.empty()');
  });

  it('treats unknown head methods as positional arg (not chain)', () => {
    // `nope` is not in KNOWN_METHODS — so (nope 1 2) stays positional.
    // Inside (s "bd" (nope 1 2)), (nope 1 2) is positional too.
    expect(transpile('(s "bd" (nope 1 2))')).toBe('s("bd", nope(1, 2))');
  });

  it('joins multiple top-level expressions with comma', () => {
    expect(transpile('(note "a4") (s "bd")')).toBe('note("a4"), s("bd")');
  });

  it('preserves mini-notation in strings as-is', () => {
    expect(transpile('(note "<g2 b2 c3 c3>*2")')).toBe('note("<g2 b2 c3 c3>*2")');
  });

  it('preserves spaces in strings', () => {
    expect(transpile('(note "a4 b4 c5")')).toBe('note("a4 b4 c5")');
  });
});

describe('lisp/transpiler (integration)', () => {
  it('returns output + empty errors on success (pure, no mini-notation)', () => {
    const r = lispTranspiler('(note "a4")');
    expect(r.errors).toEqual([]);
    // Pure core does NOT apply mini-notation — that happens on the audio
    // path (LiveAudioEngine composes emitJs with @strudel/transpiler).
    expect(r.output).toBe('note("a4")');
  });

  it('returns source as-is + error on syntax error', () => {
    const src = '(note "a4';
    const r = lispTranspiler(src);
    expect(r.output).toBe(src);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/unterminated string/);
  });
});

describe('lisp/golden pairs (Strudel round-trip intent)', () => {
  // Each pair is a (Lisp, expected JS) — runtime identity is verified
  // by manual eval; this test ensures the transpiler is stable.
  // Chain rule: only on SINGLE_PATTERN_CONSTRUCTORS (note/n/s/range/...).
  // On stack/seq/cat/every/jux — args are always positional. Wrap the
  // stack in a single-pattern call to chain: e.g. (slow 2 (stack ...)).
  const goldenPairs: ReadonlyArray<{ lisp: string; js: string }> = [
    { lisp: '(note "a4 b4 c5")', js: 'note("a4 b4 c5")' },
    { lisp: '(s "bd sd hh")', js: 's("bd sd hh")' },
    { lisp: '(stack (note "a4 b4 c5") (s "bd sd hh"))', js: 'stack(note("a4 b4 c5"), s("bd sd hh"))' },
    { lisp: '(note "a4 b4" (slow 2) (gain 0.5))', js: 'note("a4 b4").slow(2).gain(0.5)' },
    { lisp: '(s "bd notes" (gain 0.45))', js: 's("bd notes").gain(0.45)' },
    { lisp: '(stack (note "a4" (gain 0.35) (lpf 400)) (s "bd" (gain 0.45)))', js: 'stack(note("a4").gain(0.35).lpf(400), s("bd").gain(0.45))' },
    { lisp: '(note "<g2 b2 c3 c3>*2" (slow 2))', js: 'note("<g2 b2 c3 c3>*2").slow(2)' },
    { lisp: '(every 4 (jux rev) (s "bd notes"))', js: 'every(4, jux(rev), s("bd notes"))' },
    { lisp: '(n "[55,59,62]*2" (s "sawtooth") (gain 0.18) (lpf 1800))', js: 'n("[55,59,62]*2").s("sawtooth").gain(0.18).lpf(1800)' },
    { lisp: '(slow 2 (stack (note "a4") (s "bd")))', js: 'slow(2, stack(note("a4"), s("bd")))' },
  ];

  for (const p of goldenPairs) {
    it(p.lisp, () => {
      expect(transpile(p.lisp)).toBe(p.js);
    });
  }
});