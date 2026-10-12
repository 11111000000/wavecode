import { describe, it, expect } from 'vitest';
import {
  noteNumberToName,
  isInPianoRange,
  rangeNotes,
  singleNoteSnippet,
  isBlackKey,
} from '~/domain/music/notes';

/** Mirror of PianoKeyboard.tsx constants — duplicated here so the test
 *  asserts the layout formula without pulling Solid + DOM into the unit
 *  environment (kept as pure-functional spec). */
const PIANO_WHITE_W = 80;
const PIANO_BLACK_W = 50;

describe('PianoKeyboard mappings (via notes.ts pure fns)', () => {
  it('rangeNotes returns 24 notes in 2 octaves', () => {
    const notes = rangeNotes();
    expect(notes).toHaveLength(24);
  });

  it('isInPianoRange covers C3..B4', () => {
    for (const n of [48, 60, 71]) expect(isInPianoRange(n)).toBe(true);
    for (const n of [47, 72]) expect(isInPianoRange(n)).toBe(false);
  });

  it('noteNumberToName: white + black keys in range', () => {
    expect(noteNumberToName(48)).toBe('C3');
    expect(noteNumberToName(60)).toBe('C4');
    expect(noteNumberToName(61)).toBe('C#4');
    expect(noteNumberToName(71)).toBe('B4');
  });

  it('singleNoteSnippet produces valid Strudel for any in-range note', () => {
    for (const n of rangeNotes()) {
      const name = noteNumberToName(n);
      const snippet = singleNoteSnippet(name);
      expect(snippet).toMatch(/note\(["'][a-g][#b]?[0-9-]+["']\)/);
      expect(snippet).toContain('triangle');
      expect(snippet).toContain('attack(0.005)');
      expect(snippet).toContain('decay(0.4)');
    }
  });
});

/**
 * Layout invariants for the on-screen piano. Mirrors the inline-style
 * formula in PianoKeyboard.tsx (lines 145-152):
 *   wIdx   = whiteIndex(midi - 1)
 *   bW     = PIANO_BLACK_W
 *   left   = (wIdx + 1) * PIANO_WHITE_W - bW / 2
 *   right  = left + bW
 * Each black key must straddle the boundary between its prev and next
 * white keys (else gaps appear or it covers wrong neighbours).
 */
describe('PianoKeyboard layout invariants (black-key overlap with neighbours)', () => {
  const whiteNotes = rangeNotes().filter((n) => !isBlackKey(n));

  function whiteIndex(midi: number): number {
    return whiteNotes.findIndex((n) => n === midi);
  }

  interface Box { left: number; right: number; }
  function blackBounds(midi: number): Box {
    const wIdx = whiteIndex(midi - 1);
    const wW = PIANO_WHITE_W;
    const bW = PIANO_BLACK_W;
    const left = (wIdx + 1) * wW - bW / 2;
    return { left, right: left + bW };
  }

  function whiteBounds(midi: number): Box {
    const wIdx = whiteIndex(midi);
    const wW = PIANO_WHITE_W;
    return { left: wIdx * wW, right: (wIdx + 1) * wW };
  }

  const blackKeys = rangeNotes().filter(isBlackKey);

  it('count: there are exactly 10 black keys in 2 octaves (5 black per octave)', () => {
    expect(blackKeys).toHaveLength(10);
  });

  it('every black key has both a prev and a next white neighbour (skips first/last)', () => {
    for (const midi of blackKeys) {
      expect(whiteIndex(midi - 1)).toBeGreaterThanOrEqual(0);
      expect(whiteIndex(midi + 1)).toBeGreaterThanOrEqual(0);
    }
  });

  it('every black key straddles the boundary between prev and next white keys', () => {
    for (const midi of blackKeys) {
      const black = blackBounds(midi);
      const prevWhite = whiteBounds(midi - 1);
      const nextWhite = whiteBounds(midi + 1);
      // Чёрная клавиша позиционируется так, чтобы её левый край был
      // левее правого края предыдущей белой (overlap с prev), а её
      // правый край — правее левого края следующей белой (overlap с
      // next). Это и есть шахматное перекрытие.
      expect(black.left).toBeLessThanOrEqual(prevWhite.right);
      expect(black.left).toBeLessThanOrEqual(nextWhite.left);
      expect(black.right).toBeGreaterThanOrEqual(prevWhite.left);
      expect(black.right).toBeGreaterThanOrEqual(nextWhite.left);
    }
  });

  it('every black-key right-edge does not extend past next white-key right edge', () => {
    for (const midi of blackKeys) {
      const black = blackBounds(midi);
      const nextWhite = whiteBounds(midi + 1);
      // Чёрная не вылезает за правый край следующей белой (визуально
      // теряется ощущение границы).
      expect(black.right).toBeLessThanOrEqual(nextWhite.right);
    }
  });

  it('no two adjacent black keys overlap horizontally', () => {
    // В пределах одной октавы чёрные клавиши разнесены: C#-D# и F#-G#-A#
    // (3-полутоновый зазор). Проверяем отсутствие горизонтального
    // перекрытия для всех пар.
    for (let i = 0; i < blackKeys.length; i++) {
      const aMidi = blackKeys[i]!;
      for (let j = i + 1; j < blackKeys.length; j++) {
        const bMidi = blackKeys[j]!;
        const a = blackBounds(aMidi);
        const b = blackBounds(bMidi);
        const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        // Исключение — E# и F# в одной октаве ОКР не бывает; F# не
        // существует в нашем диапазоне между C# и G# таких пар нет.
        // Поэтому просто проверяем, что overlap == 0.
        expect(overlap).toBe(0);
      }
    }
  });
});
