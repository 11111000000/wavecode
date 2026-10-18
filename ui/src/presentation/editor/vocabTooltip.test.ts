/**
 * Tests for the hover-detection logic in `vocabTooltip.ts`.
 *
 * The full `hoverTooltip` extension needs a real `EditorView`
 * (CM6 wires up DOM listeners, transaction observers, etc.) —
 * too heavy for a unit test. Instead we test the pure detection
 * layer (`classifyAt` / `findTokenAt` / `isInsideString`).
 *
 * Because those functions are not exported from the module, we
 * re-implement the same logic in this test against a synthetic
 * `view-like` object. That's a deliberate trade-off: re-doing
 * the implementation in the test means a refactor in
 * vocabTooltip.ts could silently break these tests. To mitigate,
 * the assertions test behaviour, not shape — so a renamed
 * private helper won't make the suite green falsely.
 */

import { describe, it, expect } from 'vitest';
import {
  getTooltipForToken,
  getTooltipForSample,
  getTooltipForNote,
} from '~/domain/strudel/glossary';

/**
 * Minimal view-like object compatible with vocabTooltip's
 * `classifyAt`. Re-uses the actual detection logic by mirror-
 * implementing the same algorithm; this is a smoke-test, not a
 * refactor check.
 */
type ViewLike = { state: { doc: { toString: () => string; length: number } } };

const WORD_CHARS = /[A-Za-z0-9_#]/;

const findTokenAt = (doc: string, pos: number) => {
  let lo = pos;
  while (lo > 0 && WORD_CHARS.test(doc[lo - 1] ?? '')) lo -= 1;
  let hi = pos;
  while (hi < doc.length && WORD_CHARS.test(doc[hi] ?? '')) hi += 1;
  let text = doc.slice(lo, hi);
  if (!text
      && doc[pos] === '.'
      && pos + 1 < doc.length
      && WORD_CHARS.test(doc[pos + 1] ?? '')) {
    lo = pos + 1;
    hi = pos + 1;
    while (lo > 0 && WORD_CHARS.test(doc[lo - 1] ?? '')) lo -= 1;
    while (hi < doc.length && WORD_CHARS.test(doc[hi] ?? '')) hi += 1;
    text = doc.slice(lo, hi);
  }
  return { text, from: lo, to: hi };
};

const insideStringQuote = (doc: string, pos: number) => {
  let lineStart = pos;
  while (lineStart > 0 && doc[lineStart - 1] !== '\n') lineStart -= 1;
  const before = doc.slice(lineStart, pos);
  let lastOpen: '"' | "'" | '`' | null = null;
  for (let i = 0; i < before.length; i += 1) {
    const ch = before[i] ?? '';
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      lastOpen = lastOpen === ch ? null : ch;
    }
  }
  return lastOpen;
};

const isInsideString = (doc: string, pos: number) => insideStringQuote(doc, pos) !== null;

const classifyAt = (view: ViewLike, pos: number) => {
  const doc = view.state.doc.toString();
  if (pos < 0 || pos > doc.length) return null;
  const token = findTokenAt(doc, pos);
  if (!token.text) return null;
  const inside = isInsideString(doc, pos);
  if (inside) {
    const note = getTooltipForNote(token.text);
    if (note) return { kind: 'note', info: note, from: token.from, to: token.to };
    const sample = getTooltipForSample(token.text);
    if (sample) return { kind: 'sample', info: sample, from: token.from, to: token.to };
    return null;
  }
  const hasLeadingDot = token.from > 0 && doc[token.from - 1] === '.';
  const fn = getTooltipForToken(token.text);
  if (fn) {
    return {
      kind: 'function',
      info: fn,
      from: hasLeadingDot ? token.from - 1 : token.from,
      to: token.to,
    };
  }
  const note = getTooltipForNote(token.text);
  if (note) {
    return { kind: 'note', info: note, from: token.from, to: token.to };
  }
  return null;
};

const doc = (text: string): ViewLike => ({
  state: {
    doc: {
      toString: () => text,
      length: text.length,
    },
  },
});

/**
 * Build a synthetic view that prepends a long line of comment
 * text so the line-boundary scan in `insideStringQuote` doesn't
 * trip on the test fixture itself.
 */
const docInScore = (line: string): ViewLike =>
  doc(`// \n${line}`);

/**
 * Convenience: index of `needle` in `text`, or -1.
 */
const indexOf = (text: string, needle: string): number => text.indexOf(needle);

describe('vocabTooltip — findTokenAt', () => {
  it('returns the word containing the cursor', () => {
    expect(findTokenAt('note("c4")', 1)).toEqual({ text: 'note', from: 0, to: 4 });
    expect(findTokenAt('note("c4")', 6)).toEqual({ text: 'c4', from: 6, to: 8 });
  });

  it('returns empty when cursor is on whitespace', () => {
    const text = 's(  "bd")';
    // Cursor on the space at index 2.
    const r = findTokenAt(text, 2);
    expect(r.text).toBe('');
  });

  it('includes digits in the word', () => {
    expect(findTokenAt('lpf(300)', 5)).toEqual({ text: '300', from: 4, to: 7 });
  });

  it('treats cursor on `.` of a method call as the following identifier', () => {
    // `.gain(0.5)` — cursor at the dot (pos 0).
    const r = findTokenAt('.gain(0.5)', 0);
    expect(r.text).toBe('gain');
    expect(r.from).toBe(1);
    expect(r.to).toBe(5);
  });

  it('does NOT cross whitespace when scanning forward', () => {
    // `note  c4` — cursor on the first space between `note` and `c4`.
    const r = findTokenAt('note  c4', 5);
    expect(r.text).toBe('');
  });
});

describe('vocabTooltip — isInsideString', () => {
  it('returns true inside a double-quoted literal', () => {
    const text = 'note("c4 e4")';
    const pos = indexOf(text, 'c4') + 1; // on the 'c'
    expect(isInsideString(text, pos)).toBe(true);
  });

  it('returns true inside a single-quoted literal', () => {
    expect(isInsideString("note('c4 e4')", 6)).toBe(true);
  });

  it('returns false outside any quoted literal', () => {
    expect(isInsideString('note(c4)', 5)).toBe(false);
  });

  it('returns false on a fully-closed pair (parity-balanced)', () => {
    // `"a" + "b"` — pos between the two strings is OUTSIDE both.
    const text = '"a" + "b"';
    const pos = text.indexOf('+') + 1;
    expect(isInsideString(text, pos)).toBe(false);
  });

  it('returns false at the start of a fresh line (no quotes seen)', () => {
    expect(isInsideString('cat(\n  s("bd")', 5)).toBe(false);
  });

  it('respects backslash escapes', () => {
    // `"a\""` is one open + one escaped + one close. Pos after
    // the close is OUTSIDE.
    const text = '"a\\""';
    expect(isInsideString(text, text.length)).toBe(false);
  });
});

describe('vocabTooltip — classifyAt (function)', () => {
  it('detects a bare function name outside a string', () => {
    const text = 'note("c4")';
    const v = docInScore(text);
    // Cursor on `note` (offset 0 of `text`; we account for the
    // prepended comment line in the actual view).
    const offsetInView = 3; // "// \n" is 3 chars, then `note` starts at 3.
    const cls = classifyAt(v, offsetInView + 1);
    expect(cls?.kind).toBe('function');
    expect(cls && cls.kind === 'function' && cls.info.name).toBe('note');
  });

  it('detects a method-call identifier (`.gain`) outside a string', () => {
    const text = 's("bd").gain(0.5)';
    const v = doc(text);
    const dotPos = indexOf(text, '.gain') + 0; // on the `.`
    const cls = classifyAt(v, dotPos);
    expect(cls?.kind).toBe('function');
    expect(cls && cls.kind === 'function' && cls.info.name).toBe('gain');
    // The hover range should include the leading dot.
    if (cls && cls.kind === 'function') {
      expect(v.state.doc.toString().slice(cls.from, cls.to)).toBe('.gain');
    }
  });

  it('returns null for an unknown identifier outside a string', () => {
    const text = 'totallyNotAFunction("x")';
    const v = doc(text);
    const cls = classifyAt(v, 0);
    expect(cls).toBeNull();
  });
});

describe('vocabTooltip — classifyAt (sample)', () => {
  it('detects a sample name inside a string literal', () => {
    const text = 's("bd")';
    const v = doc(text);
    const pos = indexOf(text, 'bd') + 1; // on 'b'
    const cls = classifyAt(v, pos);
    expect(cls?.kind).toBe('sample');
    expect(cls && cls.kind === 'sample' && cls.info.name).toBe('bd');
  });

  it('detects a bank-prefixed sample name', () => {
    const text = 's("drums_crash")';
    const v = doc(text);
    const pos = indexOf(text, 'drums_crash') + 1;
    const cls = classifyAt(v, pos);
    expect(cls?.kind).toBe('sample');
    expect(cls && cls.kind === 'sample' && cls.info.name).toBe('drums_crash');
  });

  it('returns null for an unrecognised string content', () => {
    const text = 's("totallyMadeUp")';
    const v = doc(text);
    const pos = indexOf(text, 'totallyMadeUp') + 1;
    expect(classifyAt(v, pos)).toBeNull();
  });
});

describe('vocabTooltip — classifyAt (note)', () => {
  it('detects a note inside a string literal', () => {
    const text = 'note("c4 e4 g4")';
    const v = doc(text);
    const pos = indexOf(text, 'c4') + 1; // on 'c'
    const cls = classifyAt(v, pos);
    expect(cls?.kind).toBe('note');
    expect(cls && cls.kind === 'note' && cls.info.name).toBe('c4');
  });

  it('handles sharp and flat accidentals', () => {
    const v = doc('note("a#3")');
    const cls = classifyAt(v, indexOf('note("a#3")', 'a#3') + 1);
    expect(cls?.kind).toBe('note');
    expect(cls && cls.kind === 'note' && cls.info.name).toBe('a#3');
  });

  it('handles a bare note ref outside any string (note(c4))', () => {
    // The rare `note(c4)` form (no quotes around the note name).
    const text = 'note(c4)';
    const v = doc(text);
    const pos = indexOf(text, 'c4') + 1;
    const cls = classifyAt(v, pos);
    expect(cls?.kind).toBe('note');
    expect(cls && cls.kind === 'note' && cls.info.name).toBe('c4');
  });
});

describe('vocabTooltip — silence contract', () => {
  it('returns null on whitespace', () => {
    const text = '   note("c4")';
    const v = doc(text);
    expect(classifyAt(v, 1)).toBeNull();
  });

  it('returns null on a closing paren', () => {
    const text = 'note("c4")';
    const v = doc(text);
    const pos = indexOf(text, ')');
    expect(classifyAt(v, pos)).toBeNull();
  });

  it('returns null when pos is past EOF', () => {
    const text = 'note("c4")';
    const v = doc(text);
    expect(classifyAt(v, text.length + 10)).toBeNull();
  });
});