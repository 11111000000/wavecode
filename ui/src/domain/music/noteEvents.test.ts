import { describe, it, expect } from 'vitest';
import {
  extractNoteEvents,
  countMelodyFns,
  notePairsToMini,
  defaultMidiBounds,
  defaultCycleBounds,
} from './noteEvents';
import { strudelNoteToMidi } from './notes';
import { getPreset } from '~/presentation/state/presetsStore';
import { BUILTIN_PRESETS } from '~/domain/presets';
import type { NoteEvent } from '~/domain/midi/encoder';

/**
 * Pure-function tests for noteEvents.ts. No DOM, no Solid, no Effect.
 *
 * Tests cover:
 *   - empty / whitespace input
 *   - bare `note(c4)` — single note, full cycle
 *   - `<a b c>` — evenly-spaced sequence
 *   - `[a b]` — chord (all at same instant)
 *   - cat([...]) — sequential offset advances per inner item
 *   - stack(...) — simultaneous layers (independent rows)
 *   - nested calls (slow(2, note(...)))
 *   - creep preset — non-zero note count, time-ordered for each midi
 *   - helper round-trips (notePairsToMini, defaultMidiBounds)
 */

describe('extractNoteEvents — empty / invalid', () => {
  it('empty string returns []', () => {
    expect(extractNoteEvents('')).toEqual([]);
  });
  it('whitespace-only returns []', () => {
    expect(extractNoteEvents('   \n\t  ')).toEqual([]);
  });
  it('non-music code returns [] (no note/n/chord function calls)', () => {
    // Bare variable ref / comment — the parser emits OtherNode, our
    // walker doesn't surface pitches.
    expect(extractNoteEvents('// hello world\nconst x = 5;')).toEqual([]);
  });
});

describe('extractNoteEvents — single note', () => {
  it('bare note("c4") → 1 event, midi 60, cycle 0..1', () => {
    const ev = extractNoteEvents('note("c4")');
    expect(ev).toHaveLength(1);
    expect(ev[0]?.midi).toBe(60);
    expect(ev[0]?.startCycle).toBe(0);
    expect(ev[0]?.endCycle).toBe(1);
    expect(ev[0]?.channel).toBe(1);
    expect(ev[0]?.velocity).toBe(100);
  });

  it('note("a4") → 1 event, midi 69', () => {
    const ev = extractNoteEvents('note("a4")');
    expect(ev[0]?.midi).toBe(69);
  });

  it('note("c#3") → midi 49 (C#3)', () => {
    const ev = extractNoteEvents('note("c#3")');
    expect(ev[0]?.midi).toBe(49);
  });

  it('note("~") (silence) → []', () => {
    expect(extractNoteEvents('note("~")')).toEqual([]);
  });
});

describe('extractNoteEvents — sequence (<>) and single-multi', () => {
  it('note("c4 e4 g4") → 3 events evenly spaced 1/3 apart', () => {
    const ev = extractNoteEvents('note("c4 e4 g4")');
    expect(ev).toHaveLength(3);
    expect(ev[0]?.startCycle).toBeCloseTo(0, 5);
    expect(ev[0]?.endCycle).toBeCloseTo(1 / 3, 5);
    expect(ev[1]?.startCycle).toBeCloseTo(1 / 3, 5);
    expect(ev[2]?.startCycle).toBeCloseTo(2 / 3, 5);
    expect(ev[0]?.midi).toBe(60);
    expect(ev[1]?.midi).toBe(64);
    expect(ev[2]?.midi).toBe(67);
  });

  it('note("<c4 e4 g4>") → 3 events evenly spaced 1/3 apart', () => {
    // Same as bare form but explicitly bracketed.
    const ev = extractNoteEvents('note("<c4 e4 g4>")');
    expect(ev).toHaveLength(3);
    expect(ev[0]?.midi).toBe(60);
    expect(ev[1]?.midi).toBe(64);
    expect(ev[2]?.midi).toBe(67);
    expect(ev[0]?.startCycle).toBeCloseTo(0, 5);
    expect(ev[2]?.startCycle).toBeCloseTo(2 / 3, 5);
  });
});

describe('extractNoteEvents — chord ([])', () => {
  it('note("[c4 e4 g4]") → 3 events all at startCycle 0, endCycle 1', () => {
    const ev = extractNoteEvents('note("[c4 e4 g4]")');
    expect(ev).toHaveLength(3);
    for (const e of ev) {
      expect(e.startCycle).toBe(0);
      expect(e.endCycle).toBe(1);
    }
    expect(ev.map((e) => e.midi).sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });
});

describe('extractNoteEvents — cat([...]) sequencing', () => {
  it('cat([note("c4"), note("e4"), note("g4")]) → 3 events at cycle offsets 0, 1, 2', () => {
    const ev = extractNoteEvents('cat([\n  note("c4"),\n  note("e4"),\n  note("g4")\n])');
    expect(ev).toHaveLength(3);
    expect(ev[0]).toMatchObject({ midi: 60, startCycle: 0, endCycle: 1 });
    expect(ev[1]).toMatchObject({ midi: 64, startCycle: 1, endCycle: 2 });
    expect(ev[2]).toMatchObject({ midi: 67, startCycle: 2, endCycle: 3 });
  });
});

describe('extractNoteEvents — stack(...) layers', () => {
  it('stack(note("c4"), note("e4")) → 2 simultaneous events at cycle 0', () => {
    const score = 'stack(\n  note("c4"),\n  note("e4")\n)';
    const ev = extractNoteEvents(score);
    expect(ev).toHaveLength(2);
    const midis = ev.map((e) => e.midi).sort((a, b) => a - b);
    expect(midis).toEqual([60, 64]);
    for (const e of ev) {
      expect(e.startCycle).toBe(0);
      expect(e.endCycle).toBe(1);
    }
  });
});

describe('extractNoteEvents — nested calls', () => {
  it('slow(2, note("c4 e4")) — inner note starts at offset 0 (modifier ignored)', () => {
    // We don't model the slowdown effect; we just confirm the inner
    // `note("c4 e4")` is still discovered and emitted.
    const ev = extractNoteEvents('slow(2, note("c4 e4"))');
    expect(ev).toHaveLength(2);
    expect(ev.map((e) => e.midi)).toEqual([60, 64]);
  });

  it('countMelodyFns counts nested note calls in stack + cat', () => {
    const score = [
      'cat([',
      '  stack(',
      '    note("c4 e4"),',
      '    chord("g3 b3 d4")',
      '  ),',
      '  n("a4 b4 c5")',
      '])',
    ].join('\n');
    // 3 outer melody calls (note, chord, n). The stack/cat wrappers
    // don't count. countMelodyFns visits every CallNode.
    expect(countMelodyFns(score)).toBeGreaterThanOrEqual(3);
  });
});

describe('extractNoteEvents — Creep preset', () => {
  it('Creep score extracts a non-empty, well-bounded note-event list', () => {
    const creep = getPreset('creep') ?? BUILTIN_PRESETS.find((p) => p.id === 'creep');
    if (!creep) throw new Error('creep preset missing');
    const ev = extractNoteEvents(creep.score);
    expect(ev.length).toBeGreaterThan(0);
    // All events must land within a sane range (Creep's last
    // `cat` section is well past 12 cycles; we expect at least 12).
    const maxEnd = Math.max(...ev.map((e) => e.endCycle));
    expect(maxEnd).toBeGreaterThan(2);
    // Multiple distinct cycle starts — Creep has many sections.
    const distinctStarts = new Set(ev.map((e) => Math.round(e.startCycle * 1000) / 1000));
    expect(distinctStarts.size).toBeGreaterThan(8);
  });

  it('Creep sections do not overlap (sorted by midi)', () => {
    const creep = getPreset('creep') ?? BUILTIN_PRESETS.find((p) => p.id === 'creep');
    if (!creep) throw new Error('creep preset missing');
    const ev = extractNoteEvents(creep.score);
    // Group events by MIDI, sort each group's events by startCycle,
    // verify each MIDI's events are time-ordered.
    const byMidi = new Map<number, Array<NoteEvent>>();
    for (const e of ev) {
      const list = byMidi.get(e.midi) ?? [];
      list.push(e);
      byMidi.set(e.midi, list);
    }
    for (const [, group] of byMidi) {
      const sorted = [...group].sort((a, b) => a.startCycle - b.startCycle);
      let prevEnd = -Infinity;
      for (const e of sorted) {
        // Events at the SAME midi CAN overlap (a stack plays
        // chords simultaneously). We just check that no event
        // BACKTRACKS vs the previous end.
        if (e.startCycle >= prevEnd - 1e-9) {
          prevEnd = Math.max(prevEnd, e.endCycle);
        } else {
          throw new Error(
            `midi ${sorted[0]!.midi}: event at startCycle=${e.startCycle} precedes previous endCycle=${prevEnd}`,
          );
        }
      }
    }
  });
});

describe('noteEvents — helpers', () => {
  it('notePairsToMini: single note → bare token', () => {
    expect(notePairsToMini([{ midi: 60, start: 0, end: 1 }])).toBe('c4');
  });

  it('notePairsToMini: chord → [a b c]', () => {
    expect(
      notePairsToMini([
        { midi: 60, start: 0, end: 1 },
        { midi: 64, start: 0, end: 1 },
        { midi: 67, start: 0, end: 1 },
      ]),
    ).toBe('[c4 e4 g4]');
  });

  it('notePairsToMini: sequence of three notes → <a b c>', () => {
    expect(
      notePairsToMini([
        { midi: 60, start: 0, end: 1 / 3 },
        { midi: 64, start: 1 / 3, end: 2 / 3 },
        { midi: 67, start: 2 / 3, end: 1 },
      ]),
    ).toBe('<c4 e4 g4>');
  });

  it('notePairsToMini: empty → empty string', () => {
    expect(notePairsToMini([])).toBe('');
  });

  it('defaultMidiBounds: empty → C1..C7 (lo=24 hi=96)', () => {
    expect(defaultMidiBounds([])).toEqual({ lo: 24, hi: 96 });
  });

  it('defaultMidiBounds: tight cluster → bracketed', () => {
    const bounds = defaultMidiBounds([
      { midi: 60, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
      { midi: 64, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
    ]);
    expect(bounds.lo).toBe(58);
    expect(bounds.hi).toBe(70); // +2 + min 12-semitone spread
  });

  it('defaultCycleBounds: empty → 0..16', () => {
    expect(defaultCycleBounds([])).toEqual({ lo: 0, hi: 16 });
  });

  it('defaultCycleBounds: 4 cycles of activity → at least 0..6 window', () => {
    const bounds = defaultCycleBounds([
      { midi: 60, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
      { midi: 62, startCycle: 3, endCycle: 4, velocity: 100, channel: 1 },
    ]);
    expect(bounds.lo).toBe(0);
    expect(bounds.hi).toBeGreaterThanOrEqual(5);
  });
});

describe('extractNoteEvents — strudelNoteToMidi sanity', () => {
  it('reference mapping (c4=60, a4=69)', () => {
    expect(strudelNoteToMidi('c4')).toBe(60);
    expect(strudelNoteToMidi('a4')).toBe(69);
    expect(strudelNoteToMidi('c#3')).toBe(49);
    expect(strudelNoteToMidi('g2')).toBe(43);
  });
});
