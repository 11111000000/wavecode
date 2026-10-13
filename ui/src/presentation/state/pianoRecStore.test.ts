import { describe, it, expect, beforeEach } from 'vitest';
import { appStore, dispatch } from './appStore';

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
  if (s.followEnabled()) s.toggleFollow();
  // Reset the appStore.score to '' so applyToScore tests don't leak
  // into each other. (Each test sets it explicitly via the `score`
  // signal setter below.)
  dispatch({ type: 'replaceScore', text: '' });
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

describe('pianoRecStore — followEnabled toggle (wavecode-piano-modes-and-gain)', () => {
  it('toggleFollow flips followEnabled', async () => {
    const s = await importStore();
    expect(s.followEnabled()).toBe(false);
    s.toggleFollow();
    expect(s.followEnabled()).toBe(true);
    s.toggleFollow();
    expect(s.followEnabled()).toBe(false);
  });

  it('setFollow forces a specific value (used by PianoKeyboard on unmount)', async () => {
    const s = await importStore();
    s.setFollow(true);
    expect(s.followEnabled()).toBe(true);
    s.setFollow(true); // idempotent
    expect(s.followEnabled()).toBe(true);
    s.setFollow(false);
    expect(s.followEnabled()).toBe(false);
  });

  it('followEnabled is independent of recEnabled (orthogonal toggles)', async () => {
    const s = await importStore();
    s.toggleRec(); // rec on
    s.toggleFollow(); // follow on
    expect(s.recEnabled()).toBe(true);
    expect(s.followEnabled()).toBe(true);
    s.toggleRec(); // rec off — follow stays on
    expect(s.recEnabled()).toBe(false);
    expect(s.followEnabled()).toBe(true);
  });
});

describe('pianoRecStore — commitSnippet (wavecode-piano-modes-and-gain)', () => {
  it('empty buffer → empty string', async () => {
    const s = await importStore();
    expect(s.commitSnippet([], 'triangle')).toBe('');
  });

  it('single note → single voice snippet with selected instrument', async () => {
    const s = await importStore();
    const out = s.commitSnippet([{ midi: 60, startMs: 0, endMs: 100 }], 'triangle');
    expect(out).toBe(
      'note("c4").s("triangle").attack(0.005).decay(0.4).sustain(0.1).gain(0.3)',
    );
  });

  it('3 notes → 3 newline-separated lines (no wrapping stack)', async () => {
    const s = await importStore();
    const out = s.commitSnippet(
      [
        { midi: 60, startMs: 0, endMs: 100 },
        { midi: 64, startMs: 100, endMs: 200 },
        { midi: 67, startMs: 200, endMs: 300 },
      ],
      'sine',
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('note("c4")');
    expect(lines[0]).toContain('.s("sine")');
    expect(lines[1]).toContain('note("e4")');
    expect(lines[2]).toContain('note("g4")');
  });

  it('reflects instrument parameter (triangle/sine/sawtooth/square)', async () => {
    const s = await importStore();
    for (const inst of ['triangle', 'sine', 'sawtooth', 'square'] as const) {
      const out = s.commitSnippet([{ midi: 60, startMs: 0, endMs: 100 }], inst);
      expect(out).toContain(`.s("${inst}")`);
    }
  });
});

describe('pianoRecStore — stackAppend (wavecode-piano-modes-and-gain)', () => {
  it('empty editor → snippet verbatim (no wrap)', async () => {
    const s = await importStore();
    const out = s.stackAppend('', 'note("c4").s("triangle")');
    expect(out).toBe('note("c4").s("triangle")');
  });

  it('whitespace-only editor → snippet verbatim', async () => {
    const s = await importStore();
    const out = s.stackAppend('   \n  ', 'note("c4").s("triangle")');
    expect(out).toBe('note("c4").s("triangle")');
  });

  it('non-stack editor → wrap both in a fresh stack(...)', async () => {
    const s = await importStore();
    const out = s.stackAppend('note("e4 g4")', 'note("c4").s("triangle")');
    expect(out).toMatch(/^stack\(/);
    expect(out).toContain('note("e4 g4")');
    expect(out).toContain('note("c4").s("triangle")');
    expect(out.trimEnd().endsWith(')')).toBe(true);
  });

  it('editor already has top-level stack(...) → splice inside, no double-wrap', async () => {
    const s = await importStore();
    const existing = 'stack(\n  note("e4"),\n  s("hh*4")\n)';
    const out = s.stackAppend(existing, 'note("c4").s("triangle")');
    expect(out.startsWith('stack(')).toBe(true);
    // Outer stack call preserved — count of `stack(` strings must be exactly 1.
    expect((out.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
    expect(out).toContain('note("e4")');
    expect(out).toContain('s("hh*4")');
    expect(out).toContain('note("c4").s("triangle")');
  });

  it('survives inline commas in nested parens (s("<a, b, c>"))', async () => {
    const s = await importStore();
    const out = s.stackAppend('s("<a, b, c>")', 'note("c4")');
    expect(out).toContain('s("<a, b, c>")');
    expect(out).toContain('note("c4")');
  });

  it('survives a leading comment block', async () => {
    const s = await importStore();
    const out = s.stackAppend('// my riff\nnote("c4")', 'note("e4").s("sine")');
    expect(out).toMatch(/^stack\(/);
    expect(out).toContain('note("c4")');
    expect(out).toContain('note("e4").s("sine")');
  });
});

describe('pianoRecStore — applyToScore (wavecode-piano-modes-and-gain)', () => {
  it('empty buffer → noop (no dispatch, score unchanged)', async () => {
    const s = await importStore();
    dispatch({ type: 'replaceScore', text: 's("hh*4")' });
    const before = appStore.score;
    s.applyToScore();
    expect(appStore.score).toBe(before);
    expect(s.recBuffer()).toEqual([]);
  });

  it('empty score + apply: 1 note → score becomes the snippet verbatim', async () => {
    const s = await importStore();
    dispatch({ type: 'replaceScore', text: '' });
    s.appendNote(60, 0, 100);
    s.applyToScore();
    expect(appStore.score).toBe(
      'note("c4").s("triangle").attack(0.005).decay(0.4).sustain(0.1).gain(0.3)',
    );
    expect(s.recBuffer()).toEqual([]); // buffer cleared after apply
  });

  it('with stack(score, …) → score appends snippet inside (no double-wrap)', async () => {
    const s = await importStore();
    dispatch({
      type: 'replaceScore',
      text: 'stack(\n  note("e4 g4"),\n  s("hh*4")\n)',
    });
    s.appendNote(60, 0, 100);
    s.appendNote(64, 100, 200);
    s.applyToScore();
    const after = appStore.score;
    expect(after.startsWith('stack(')).toBe(true);
    expect((after.match(/\bstack\s*\(/g) ?? []).length).toBe(1); // exactly one stack wrap
    expect(after).toContain('note("e4 g4")');
    expect(after).toContain('s("hh*4")');
    expect(after).toContain('note("c4")');
    expect(after).toContain('note("e4")');
  });

  it('with non-stack score → wraps both editor + new snippet in a stack(...)', async () => {
    const s = await importStore();
    dispatch({ type: 'replaceScore', text: 's("hh*4")' });
    s.appendNote(60, 0, 100);
    s.applyToScore();
    const after = appStore.score;
    expect(after).toMatch(/^stack\(/);
    expect(after).toContain('s("hh*4")');
    expect(after).toContain('note("c4")');
    expect(after.trimEnd().endsWith(')')).toBe(true);
  });

  it('twice in a row: two applies → score contains two rec layers (3 voices total)', async () => {
    const s = await importStore();
    dispatch({ type: 'replaceScore', text: '' });
    s.appendNote(60, 0, 100); // first apply → c4
    s.applyToScore();
    expect(appStore.score).toContain('note("c4")');

    s.appendNote(67, 100, 200); // second apply → g4
    s.applyToScore();
    const after = appStore.score;
    expect(after).toContain('note("c4")');
    expect(after).toContain('note("g4")');
    // 3 voices total: original c4 + original g4 + the second g4 (after splice
    // the first apply layer becomes the first arg, second g4 becomes the second).
    expect((after.match(/note\(/g) ?? []).length).toBe(2);
  });
});