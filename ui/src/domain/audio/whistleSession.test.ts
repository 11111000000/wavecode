import { describe, it, expect } from 'vitest';
import {
  initialWhistleSession,
  notesToSnippetPreview,
  whistleSessionReducer,
  type WhistleSessionState,
} from '~/domain/audio/whistleSession';
import {
  initialMicState,
  type MicState,
  type PitchFrame,
} from '~/domain/audio/micCapture';

/**
 * Unit tests for the whistle session FSM. The reducer is pure: we
 * drive it through synthetic transitions and verify state shape.
 *
 * Synthetic frames carry `clarity` 0.95 and `rms` 0.1 so they pass
 * `DEFAULT_TUNE.silenceGate` (= 0.012) and `clarityGate` (= 0.85),
 * which is the same pattern as `micCapture.test.ts`.
 */

const pitched = (hz: number, t: number): PitchFrame => ({
  hz,
  clarity: 0.95,
  rms: 0.1,
  timestampMs: t,
});

const silent = (t: number): PitchFrame => ({
  hz: null,
  clarity: 0,
  rms: 0.001,
  timestampMs: t,
});

describe('whistleSessionReducer', () => {
  it('arm from idle moves to arming', () => {
    const s0 = initialWhistleSession();
    const s1 = whistleSessionReducer(s0, { type: 'arm' });
    expect(s1.tag).toBe('arming');
  });

  it('mic-ready from arming starts recording with a fresh MicState', () => {
    const s0: WhistleSessionState = { tag: 'arming' };
    const s1 = whistleSessionReducer(s0, { type: 'mic-ready' });
    expect(s1.tag).toBe('recording');
    if (s1.tag !== 'recording') throw new Error('not recording');
    // MicState is initialMicState() — openNote null, notes empty.
    expect(s1.micState.openNote).toBeNull();
    expect(s1.micState.notes).toEqual([]);
  });

  it('feed during recording updates the MicState (note opened on pitched frame)', () => {
    const s0: WhistleSessionState = {
      tag: 'recording',
      micState: initialMicState(),
      startedAtMs: 0,
      lastFrameMs: 0,
    };
    // Two pitched frames at A4: opens a note, then extends it
    // (still within noteVarianceCents).
    const s1 = whistleSessionReducer(s0, { type: 'feed', frame: pitched(440, 100) });
    if (s1.tag !== 'recording') throw new Error('not recording after feed');
    expect(s1.micState.openNote).not.toBeNull();
    expect(s1.micState.openNote?.midi).toBe(69);
    expect(s1.lastFrameMs).toBe(100);

    const s2 = whistleSessionReducer(s1, { type: 'feed', frame: pitched(440, 200) });
    if (s2.tag !== 'recording') throw new Error('not recording after second feed');
    // Still the same open note (extended, not a new one).
    expect(s2.micState.openNote).not.toBeNull();
    expect(s2.micState.openNote?.midi).toBe(69);
    expect(s2.micState.notes.length).toBe(0);
    expect(s2.lastFrameMs).toBe(200);
  });

  it('commit after a voiced-then-silent sequence produces segmenting with the closed note', () => {
    let s: WhistleSessionState = {
      tag: 'recording',
      micState: initialMicState(),
      startedAtMs: 0,
      lastFrameMs: 0,
    };
    s = whistleSessionReducer(s, { type: 'feed', frame: pitched(440, 100) });
    s = whistleSessionReducer(s, { type: 'feed', frame: pitched(440, 250) });
    s = whistleSessionReducer(s, { type: 'feed', frame: silent(400) });

    const committed = whistleSessionReducer(s, { type: 'commit' });
    expect(committed.tag).toBe('segmenting');
    if (committed.tag !== 'segmenting') throw new Error('not segmenting');
    // One closed note: A4 (MIDI 69) across roughly 150ms.
    expect(committed.notes.length).toBe(1);
    expect(committed.notes[0]?.midi).toBe(69);
  });

  it('applied from segmenting returns to idle', () => {
    const s0: WhistleSessionState = {
      tag: 'segmenting',
      notes: [{ midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 }],
    };
    const s1 = whistleSessionReducer(s0, { type: 'applied' });
    expect(s1.tag).toBe('idle');
  });

  it('cancel from any non-idle state returns to idle', () => {
    const cases: ReadonlyArray<WhistleSessionState> = [
      { tag: 'arming' },
      {
        tag: 'recording',
        micState: initialMicState() as MicState,
        startedAtMs: 0,
        lastFrameMs: 0,
      },
      { tag: 'segmenting', notes: [] },
    ];
    for (const start of cases) {
      const next = whistleSessionReducer(start, { type: 'cancel' });
      expect(next.tag).toBe('idle');
    }
  });

  it('error from any state lands in errored with the message preserved', () => {
    const s0 = whistleSessionReducer(initialWhistleSession(), { type: 'arm' });
    const s1 = whistleSessionReducer(s0, { type: 'error', message: 'mic permission denied' });
    expect(s1.tag).toBe('errored');
    if (s1.tag !== 'errored') throw new Error('not errored');
    expect(s1.error).toBe('mic permission denied');
  });

  it('events from a state that does not match the transition are dropped (no spurious state changes)', () => {
    const s0: WhistleSessionState = { tag: 'segmenting', notes: [] };
    // Feed during segmenting is a no-op.
    const s1 = whistleSessionReducer(s0, { type: 'feed', frame: pitched(440, 5) });
    expect(s1).toEqual(s0);
    // arm during arming is a no-op (only arm in idle transitions).
    const s2 = whistleSessionReducer({ tag: 'arming' }, { type: 'arm' });
    expect(s2).toEqual({ tag: 'arming' });
  });
});

describe('notesToSnippetPreview', () => {
  it('returns an empty pattern string for an empty note array', () => {
    expect(notesToSnippetPreview([])).toBe('note("")');
  });

  it('joins note names with spaces and wraps in s() with default piano', () => {
    const out = notesToSnippetPreview([
      { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
      { midi: 64, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
      { midi: 67, cents: 0, startMs: 400, durationMs: 200, vibratoCents: 0 },
    ]);
    expect(out).toBe('note("c4 e4 g4").s("piano")');
  });

  it('respects a custom instrument name', () => {
    const out = notesToSnippetPreview(
      [
        { midi: 60, cents: 0, startMs: 0, durationMs: 200, vibratoCents: 0 },
        { midi: 62, cents: 0, startMs: 200, durationMs: 200, vibratoCents: 0 },
      ],
      { instrument: 'sawtooth' },
    );
    expect(out).toBe('note("c4 d4").s("sawtooth")');
  });
});
