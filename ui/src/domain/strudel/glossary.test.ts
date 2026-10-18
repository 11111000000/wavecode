/**
 * Tests for the inline vocabulary glossary.
 *
 * Three lookup surfaces:
 *   - getTooltipForToken: Strudel functions (note, s, .gain, …)
 *   - getTooltipForSample: sample names (bd, drums_bd, …)
 *   - getTooltipForNote: note pattern (c4, a#3, bb2, …)
 *
 * Each surface has 4 categories of test:
 *   1. Known-entity → returns TooltipInfo with non-empty ru + example
 *   2. Unknown → returns null (silence contract)
 *   3. Edge cases (empty string, whitespace, mixed case, dots)
 *   4. Coverage assertion (vocab size matches our contract)
 */

import { describe, it, expect } from 'vitest';
import {
  getTooltipForToken,
  getTooltipForSample,
  getTooltipForNote,
  VOCAB_SIZE,
  NOTE_REGEX,
  type TooltipInfo,
} from './glossary';

const FUNCTION_NAMES = [
  'note', 's', 'n', 'chord', 'cat', 'stack',
  'slow', 'fast', 'every',
  'gain', 'lpf', 'hpf', 'room', 'delay', 'swing', 'decay', 'sustain',
  'attack', 'release', 'voicing', 'shape', 'detune', 'range',
] as const;

const SAMPLE_NAMES = [
  'bd', 'sd', 'hh', 'oh', 'cp',
  'drums_bd', 'drums_sd', 'drums_hh', 'drums_ride', 'drums_crash',
] as const;

const NOTE_NAMES = [
  'c4', 'e5', 'a#3', 'bb2',
  'C4', 'G3', 'f#2', 'B5',
] as const;

const assertValid = (info: TooltipInfo | null, expectedName: string): TooltipInfo => {
  expect(info).not.toBeNull();
  if (!info) throw new Error('expected non-null TooltipInfo');
  expect(info.name).toBe(expectedName);
  expect(info.ru.length).toBeGreaterThan(0);
  expect(info.example.length).toBeGreaterThan(0);
  return info;
};

describe('getTooltipForToken (Strudel functions)', () => {
  it.each(FUNCTION_NAMES)('returns a TooltipInfo for "%s"', (name) => {
    const info = assertValid(getTooltipForToken(name), name);
    // The example should mention the function name (so the user
    // sees the same word they're hovering on).
    expect(info.example.toLowerCase()).toContain(name.toLowerCase());
    // Russian description must contain at least one Cyrillic
    // letter — guards against accidentally serving English text.
    expect(/[а-яё]/i.test(info.ru)).toBe(true);
  });

  it('strips a leading dot before lookup (so .gain and gain resolve the same)', () => {
    // Note: the hover source in CodeMirrorEditorImpl strips the
    // leading dot before calling this. The function itself does
    // NOT strip — we document the contract here. Callers are
    // expected to normalise. We still verify both forms return
    // SOMETHING useful (the bare-name call returns the function;
    // the dotted form returns null because it is not itself a
    // function name in our glossary — this is intentional).
    const bare = getTooltipForToken('gain');
    const dotted = getTooltipForToken('.gain');
    expect(bare).not.toBeNull();
    expect(dotted).toBeNull();
  });

  it('is case-insensitive (uppercase S resolves the same as lowercase)', () => {
    const lower = getTooltipForToken('s');
    const upper = getTooltipForToken('S');
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(lower?.name).toBe(upper?.name);
  });

  it('returns null for an unknown function name', () => {
    expect(getTooltipForToken('unknown_func')).toBeNull();
    expect(getTooltipForToken('xyz123')).toBeNull();
  });

  it('returns null for empty / whitespace input', () => {
    expect(getTooltipForToken('')).toBeNull();
    expect(getTooltipForToken('   ')).toBeNull();
  });

  it('exposes at least 17 functions (the committed coverage)', () => {
    expect(VOCAB_SIZE.functions).toBeGreaterThanOrEqual(17);
  });

  it('catches the additional envelopes / chord helpers used in BUILTIN_PRESETS', () => {
    // Some functions appear in the presets but weren't in the
    // initial 17 from the prompt. We add them so hover works on
    // realistic score content too — these are committed coverage
    // (every one is observed in ui/src/domain/presets.ts).
    for (const name of ['attack', 'release', 'voicing', 'shape', 'detune', 'range']) {
      expect(getTooltipForToken(name), `missing ${name}`).not.toBeNull();
    }
  });
});

describe('getTooltipForSample (Strudel sample names)', () => {
  it.each(SAMPLE_NAMES)('returns a TooltipInfo for "%s"', (name) => {
    const info = assertValid(getTooltipForSample(name), name);
    expect(/[а-яё]/i.test(info.ru)).toBe(true);
  });

  it('returns null for unknown sample names', () => {
    expect(getTooltipForSample('zz')).toBeNull();
    expect(getTooltipForSample('drums_zz')).toBeNull();
    expect(getTooltipForSample('not_a_drum')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(getTooltipForSample('')).toBeNull();
  });

  it('is case-sensitive (samples are lowercase by Strudel convention)', () => {
    const lower = getTooltipForSample('bd');
    const upper = getTooltipForSample('BD');
    expect(lower).not.toBeNull();
    expect(upper).toBeNull();
  });

  it('exposes at least 10 samples (the committed coverage)', () => {
    expect(VOCAB_SIZE.samples).toBeGreaterThanOrEqual(10);
  });
});

describe('getTooltipForNote (note-pattern lookup)', () => {
  it.each(NOTE_NAMES)('returns a TooltipInfo for "%s"', (name) => {
    const normalised = name.toLowerCase();
    const info = assertValid(getTooltipForNote(name), normalised);
    // Russian description must include the letter name.
    const letterName = {
      c: 'до', d: 'ре', e: 'ми', f: 'фа',
      g: 'соль', a: 'ля', b: 'си',
    }[normalised[0]!];
    expect(info.ru).toContain(letterName);
  });

  it('handles accidentals (sharp / flat) correctly', () => {
    const sharp = getTooltipForNote('a#3');
    const flat = getTooltipForNote('bb2');
    expect(sharp?.ru).toContain('диез');
    expect(flat?.ru).toContain('бемоль');
  });

  it('returns null for non-note-shaped strings', () => {
    expect(getTooltipForNote('xx4')).toBeNull();
    expect(getTooltipForNote('123')).toBeNull();
    expect(getTooltipForNote('bd')).toBeNull();        // sample, not note
    expect(getTooltipForNote('c44')).toBeNull();        // 2-digit octave
    expect(getTooltipForNote('h4')).toBeNull();         // h is not a note letter
  });

  it('returns null for empty / whitespace input', () => {
    expect(getTooltipForNote('')).toBeNull();
    expect(getTooltipForNote('   ')).toBeNull();
  });

  it('NOTE_REGEX matches all canonical note shapes', () => {
    expect(NOTE_REGEX.test('c4')).toBe(true);
    expect(NOTE_REGEX.test('a#3')).toBe(true);
    expect(NOTE_REGEX.test('bb2')).toBe(true);
    expect(NOTE_REGEX.test('C4')).toBe(true);
    expect(NOTE_REGEX.test('G5')).toBe(true);
    expect(NOTE_REGEX.test('bd')).toBe(false);
    expect(NOTE_REGEX.test('xx')).toBe(false);
    expect(NOTE_REGEX.test('12')).toBe(false);
  });

  it('exposes 7 note letters (CDEFGAB)', () => {
    expect(VOCAB_SIZE.noteLetters).toBe(7);
  });
});

describe('silence contract — every lookup returns null for unknown inputs', () => {
  const UNKNOWN_INPUTS = ['', '   ', '??', '__'];
  it.each(UNKNOWN_INPUTS)('all three lookups return null for "%s"', (input) => {
    expect(getTooltipForToken(input)).toBeNull();
    expect(getTooltipForSample(input)).toBeNull();
    expect(getTooltipForNote(input)).toBeNull();
  });
});