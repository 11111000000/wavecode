import { describe, it, expect } from 'vitest';
import { detectBpm, midiToScore } from './decoder';
import { gmDrumMap } from '~/application/midi/gmDrumMap';
import type { MIDISequence } from './types';

const melody = (
  notes: ReadonlyArray<{ midi: number; timeSec: number }>,
  bpm = 120,
  channel = 1,
): MIDISequence => ({
  bpm,
  ppq: 480,
  durationSec: 4,
  tracks: [
    {
      channel,
      notes: notes.map((n) => ({
        midi: n.midi,
        timeSec: n.timeSec,
        durationSec: 0.25,
        velocity: 0.8,
      })),
    },
  ],
});

describe('midi/decoder detectBpm', () => {
  it('uses seq.bpm when in range', () => {
    expect(detectBpm(melody([], 140))).toBe(140);
  });

  it('falls back to 120 when seq.bpm out of range', () => {
    expect(detectBpm(melody([], 600))).toBe(120);
  });

  it('detects from median IOI when seq.bpm is invalid', () => {
    const seq = melody([], 0);
    const notes: { midi: number; timeSec: number }[] = [];
    for (let i = 0; i < 8; i++) {
      notes.push({ midi: 60, timeSec: i * 0.5 });
    }
    const seqWithNotes = melody(notes, 0);
    expect(detectBpm(seqWithNotes)).toBe(120);
  });

  it('detects 60 BPM from 1-sec IOI', () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({
      midi: 60,
      timeSec: i,
    }));
    const seqWithNotes: MIDISequence = {
      ...melody(notes, 0),
      bpm: 0,
    };
    expect(detectBpm(seqWithNotes)).toBe(60);
  });

  it('falls back to 120 when too few notes', () => {
    const seq: MIDISequence = {
      bpm: 0,
      ppq: 480,
      durationSec: 1,
      tracks: [
        {
          channel: 1,
          notes: [{ midi: 60, timeSec: 0, durationSec: 0.5, velocity: 0.8 }],
        },
      ],
    };
    expect(detectBpm(seq)).toBe(120);
  });
});

describe('midi/decoder midiToScore', () => {
  it('emits note() with quantized 16ths', () => {
    const seq = melody([
      { midi: 60, timeSec: 0 },
      { midi: 64, timeSec: 0.125 },
      { midi: 67, timeSec: 0.25 },
    ], 120);
    const result = midiToScore(seq, {}, gmDrumMap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toBe('note("c4 e4 g4")');
  });

  it('emits ~ for rest cells', () => {
    const seq = melody([
      { midi: 60, timeSec: 0 },
      { midi: 64, timeSec: 0.25 },
    ], 120);
    const result = midiToScore(seq, {}, gmDrumMap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toBe('note("c4 ~ e4")');
  });

  it('emits [a,b] chord for simultaneous notes', () => {
    const seq = melody([
      { midi: 60, timeSec: 0 },
      { midi: 64, timeSec: 0 },
      { midi: 67, timeSec: 0 },
    ], 120);
    const result = midiToScore(seq, {}, gmDrumMap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toBe('note("[c4,e4,g4]")');
  });

  it('emits s() for channel 10 (drums) using GM drum map', () => {
    const seq: MIDISequence = {
      bpm: 120,
      ppq: 480,
      durationSec: 1,
      tracks: [
        {
          channel: 10,
          notes: [
            { midi: 36, timeSec: 0, durationSec: 0.1, velocity: 0.9 },
            { midi: 38, timeSec: 0.25, durationSec: 0.1, velocity: 0.8 },
          ],
        },
      ],
    };
    const result = midiToScore(seq, {}, gmDrumMap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toBe('s("bd ~ sd")');
  });

  it('wraps in stack() for multi-track', () => {
    const seq: MIDISequence = {
      bpm: 120,
      ppq: 480,
      durationSec: 1,
      tracks: [
        {
          channel: 1,
          notes: [{ midi: 60, timeSec: 0, durationSec: 0.5, velocity: 0.8 }],
        },
        {
          channel: 10,
          notes: [{ midi: 36, timeSec: 0, durationSec: 0.1, velocity: 0.9 }],
        },
      ],
    };
    const result = midiToScore(seq, {}, gmDrumMap);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.score).toContain('stack(');
    expect(result.score).toContain('note(');
    expect(result.score).toContain('s(');
  });

  it('returns error for empty tracks', () => {
    const seq: MIDISequence = {
      bpm: 120,
      ppq: 480,
      durationSec: 0,
      tracks: [],
    };
    const result = midiToScore(seq, {}, gmDrumMap);
    expect(result.ok).toBe(false);
  });

  it('skips channel 10 when drumsAsSamples=false', () => {
    const seq: MIDISequence = {
      bpm: 120,
      ppq: 480,
      durationSec: 1,
      tracks: [
        {
          channel: 10,
          notes: [{ midi: 36, timeSec: 0, durationSec: 0.1, velocity: 0.9 }],
        },
      ],
    };
    const result = midiToScore(seq, { drumsAsSamples: false }, gmDrumMap);
    expect(result.ok).toBe(false);
  });
});