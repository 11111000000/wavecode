import { describe, it, expect } from 'vitest';

import { tokenize, parse, emit, LispSyntaxError } from './transpiler';
import { GOLDEN_PAIRS, GOLDEN_PAIR_COUNTS } from './goldenPairs';

const transpile = (src: string): string => {
  const tokens = tokenize(src);
  const ast = parse(tokens);
  return emit(ast);
};

describe('lisp/goldenPairs — categories', () => {
  it('has at least 30 pairs (Lisp LLM regression baseline)', () => {
    expect(GOLDEN_PAIRS.length).toBeGreaterThanOrEqual(30);
  });

  it('covers all expected categories', () => {
    expect(GOLDEN_PAIR_COUNTS['single-ctor']).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_PAIR_COUNTS['method-chain']).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_PAIR_COUNTS.stack).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_PAIR_COUNTS['higher-order']).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_PAIR_COUNTS['mini-notation']).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_PAIR_COUNTS['edge-case']).toBeGreaterThanOrEqual(3);
  });
});

describe('lisp/goldenPairs — transpile round-trip', () => {
  for (const pair of GOLDEN_PAIRS) {
    it(`[${pair.category}] ${pair.intent}`, () => {
      expect(transpile(pair.lisp)).toBe(pair.js);
    });
  }
});

describe('lisp/goldenPairs — tokenize+parse never throws on valid pairs', () => {
  // Defensive: every pair should at least survive lex+parse. If a pair
  // would throw, the transpile check above already catches it; this is
  // a structural sanity assertion for the e2e pipeline.
  for (const pair of GOLDEN_PAIRS) {
    it(`[${pair.category}] no throw: ${pair.intent}`, () => {
      expect(() => tokenize(pair.lisp)).not.toThrow();
      expect(() => parse(tokenize(pair.lisp))).not.toThrow();
    });
  }
});

describe('lisp/goldenPairs — LispSyntaxError is still raised on actual bad input', () => {
  it('unterminated string', () => {
    expect(() => transpile('(note "a4')).toThrow(LispSyntaxError);
  });

  it('missing close paren', () => {
    expect(() => transpile('(note "a4" (slow 2)')).toThrow(LispSyntaxError);
  });

  it('lispTranspiler returns error result instead of throwing', async () => {
    const { lispTranspiler } = await import('./transpiler');
    const result = lispTranspiler('(note "a4', null);
    expect(result.output).toBe('(note "a4'); // source as-is
    expect(result.errors).toHaveLength(1);
  });
});
