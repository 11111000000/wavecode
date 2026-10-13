import { describe, it, expect } from 'vitest';
import { cleanLogArgs } from './cleanLogArgs';

describe('cleanLogArgs', () => {
  it('two-arg shape: drops the CSS companion and strips %c tokens', () => {
    const out = cleanLogArgs([
      '%c[eval] code updated',
      'background-color: black;color:white;border-radius:15px',
    ]);
    expect(out).toEqual(['[eval] code updated']);
  });

  it('two-arg shape: non-matching second arg → first arg %c stripped, otherwise unchanged', () => {
    const out = cleanLogArgs([
      '%c[eval] msg',
      'no css here',
      'extra',
    ]);
    expect(out).toEqual(['[eval] msg', 'no css here', 'extra']);
  });

  it('one-arg shape: trims the concatenated CSS substring', () => {
    const out = cleanLogArgs([
      '%c[eval] code updated background-color: black;color:white;border-radius:15px',
    ]);
    expect(out).toEqual(['[eval] code updated']);
  });

  it('one-arg shape with `color: white` heuristic: trims from CSS substring start', () => {
    const out = cleanLogArgs([
      '%c[getTrigger] sound missing color: white;padding:4px',
    ]);
    expect(out).toEqual(['[getTrigger] sound missing']);
  });

  it('one-arg shape: no CSS substring → returns cleaned shallow copy', () => {
    const out = cleanLogArgs(['%c[eval] plain message']);
    expect(out).toEqual(['[eval] plain message']);
  });

  it('one-arg shape with no %c[ → unchanged', () => {
    const out = cleanLogArgs(['plain message']);
    expect(out).toEqual(['plain message']);
  });

  it('empty args → empty shallow copy', () => {
    const out = cleanLogArgs([]);
    expect(out).toEqual([]);
  });

  it('non-string first arg → unchanged', () => {
    const out = cleanLogArgs([{ a: 1 }, 'css', 99]);
    expect(out).toEqual([{ a: 1 }, 'css', 99]);
  });

  it('non-string first arg with %c prefix in second arg → unchanged', () => {
    const out = cleanLogArgs([42, '%c[eval] msg']);
    expect(out).toEqual([42, '%c[eval] msg']);
  });

  it('two-arg shape: extra non-CSS args after the CSS are preserved', () => {
    const out = cleanLogArgs([
      '%c[eval] msg',
      'background-color: black;',
      { detail: 'stack' },
      42,
    ]);
    expect(out).toEqual(['[eval] msg', { detail: 'stack' }, 42]);
  });

  it('idempotent: cleanLogArgs(cleanLogArgs(x)) deep-equals cleanLogArgs(x)', () => {
    const a: readonly unknown[] = [
      '%c[eval] code updated',
      'background-color: black;color:white;border-radius:15px',
    ];
    const b: readonly unknown[] = [
      '%c[eval] code updated background-color: black;color:white;border-radius:15px',
    ];
    const c: readonly unknown[] = ['%c[eval] msg'];
    const d: readonly unknown[] = ['plain message', 'extra'];
    const e: readonly unknown[] = [];
    for (const original of [a, b, c, d, e]) {
      const once = cleanLogArgs(original);
      const twice = cleanLogArgs(once);
      expect(twice).toEqual(once);
    }
  });

  it('returns a fresh array (mutating the result does not corrupt the input)', () => {
    const input: readonly unknown[] = ['hello'];
    const out = cleanLogArgs(input);
    expect(out).not.toBe(input);
    (out as unknown[]).push('mutated');
    expect(input).toEqual(['hello']);
  });
});