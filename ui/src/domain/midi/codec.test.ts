import { describe, it, expect } from 'vitest';
import { parseSmi, writeSmi } from './codec';
import type { MIDISequence } from './types';

const simpleSeq = (): MIDISequence => ({
  bpm: 120,
  ppq: 480,
  durationSec: 1,
  tracks: [
    {
      channel: 1,
      notes: [
        { midi: 60, timeSec: 0, durationSec: 0.25, velocity: 0.8 },
        { midi: 64, timeSec: 0.5, durationSec: 0.25, velocity: 0.7 },
        { midi: 67, timeSec: 1.0, durationSec: 0.25, velocity: 0.8 },
      ],
    },
  ],
});

describe('midi/codec roundtrip', () => {
  it('writeSmi → parseSmi preserves notes (within tick resolution)', () => {
    const seq = simpleSeq();
    const bytes = writeSmi(seq);
    const parsed = parseSmi(bytes);
    expect(parsed.bpm).toBe(120);
    expect(parsed.ppq).toBe(480);
    expect(parsed.tracks.length).toBe(1);
    const t = parsed.tracks[0]!;
    expect(t.channel).toBe(1);
    expect(t.notes.length).toBe(3);
    expect(t.notes[0]!.midi).toBe(60);
    expect(t.notes[1]!.midi).toBe(64);
    expect(t.notes[2]!.midi).toBe(67);
    expect(t.notes[0]!.velocity).toBeCloseTo(0.8, 2);
  });

  it('writeSmi preserves channel 10 (drums)', () => {
    const seq: MIDISequence = {
      bpm: 100,
      ppq: 480,
      durationSec: 0.5,
      tracks: [
        {
          channel: 10,
          notes: [{ midi: 36, timeSec: 0, durationSec: 0.1, velocity: 0.9 }],
        },
      ],
    };
    const bytes = writeSmi(seq);
    const parsed = parseSmi(bytes);
    expect(parsed.tracks[0]!.channel).toBe(10);
  });

  it('parses with empty tracks', () => {
    const seq: MIDISequence = {
      bpm: 120,
      ppq: 480,
      durationSec: 0,
      tracks: [],
    };
    const bytes = writeSmi(seq);
    const parsed = parseSmi(bytes);
    expect(parsed.tracks.length).toBe(0);
  });

  it('handles non-default ppq (960)', () => {
    const seq = simpleSeq();
    const bytes = writeSmi({ ...seq, ppq: 960 });
    const parsed = parseSmi(bytes);
    expect(parsed.ppq).toBe(960);
  });
});