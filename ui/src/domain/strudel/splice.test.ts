/**
 * Unit tests for the AST-based `appendToTopStack` score splice.
 *
 * These pin the legacy `stackAppend` behaviour (the hand-rolled
 * paren-walker previously living in `pianoRecStore.ts` / `micStore.ts`)
 * so the migration to the AST is a drop-in replacement, PLUS the new
 * "unbalanced stack" refusal the walker could not express.
 */

import { describe, it, expect } from 'vitest';
import { appendToTopStack } from './splice';

const SNIPPET = 'note("c4").s("triangle")';

describe('appendToTopStack — empty / whitespace editor', () => {
  it('returns the snippet verbatim for an empty editor', () => {
    const out = appendToTopStack('', SNIPPET);
    expect(out).toEqual({ ok: true, score: SNIPPET });
  });

  it('returns the snippet verbatim for a whitespace-only editor', () => {
    const out = appendToTopStack('   \n  ', SNIPPET);
    expect(out).toEqual({ ok: true, score: SNIPPET });
  });
});

describe('appendToTopStack — wrap (no top-level stack)', () => {
  it('wraps a bare note(...) score in a fresh stack', () => {
    const out = appendToTopStack('note("e4 g4")', SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toMatch(/^stack\(/);
      expect(out.score).toContain('note("e4 g4")');
      expect(out.score).toContain(SNIPPET);
      expect(out.score.trimEnd().endsWith(')')).toBe(true);
    }
  });

  it('wraps a cat([...]) container (not a splice target)', () => {
    const out = appendToTopStack('cat([s("a"), s("b")])', SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
      expect(out.score).toContain('cat([s("a"), s("b")])');
    }
  });

  it('does not splice into a stack that follows a non-stack statement', () => {
    // Legacy `findTopLevelStackAt` required the FIRST token to be `stack`.
    const out = appendToTopStack('foo(1)\nstack(s("a"))', SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Wrapped, not spliced → a fresh outer stack containing both.
      expect(out.score).toMatch(/^stack\(/);
      expect(out.score).toContain('foo(1)');
      expect(out.score).toContain('stack(s("a"))');
    }
  });
});

describe('appendToTopStack — splice into existing top-level stack', () => {
  it('splices inside, preserving a single outer stack', () => {
    const existing = 'stack(\n  note("e4"),\n  s("hh*4")\n)';
    const out = appendToTopStack(existing, SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score.startsWith('stack(')).toBe(true);
      expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
      expect(out.score).toContain('note("e4")');
      expect(out.score).toContain('s("hh*4")');
      expect(out.score).toContain(SNIPPET);
    }
  });

  it('does not double the comma when the stack ends with a trailing comma', () => {
    const out = appendToTopStack('stack(s("a"),)', 's("b")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('s("a"),');
      expect(out.score).toContain('s("b")');
      expect(out.score).not.toContain(',,\n');
    }
  });

  it('survives commas inside nested string args of an existing stack', () => {
    const out = appendToTopStack('stack(s("<a, b, c>"), s("d"))', 's("e")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('s("<a, b, c>")');
      expect(out.score).toContain('s("d")');
      expect(out.score).toContain('s("e")');
    }
  });

  it('does not treat s("…") inside a comment as a splice boundary', () => {
    const existing = 'stack(\n  // s("fake layer")\n  s("a")\n)';
    const out = appendToTopStack(existing, 's("b")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('s("fake layer")');
      expect(out.score).toContain('s("a")');
      expect(out.score).toContain('s("b")');
      expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
    }
  });

  it('keeps a trailing method chain (.gain / .slow) outside the splice', () => {
    const out = appendToTopStack('stack(s("a")).gain(0.5)', 's("b")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('.gain(0.5)');
      expect(out.score).toContain('s("b")');
      expect(out.score).toContain('s("a")');
    }
  });
});

describe('appendToTopStack — unbalanced stack refusal', () => {
  it('returns { ok: false } for an unterminated stack(...)', () => {
    const out = appendToTopStack('stack(s("a")', SNIPPET);
    expect(out).toEqual({ ok: false, reason: 'unbalanced-stack' });
  });

  it('returns { ok: false } for a stack with an unterminated string', () => {
    const out = appendToTopStack('stack(s("a", s("b")', SNIPPET);
    expect(out).toEqual({ ok: false, reason: 'unbalanced-stack' });
  });
});
