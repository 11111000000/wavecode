import { describe, it, expect } from 'vitest';
import {
  noteNumberToName,
  isInPianoRange,
  rangeNotes,
  singleNoteSnippet,
} from '~/domain/music/notes';

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
