import { describe, it, expect } from 'vitest';

import { transpileScoreToJs } from './transpileScore';
import { GOLDEN_PAIRS } from '~/infrastructure/lisp/goldenPairs';

describe('transpileScore/transpileScoreToJs', () => {
  it('returns ok for empty input? actually no — explicit error', () => {
    expect(transpileScoreToJs('')).toEqual({ ok: false, error: 'empty score' });
    expect(transpileScoreToJs('   \n  ')).toEqual({ ok: false, error: 'empty score' });
  });

  it('round-trips every golden pair (Lisp → JS)', () => {
    for (const pair of GOLDEN_PAIRS) {
      const r = transpileScoreToJs(pair.lisp);
      expect(r.ok, `pair "${pair.intent}" failed: ${r.ok ? '' : r.error}`).toBe(true);
      if (r.ok) {
        expect(r.js).toBe(pair.js);
      }
    }
  });

  it('returns ok:false for a syntax error without throwing', () => {
    const r = transpileScoreToJs('(note "a4');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unterminated string/);
  });

  it('returns ok:false for an unbalanced paren', () => {
    const r = transpileScoreToJs('(note "a4" (slow 2)');
    expect(r.ok).toBe(false);
  });

  it('trims surrounding whitespace before checking emptiness', () => {
    const r = transpileScoreToJs('  (note "c4")  \n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.js).toBe('note("c4")');
  });

  it('preserves indentation in JS output (multi-line Lisp)', () => {
    const lisp = '(stack\n  (note "a4" (slow 2))\n  (s "bd"))';
    const r = transpileScoreToJs(lisp);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.js).toBe('stack(note("a4").slow(2), s("bd"))');
    }
  });

  it('never throws on absurd input', () => {
    expect(() => transpileScoreToJs(')))(((')).not.toThrow();
    expect(() => transpileScoreToJs('@@@@@')).not.toThrow();
    expect(() => transpileScoreToJs('null undefined NaN')).not.toThrow();
  });
});
