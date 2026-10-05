import { describe, it, expect } from 'vitest';
import { hapsToSequence } from './encoder';
import type { NoteEvent } from './encoder';
import type { MIDIExportOptions } from './types';

const opts: MIDIExportOptions = { bpm: 120, cycles: 1 };

describe('midi/encoder hapsToSequence', () => {
  it('groups events by channel into separate tracks', () => {
    const events: NoteEvent[] = [
      { midi: 60, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 1 },
      { midi: 64, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 2 },
      { midi: 67, startCycle: 0.5, endCycle: 1, velocity: 100, channel: 1 },
    ];
    const { seq, warnings } = hapsToSequence(events, opts);
    expect(warnings.length).toBe(0);
    expect(seq.tracks.length).toBe(2);
    expect(seq.tracks[0]!.channel).toBe(1);
    expect(seq.tracks[0]!.notes.length).toBe(2);
    expect(seq.tracks[1]!.channel).toBe(2);
    expect(seq.tracks[1]!.notes.length).toBe(1);
  });

  it('converts cycles to seconds via 60/bpm', () => {
    const events: NoteEvent[] = [
      { midi: 60, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 1 },
    ];
    const { seq } = hapsToSequence(events, opts);
    const note = seq.tracks[0]!.notes[0]!;
    expect(note.timeSec).toBeCloseTo(0, 6);
    expect(note.durationSec).toBeCloseTo(0.25, 6);
  });

  it('skips out-of-range midi', () => {
    const events: NoteEvent[] = [
      { midi: 200, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 1 },
      { midi: 60, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 1 },
    ];
    const { seq, warnings } = hapsToSequence(events, opts);
    expect(seq.tracks[0]!.notes.length).toBe(1);
    expect(seq.tracks[0]!.notes[0]!.midi).toBe(60);
    expect(warnings.length).toBe(1);
  });

  it('warns on invalid intervals', () => {
    const events: NoteEvent[] = [
      { midi: 60, startCycle: 1, endCycle: 0.5, velocity: 100, channel: 1 },
    ];
    const { seq, warnings } = hapsToSequence(events, opts);
    expect(seq.tracks[0]?.notes.length ?? 0).toBe(0);
    expect(warnings.length).toBe(1);
  });

  it('warns on empty result', () => {
    const { warnings } = hapsToSequence([], opts);
    expect(warnings).toContain('нет валидных note-событий после фильтрации');
  });

  it('respects defaultVelocity option', () => {
    const events: NoteEvent[] = [
      { midi: 60, startCycle: 0, endCycle: 0.5, velocity: 0, channel: 1 },
    ];
    const { seq } = hapsToSequence(events, { bpm: 120, cycles: 1, defaultVelocity: 80 });
    const note = seq.tracks[0]!.notes[0]!;
    expect(note.velocity).toBeCloseTo(80 / 127, 5);
  });
});