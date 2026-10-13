import { describe, it, expect } from 'vitest';
import {
  noteNumberToName,
  midiToStrudelNote,
  strudelNoteToMidi,
  singleNoteSnippet,
  multiNoteSnippet,
  SILENCE_SNIPPET,
  isInPianoRange,
  rangeNotes,
  isBlackKey,
  pianoInstrumentToOscType,
  type PianoInstrument,
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

  it('multiNoteSnippet: empty set returns SILENCE_SNIPPET', () => {
    expect(multiNoteSnippet(new Set())).toBe(SILENCE_SNIPPET);
    expect(SILENCE_SNIPPET).toBe('silence');
  });

  it('multiNoteSnippet: single note → bare voice (no stack wrapper)', () => {
    const snippet = multiNoteSnippet(new Set(['c4']));
    expect(snippet).not.toContain('stack(');
    expect(snippet).toContain('note("c4")');
    expect(snippet).toContain('s("triangle")');
    expect(snippet).toContain('gain(0.3)');
    expect(snippet).toContain('attack(0.005)');
    expect(snippet).toContain('decay(0.4)');
  });

  it('multiNoteSnippet: chord → stack() with one voice per note', () => {
    const snippet = multiNoteSnippet(new Set(['c4', 'e4', 'g4']));
    expect(snippet.startsWith('stack(')).toBe(true);
    expect(snippet.endsWith(')')).toBe(true);
    expect(snippet).toContain('note("c4")');
    expect(snippet).toContain('note("e4")');
    expect(snippet).toContain('note("g4")');
    // Each voice carries its own gain — the mixer in injectMix may
    // override these per-layer, but the snippet must not omit them,
    // otherwise stack() layers would be mixer-less on first eval.
    const voiceCount = (snippet.match(/\.gain\(0\.3\)/g) ?? []).length;
    expect(voiceCount).toBe(3);
  });

  it('multiNoteSnippet: invalid note names are dropped silently', () => {
    const snippet = multiNoteSnippet(new Set(['c4', 'xx99', 'q']));
    expect(snippet).toContain('note("c4")');
    expect(snippet).not.toContain('xx99');
    expect(snippet).not.toContain('note("q")');
  });

  it('multiNoteSnippet: all notes invalid → SILENCE_SNIPPET', () => {
    const snippet = multiNoteSnippet(new Set(['xx99', 'q', '']));
    expect(snippet).toBe(SILENCE_SNIPPET);
  });

  it('multiNoteSnippet: normalizes uppercase note names to lowercase', () => {
    const snippet = multiNoteSnippet(new Set(['C4', 'E4', 'G4']));
    expect(snippet).toContain('note("c4")');
    expect(snippet).toContain('note("e4")');
    expect(snippet).toContain('note("g4")');
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

  describe('pianoInstrumentToOscType (W3C OscillatorType cast)', () => {
    // The mapping is identity — `PianoInstrument` is structurally a
    // subset of `OscillatorType` ('triangle' | 'sine' | 'sawtooth' |
    // 'square', which is exactly the W3C OscillatorType union minus
    // 'custom'). These tests guard against accidental drift.

    const all: ReadonlyArray<PianoInstrument> = ['triangle', 'sine', 'sawtooth', 'square'];

    it('returns the same string for every supported waveform', () => {
      for (const inst of all) {
        expect(pianoInstrumentToOscType(inst)).toBe(inst);
      }
    });

    it('result is structurally an OscillatorType (assignment-safe)', () => {
      // Compile-time check: the returned string is assignable to
      // OscillatorType. If we ever add a literal to PianoInstrument that
      // doesn't match, this assignment breaks.
      const osc: OscillatorType = pianoInstrumentToOscType('triangle');
      expect(typeof osc).toBe('string');
    });

    it('does NOT include "custom" (would require PeriodicWave setup)', () => {
      const literals: ReadonlyArray<PianoInstrument> = all;
      for (const l of literals) {
        expect(l).not.toBe('custom');
      }
    });

    it('exhaustive — exactly 4 instruments', () => {
      expect(all).toHaveLength(4);
    });
  });
});
