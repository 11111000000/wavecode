import { describe, it, expect, beforeEach } from 'vitest';

/**
 * The pianoRecStore holds module-level Solid signals. Each test
 * resets them by directly mutating state (no `vi.resetModules()` so
 * we can verify the public surface stays coherent across the full
 * suite). If a future test needs module isolation, switch to
 * dynamic `import()` + `vi.resetModules()` like transportState.
 */

const importStore = async () => await import('./pianoRecStore');

beforeEach(async () => {
  const s = await importStore();
  s.setInstrument('triangle');
  s.clearRec();
  if (s.recEnabled()) s.toggleRec();
});

describe('pianoRecStore — recEnabled toggle', () => {
  it('toggleRec flips recEnabled', async () => {
    const s = await importStore();
    expect(s.recEnabled()).toBe(false);
    s.toggleRec();
    expect(s.recEnabled()).toBe(true);
    s.toggleRec();
    expect(s.recEnabled()).toBe(false);
  });

  it('default instrument is triangle (matches PianoSynth default)', async () => {
    const s = await importStore();
    expect(s.instrument()).toBe('triangle');
  });
});

describe('pianoRecStore — appendNote / buffer', () => {
  it('appendNote adds entries preserving order', async () => {
    const s = await importStore();
    s.appendNote(60, 1000, 1100);
    s.appendNote(64, 1200, 1300);
    s.appendNote(67, 1400, 1500);
    expect(s.recBuffer()).toEqual([
      { midi: 60, startMs: 1000, endMs: 1100 },
      { midi: 64, startMs: 1200, endMs: 1300 },
      { midi: 67, startMs: 1400, endMs: 1500 },
    ]);
  });

  it('updateLastNoteEnd patches the endMs of the most recent entry', async () => {
    const s = await importStore();
    s.appendNote(60, 1000, 1000);
    s.appendNote(64, 1100, 1100);
    s.updateLastNoteEnd(2500);
    expect(s.recBuffer()[1]).toEqual({ midi: 64, startMs: 1100, endMs: 2500 });
    expect(s.recBuffer()[0]).toEqual({ midi: 60, startMs: 1000, endMs: 1000 });
  });

  it('updateLastNoteEnd on empty buffer is a safe no-op', async () => {
    const s = await importStore();
    expect(() => s.updateLastNoteEnd(1234)).not.toThrow();
    expect(s.recBuffer()).toEqual([]);
  });
});

describe('pianoRecStore — flushRec', () => {
  it('flushRec returns the buffer and clears it', async () => {
    const s = await importStore();
    s.appendNote(60, 100, 200);
    s.appendNote(64, 300, 400);
    const flushed = s.flushRec();
    expect(flushed).toHaveLength(2);
    expect(flushed[0]?.midi).toBe(60);
    expect(s.recBuffer()).toEqual([]);
  });

  it('flushRec on empty buffer returns empty array, not null/undefined', async () => {
    const s = await importStore();
    expect(s.flushRec()).toEqual([]);
  });

  it('appendNote after flushRec starts a fresh session', async () => {
    const s = await importStore();
    s.appendNote(60, 0, 100);
    s.flushRec();
    s.appendNote(67, 200, 300);
    expect(s.recBuffer()).toEqual([{ midi: 67, startMs: 200, endMs: 300 }]);
  });
});

describe('pianoRecStore — instrument setter', () => {
  it('setInstrument changes the signal and preserves buffer contents', async () => {
    const s = await importStore();
    s.appendNote(60, 0, 100);
    s.setInstrument('sine');
    expect(s.instrument()).toBe('sine');
    // Buffer is NOT cleared by instrument changes — separate concern.
    expect(s.recBuffer()).toEqual([{ midi: 60, startMs: 0, endMs: 100 }]);
    s.setInstrument('sawtooth');
    expect(s.instrument()).toBe('sawtooth');
  });

  it('setInstrument accepts all four pianoInstrument values', async () => {
    const s = await importStore();
    for (const inst of ['triangle', 'sine', 'sawtooth', 'square'] as const) {
      s.setInstrument(inst);
      expect(s.instrument()).toBe(inst);
    }
  });
});

describe('pianoRecStore — recentNotes', () => {
  it('returns the last N notes in order', async () => {
    const s = await importStore();
    for (const m of [60, 62, 64, 65, 67]) s.appendNote(m, 0, 0);
    const last3 = s.recentNotes(3);
    expect(last3.map((n) => n.midi)).toEqual([64, 65, 67]);
  });

  it('returns all notes when N exceeds buffer size', async () => {
    const s = await importStore();
    s.appendNote(60, 0, 0);
    s.appendNote(64, 0, 0);
    expect(s.recentNotes(10).map((n) => n.midi)).toEqual([60, 64]);
  });

  it('returns empty array for N <= 0 or empty buffer', async () => {
    const s = await importStore();
    expect(s.recentNotes(0)).toEqual([]);
    expect(s.recentNotes(-5)).toEqual([]);
    s.appendNote(60, 0, 0);
    expect(s.recentNotes(0)).toEqual([]);
  });

  it('does not mutate the underlying buffer', async () => {
    const s = await importStore();
    for (const m of [60, 62, 64]) s.appendNote(m, 0, 0);
    const before = s.recBuffer();
    s.recentNotes(2);
    expect(s.recBuffer()).toBe(before);
  });
});

describe('pianoRecStore — clearRec', () => {
  it('clears the buffer without returning it', async () => {
    const s = await importStore();
    s.appendNote(60, 0, 0);
    s.clearRec();
    expect(s.recBuffer()).toEqual([]);
  });
});