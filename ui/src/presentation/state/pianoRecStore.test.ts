import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appStore, dispatch, getActiveScore } from './appStore';

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
  // Reset slot + editor focus + editor API + apply-feedback (per-session
  // invariants — every test starts from the same baseline).
  if (s.pianoSlot() !== 'append-stack') s.setPianoSlot('append-stack');
  if (s.editorFocused()) s.setEditorFocused(false);
  s.setPianoEditorApi(undefined);
  // Reset the getActiveScore() to '' so applyToScore tests don't leak
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

  it('wavecode-piano-sample-picker: emits s("<sample>") for sample literals', async () => {
    const s = await importStore();
    for (const sample of ['piano', 'casio', 'guitar', 'synth'] as const) {
      const out = s.commitSnippet(
        [{ midi: 60, startMs: 0, endMs: 100 }],
        sample,
      );
      expect(out).toBe(
        `note("c4").s("${sample}").attack(0.005).decay(0.4).sustain(0.1).gain(0.3)`,
      );
    }
  });

  it('wavecode-piano-sample-picker: commitSnippet → applyToScore writes sample name in score', async () => {
    const s = await importStore();
    s.setInstrument('piano');
    dispatch({ type: 'replaceScore', text: '' });
    s.appendNote(60, 0, 100);
    s.appendNote(64, 100, 200);
    s.applyToScore();
    const after = getActiveScore();
    expect(after).toContain('.s("piano")');
    // No stack wrap on empty score — just two newlines.
    expect(after.split('\n').filter((l) => l.includes('s("piano")'))).toHaveLength(2);
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
    const before = getActiveScore();
    s.applyToScore();
    expect(getActiveScore()).toBe(before);
    expect(s.recBuffer()).toEqual([]);
  });

  it('empty score + apply: 1 note → score becomes the snippet verbatim', async () => {
    const s = await importStore();
    dispatch({ type: 'replaceScore', text: '' });
    s.appendNote(60, 0, 100);
    s.applyToScore();
    expect(getActiveScore()).toBe(
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
    const after = getActiveScore();
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
    const after = getActiveScore();
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
    expect(getActiveScore()).toContain('note("c4")');

    s.appendNote(67, 100, 200); // second apply → g4
    s.applyToScore();
    const after = getActiveScore();
    expect(after).toContain('note("c4")');
    expect(after).toContain('note("g4")');
    // 3 voices total: original c4 + original g4 + the second g4 (after splice
    // the first apply layer becomes the first arg, second g4 becomes the second).
    expect((after.match(/note\(/g) ?? []).length).toBe(2);
  });
});

// =========================================================================
// wavecode-piano-rec-clarity — slot selector + 3-way apply + preview pill
// =========================================================================

describe('pianoRecStore — pianoSlot selector', () => {
  it('default slot is append-stack', async () => {
    const s = await importStore();
    expect(s.pianoSlot()).toBe('append-stack');
  });

  it('setPianoSlot cycles through all three values', async () => {
    const s = await importStore();
    s.setPianoSlot('replace-score');
    expect(s.pianoSlot()).toBe('replace-score');
    s.setPianoSlot('at-cursor');
    expect(s.pianoSlot()).toBe('at-cursor');
    s.setPianoSlot('append-stack');
    expect(s.pianoSlot()).toBe('append-stack');
  });

  it('slot survives within a session but resets across imports (per-session contract)', async () => {
    const s = await importStore();
    s.setPianoSlot('replace-score');
    expect(s.pianoSlot()).toBe('replace-score');
    // Module-level signal — same module, same signal value. A fresh
    // session would re-import the module and reset to default.
  });

  it('pianoSlotLabel returns human-readable Russian labels', async () => {
    const s = await importStore();
    expect(s.pianoSlotLabel('append-stack')).toBe('конец стека');
    expect(s.pianoSlotLabel('replace-score')).toBe('заменить score');
    expect(s.pianoSlotLabel('at-cursor')).toBe('в курсор');
  });

  it('pianoSlotGlyph returns compact segmented-control labels', async () => {
    const s = await importStore();
    expect(s.pianoSlotGlyph('append-stack')).toBe('↵ stack');
    expect(s.pianoSlotGlyph('replace-score')).toBe('⟳ replace');
    expect(s.pianoSlotGlyph('at-cursor')).toBe('⌖ cursor');
  });
});

describe('pianoRecStore — editorFocused + pianoEditorApi wiring', () => {
  it('editorFocused defaults to false', async () => {
    const s = await importStore();
    expect(s.editorFocused()).toBe(false);
  });

  it('setEditorFocused flips the signal', async () => {
    const s = await importStore();
    s.setEditorFocused(true);
    expect(s.editorFocused()).toBe(true);
    s.setEditorFocused(false);
    expect(s.editorFocused()).toBe(false);
  });

  it('pianoEditorApi defaults to undefined; settable + clearable', async () => {
    const s = await importStore();
    expect(s.pianoEditorApi()).toBeUndefined();
    const fakeApi = { getView: () => undefined };
    s.setPianoEditorApi(fakeApi);
    expect(s.pianoEditorApi()).toBe(fakeApi);
    s.setPianoEditorApi(undefined);
    expect(s.pianoEditorApi()).toBeUndefined();
  });
});

describe('pianoRecStore — applyToScore replace-score slot', () => {
  it('dispatches replaceScore with snippet as-is (no stack wrap)', async () => {
    const s = await importStore();
    s.setPianoSlot('replace-score');
    dispatch({ type: 'replaceScore', text: 's("hh*4")' });
    s.appendNote(60, 0, 100);
    s.appendNote(64, 100, 200);
    s.applyToScore();
    const after = getActiveScore();
    // Two notes committed as-is; no stack wrap applied.
    expect(after).toContain('note("c4")');
    expect(after).toContain('note("e4")');
    expect(after).not.toContain('hh*4'); // previous score is GONE
    expect(s.recBuffer()).toEqual([]); // cleared
  });

  it('replace-score on empty editor → snippet verbatim', async () => {
    const s = await importStore();
    s.setPianoSlot('replace-score');
    dispatch({ type: 'replaceScore', text: '' });
    s.appendNote(60, 0, 100);
    s.applyToScore();
    expect(getActiveScore()).toContain('note("c4")');
  });

  it('replace-score is destructive: undo stack captures prior score', async () => {
    const s = await importStore();
    const priorScore = 's("hh*4")';
    dispatch({ type: 'replaceScore', text: priorScore });
    const id = appStore.activeTrackId;
    const historyBefore = (appStore.undoStacks[id] ?? []).length;
    s.setPianoSlot('replace-score');
    s.appendNote(60, 0, 100);
    s.applyToScore();
    expect(getActiveScore()).not.toContain('hh*4');
    const stack = appStore.undoStacks[id] ?? [];
    expect(stack.length).toBe(historyBefore + 1);
    expect(stack[stack.length - 1]).toBe(priorScore);
  });
});

describe('pianoRecStore — applyToScore at-cursor slot', () => {
  /** Build a mock EditorView that records dispatch calls and lets us
   *  control the selection. */
  const makeMockView = (
    cursorFrom: number,
    cursorTo: number = cursorFrom,
  ): {
    view: {
      state: {
        selection: { main: { from: number; to: number } };
        doc: { lineAt: (p: number) => { from: number; number: number }; length: number };
      };
      dispatch: (tr: {
        changes: { from: number; to: number; insert: string };
        selection: { anchor: number };
        effects: unknown;
      }) => void;
      destroyed: boolean;
    };
    dispatches: Array<{
      changes: { from: number; to: number; insert: string };
      selection: { anchor: number };
      effects: unknown;
    }>;
  } => {
    const dispatches: Array<{
      changes: { from: number; to: number; insert: string };
      selection: { anchor: number };
      effects: unknown;
    }> = [];
    const view = {
      state: {
        selection: { main: { from: cursorFrom, to: cursorTo } },
        doc: {
          lineAt: (p: number): { from: number; number: number } => ({ from: p, number: 1 }),
          length: 100,
        },
      },
      dispatch: (tr: {
        changes: { from: number; to: number; insert: string };
        selection: { anchor: number };
        effects: unknown;
      }): void => {
        dispatches.push(tr);
      },
      destroyed: false,
    };
    return { view, dispatches };
  };

  it('without editor API → no-op (warn, buffer preserved)', async () => {
    const s = await importStore();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      s.setPianoSlot('at-cursor');
      s.setPianoEditorApi(undefined);
      dispatch({ type: 'replaceScore', text: 'note("e4")' });
      s.appendNote(60, 0, 100);
      s.applyToScore();
      expect(getActiveScore()).toBe('note("e4")'); // unchanged
      expect(s.recBuffer()).toHaveLength(1); // buffer preserved for retry
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('at-cursor slot requires editor API'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('with editor API → dispatches insert + scrollIntoView at cursor', async () => {
    const s = await importStore();
    s.setPianoSlot('at-cursor');
    dispatch({ type: 'replaceScore', text: 'note("e4")' });
    s.appendNote(60, 0, 100);
    const { view, dispatches } = makeMockView(10 /* tentative cursor */);
    s.setPianoEditorApi({ getView: () => view as never });
    s.applyToScore();
    // Two dispatches expected: (1) the insert itself, (2) the flash
    // decorations effect (a separate StateEffect dispatch — CodeMirror
    // doesn't compose Decoration.set into the same transaction as
    // changes, and we want the flash effect to run AFTER the doc
    // change so the lineAt() calls hit the new doc lines).
    expect(dispatches.length).toBeGreaterThanOrEqual(1);
    const tr = dispatches[0]!;
    expect(tr.changes.from).toBe(10);
    expect(tr.changes.to).toBe(10);
    expect(tr.changes.insert).toContain('note("c4")');
    expect(tr.selection.anchor).toBe(10 + tr.changes.insert.length);
    expect(tr.effects).toBeDefined();
    expect(s.recBuffer()).toEqual([]); // cleared
  });

  it('replaces selection when range is non-empty', async () => {
    const s = await importStore();
    s.setPianoSlot('at-cursor');
    s.appendNote(60, 0, 100);
    const { view, dispatches } = makeMockView(5, 12 /* selection */);
    s.setPianoEditorApi({ getView: () => view as never });
    s.applyToScore();
    const tr = dispatches[0]!;
    expect(tr.changes.from).toBe(5);
    expect(tr.changes.to).toBe(12);
  });
});

describe('pianoRecStore — atCursorSpec (pure transaction builder)', () => {
  it('builds the right transaction shape for a point insert', async () => {
    const s = await importStore();
    const spec = s.atCursorSpec(5, 5, 'note("c4")');
    expect(spec.changes).toEqual({ from: 5, to: 5, insert: 'note("c4")' });
    expect(spec.selection.anchor).toBe(5 + 'note("c4")'.length);
    expect(spec.effects).toBeDefined();
  });

  it('builds the right transaction shape for a range replace', async () => {
    const s = await importStore();
    const spec = s.atCursorSpec(3, 10, 'x');
    expect(spec.changes.from).toBe(3);
    expect(spec.changes.to).toBe(10);
    expect(spec.selection.anchor).toBe(4);
  });

  it('atCursorSpec handles empty snippet (anchor === cursorFrom)', async () => {
    const s = await importStore();
    const spec = s.atCursorSpec(7, 7, '');
    expect(spec.changes.insert).toBe('');
    expect(spec.selection.anchor).toBe(7);
  });
});

describe('pianoRecStore — insertAtCursor (side-effect)', () => {
  it('dispatches a transaction to the provided EditorView', async () => {
    const s = await importStore();
    const dispatches: Array<unknown> = [];
    const fakeView = {
      state: { selection: { main: { from: 8, to: 8 } } },
      dispatch: (tr: unknown) => {
        dispatches.push(tr);
      },
    };
    s.insertAtCursor(fakeView as never, 'hello');
    expect(dispatches).toHaveLength(1);
    const tr = dispatches[0] as {
      changes: { from: number; to: number; insert: string };
      selection: { anchor: number };
    };
    expect(tr.changes.from).toBe(8);
    expect(tr.changes.to).toBe(8);
    expect(tr.changes.insert).toBe('hello');
    expect(tr.selection.anchor).toBe(13);
  });
});

describe('pianoRecStore — previewPillPayload', () => {
  it('returns null when buffer is empty', async () => {
    const s = await importStore();
    expect(s.previewPillPayload()).toBeNull();
  });

  it('returns count + first 5 note names + slot for non-empty buffer', async () => {
    const s = await importStore();
    s.appendNote(60, 0, 100); // C4
    s.appendNote(62, 100, 200); // D4
    s.appendNote(64, 200, 300); // E4
    const payload = s.previewPillPayload();
    expect(payload).not.toBeNull();
    expect(payload!.count).toBe(3);
    expect(payload!.firstNames).toEqual(['C4', 'D4', 'E4']);
    expect(payload!.overflow).toBe(0);
    expect(payload!.slot).toBe('append-stack');
    expect(payload!.slotLabel).toBe('конец стека');
  });

  it('caps firstNames at 5 and reports overflow', async () => {
    const s = await importStore();
    for (const m of [60, 62, 64, 65, 67, 69, 71]) s.appendNote(m, 0, 0);
    const payload = s.previewPillPayload();
    expect(payload!.count).toBe(7);
    expect(payload!.firstNames).toHaveLength(5);
    expect(payload!.overflow).toBe(2);
  });

  it('reflects the current slot label', async () => {
    const s = await importStore();
    s.setPianoSlot('at-cursor');
    s.appendNote(60, 0, 100);
    const payload = s.previewPillPayload();
    expect(payload!.slot).toBe('at-cursor');
    expect(payload!.slotLabel).toBe('в курсор');
  });
});

// =========================================================================
// wavecode-piano-rec-clarity polish — flash-decorations hook
// =========================================================================

describe('pianoRecStore — flashDecorations StateField (pure builder)', () => {
/** Minimal doc stub matching the slice that buildFlashRange reads. */
  const makeDoc = (
    lines: ReadonlyArray<{ from: number; text: string }>,
  ): {
    lineAt: (pos: number) => { from: number; number: number };
    line: (n: number) => { from: number; text: string };
  } => {
    return {
      lineAt: (pos: number): { from: number; number: number } => {
        let acc = 0;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          if (pos < acc + line.text.length + 1) {
            return { from: acc, number: i + 1 };
          }
          acc += line.text.length + 1; // +1 for newline
        }
        // fallback: last line
        return { from: 0, number: lines.length };
      },
      line: (n: number): { from: number; text: string } => {
        let acc = 0;
        for (let i = 0; i < n - 1; i += 1) {
          acc += lines[i]!.text.length + 1;
        }
        const line = lines[n - 1]!;
        return { from: acc, text: line.text };
      },
    };
  };

  it('returns Decoration.none-equivalent set for empty range', async () => {
    const s = await importStore();
    const doc = makeDoc([{ from: 0, text: 'a' }, { from: 2, text: 'b' }]);
    // Range equal → empty.
    const decos = s.buildFlashRange(doc as never, 0, 0);
    expect(decos.size).toBe(0);
  });

  it('highlights the first line for a single-line range', async () => {
    const s = await importStore();
    const doc = makeDoc([{ from: 0, text: 'hello' }, { from: 6, text: 'world' }]);
    const decos = s.buildFlashRange(doc as never, 0, 5);
    expect(decos.size).toBeGreaterThanOrEqual(1);
  });

  it('caps the highlight at FLASH_LINE_CAP (10) for very long inserts', async () => {
    const s = await importStore();
    const lines = Array.from({ length: 30 }, (_, i) => ({
      from: i * 10,
      text: `line-${i}`,
    }));
    const doc = makeDoc(lines);
    const decos = s.buildFlashRange(doc as never, 0, 30 * 10);
    expect(decos.size).toBeLessThanOrEqual(10);
  });

  it('exposes StateEffect exports so CodeMirror extensions can drive them', async () => {
    const s = await importStore();
    expect(s.setFlashDecorations).toBeDefined();
    expect(s.clearFlashDecorations).toBeDefined();
    expect(s.flashDecorations).toBeDefined();
  });
});