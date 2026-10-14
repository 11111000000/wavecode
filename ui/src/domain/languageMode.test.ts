import { describe, it, expect } from 'vitest';

import { detectLanguage, isLanguageMode } from './languageMode';

describe('languageMode/detectLanguage', () => {
  it('detects JS when first non-comment line is a JS call', () => {
    expect(detectLanguage('note("a4")')).toBe('js');
    expect(detectLanguage('stack(note("a4"), s("bd"))')).toBe('js');
  });

  it('detects Lisp when first non-comment line starts with "("', () => {
    expect(detectLanguage('(note "a4")')).toBe('lisp');
    expect(detectLanguage('(stack (note "a4") (s "bd"))')).toBe('lisp');
  });

  it('skips blank lines and ;; comments before deciding', () => {
    expect(detectLanguage('\n\n;; comment\n(note "a4")')).toBe('lisp');
    expect(detectLanguage('\n;; comment\n(stack (note "a4"))')).toBe('lisp');
  });

  it('treats // comment as JS even if a ( follows later', () => {
    expect(detectLanguage('// comment\n(note "a4")')).toBe('js');
  });

  it('defaults to js for empty / comment-only scores', () => {
    expect(detectLanguage('')).toBe('js');
    expect(detectLanguage(';; only a lisp comment')).toBe('js');
    expect(detectLanguage('// only a js comment')).toBe('js');
  });

  it('isLanguageMode validates the union', () => {
    expect(isLanguageMode('js')).toBe(true);
    expect(isLanguageMode('lisp')).toBe(true);
    expect(isLanguageMode('python')).toBe(false);
    expect(isLanguageMode(null)).toBe(false);
  });
});