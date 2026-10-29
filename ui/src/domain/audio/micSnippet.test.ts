/**
 * Unit tests for `micSnippetFromBuffers` — the single source of truth
 * for turning mic notes + transients into a Strudel snippet.
 *
 * These pin the contract that preview === apply: whatever this
 * function returns is what `micStore.applyToScore` commits AND what
 * the MicPanel preview button plays.
 */

import { describe, it, expect } from 'vitest';
import { micSnippetFromBuffers } from './micSnippet';
import type { AudioNote } from './micCapture';
import type { Transient } from './transient';

const note = (midi: number, startMs: number, durationMs: number): AudioNote => ({
  midi,
  cents: 0,
  startMs,
  durationMs,
  vibratoCents: 0,
});

const kick = (startMs: number): Transient => ({
  type: 'kick',
  startMs,
  amplitude: 0.8,
  spectralCentroidHz: 100,
  envelopeMs: 80,
});

describe('micSnippetFromBuffers — empty buffers', () => {
  it('returns null when both buffers are empty', () => {
    expect(micSnippetFromBuffers([], [])).toBeNull();
  });
});

describe('micSnippetFromBuffers — notes only', () => {
  it('emits a bare note(...) snippet with the default piano instrument', () => {
    const out = micSnippetFromBuffers([note(60, 0, 200)], []);
    expect(out).toMatch(/^note\(/);
    expect(out).toContain('c4');
    expect(out).toContain('s("piano")');
  });

  it('passes the instrument through', () => {
    const out = micSnippetFromBuffers([note(60, 0, 0)], [], { instrument: 'triangle' });
    expect(out).toContain('s("triangle")');
  });

  it('uses duration info (@seconds) when notes carry durationMs', () => {
    const out = micSnippetFromBuffers([note(60, 0, 400)], []);
    expect(out).toContain('c4@0.4');
  });
});

describe('micSnippetFromBuffers — transients only', () => {
  it('emits a bare s(...) snippet', () => {
    const out = micSnippetFromBuffers([], [kick(0), kick(500)]);
    expect(out).toMatch(/^s\(/);
    expect(out).toContain('drums_bd');
  });
});

describe('micSnippetFromBuffers — both buffers', () => {
  it('stacks note + transient snippets under a stack(...)', () => {
    const out = micSnippetFromBuffers(
      [note(60, 0, 200)],
      [kick(200)],
      { instrument: 'piano' },
    );
    expect(out).toMatch(/^stack\(\n/);
    expect(out).toContain('note(');
    expect(out).toContain('s("drums_bd');
    expect(out).toContain(')\n)');
  });
});

describe('micSnippetFromBuffers — notesOptions pass-through', () => {
  it('forwards tempoQuantize to notesToSnippet', () => {
    const notes = [note(60, 0, 400), note(64, 500, 400)];
    const out = micSnippetFromBuffers(notes, [], {
      instrument: 'piano',
      notesOptions: { tempoQuantize: true },
    });
    expect(out).toMatch(/^setCpm\(/);
    expect(out).toContain('c4');
    expect(out).toContain('e4');
  });
});
