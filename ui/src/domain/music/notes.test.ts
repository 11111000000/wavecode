import { describe, it, expect } from 'vitest';
import {
  noteNumberToName,
  midiToStrudelNote,
  strudelNoteToMidi,
  singleNoteSnippet,
  isInPianoRange,
  rangeNotes,
  isBlackKey,
} from './notes';

describe('notes', () => {
  it('noteNumberToName: Middle C and A4', () => {
    expect(noteNumberToName(60)).toBe('C4');
    expect(noteNumberToName(69)).toBe('A4');
  });

  it('noteNumberToName: chromatic octave from C to B', () => {
    expect(noteNumberToName(60)).toBe('C4');
    expect(noteNumberToName(61)).toBe('C#4');
    expect(noteNumberToName(62)).toBe('D4');
    expect(noteNumberToName(63)).toBe('D#4');
    expect(noteNumberToName(64)).toBe('E4');
    expect(noteNumberToName(65)).toBe('F4');
    expect(noteNumberToName(66)).toBe('F#4');
    expect(noteNumberToName(67)).toBe('G4');
    expect(noteNumberToName(68)).toBe('G#4');
    expect(noteNumberToName(69)).toBe('A4');
    expect(noteNumberToName(70)).toBe('A#4');
    expect(noteNumberToName(71)).toBe('B4');
  });

  it('noteNumberToName: flat spelling', () => {
    expect(noteNumberToName(61, true)).toBe('Db4');
    expect(noteNumberToName(63, true)).toBe('Eb4');
  });

  it('midiToStrudelNote: lowercase', () => {
    expect(midiToStrudelNote(60)).toBe('c4');
    expect(midiToStrudelNote(69)).toBe('a4');
  });

  it('strudelNoteToMidi: round-trip', () => {
    for (const n of [48, 60, 69, 71]) {
      expect(strudelNoteToMidi(midiToStrudelNote(n))).toBe(n);
    }
  });

  it('singleNoteSnippet: contains note() with envelope chain', () => {
    const snippet = singleNoteSnippet('C4');
    expect(snippet).toContain('note(');
    expect(snippet).toContain('triangle');
    expect(snippet).toContain('attack(0.005)');
    expect(snippet).toContain('decay(0.4)');
  });

  it('isInPianoRange', () => {
    expect(isInPianoRange(60)).toBe(true);
    expect(isInPianoRange(48)).toBe(true);
    expect(isInPianoRange(71)).toBe(true);
    expect(isInPianoRange(47)).toBe(false);
    expect(isInPianoRange(72)).toBe(false);
  });

  it('rangeNotes: 24 notes from C3 to B4', () => {
    const notes = rangeNotes();
    expect(notes).toHaveLength(24);
    expect(notes[0]).toBe(48);
    expect(notes[notes.length - 1]).toBe(71);
  });

  it('isBlackKey: 5 black keys per octave', () => {
    // C major scale from C4: C C# D D# E F F# G G# A A# B → black on 61,63,66,68,70
    expect(isBlackKey(60)).toBe(false);
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(62)).toBe(false);
    expect(isBlackKey(63)).toBe(true);
    expect(isBlackKey(64)).toBe(false);
    expect(isBlackKey(65)).toBe(false);
    expect(isBlackKey(66)).toBe(true);
    expect(isBlackKey(67)).toBe(false);
    expect(isBlackKey(68)).toBe(true);
    expect(isBlackKey(69)).toBe(false);
    expect(isBlackKey(70)).toBe(true);
    expect(isBlackKey(71)).toBe(false);
  });
});
