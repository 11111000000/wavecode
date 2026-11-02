import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import {
  rhythmPhase,
  rhythmHits,
  rhythmGrid,
  rhythmTapBpm,
  gridBpm,
  gridStepMs,
  startRhythm,
  stopRhythm,
  commitRhythm,
  discardRhythm,
  ensureRhythmSessionId,
  __resetRhythmForTests,
} from './rhythmStore';
import {
  setMicTransients,
  micTransients,
  __feedMicTransientForTests,
} from './micStore';
import { appStore, dispatch } from './appStore';
import { acquireMic, micMutexState } from './micMutexStore';

/**
 * rhythmStore tests — the presentation-layer wiring of the rhythm
 * recorder: mic ownership, the grid preview and the score splice.
 *
 * The real microphone is not available in jsdom, so `startMic` bails
 * out early — the store's own bookkeeping (the mic channel, the
 * phase, the preview) is what these tests pin.
 */

const hit = (
  type: 'kick' | 'snare' | 'hat' | 'click',
  startMs: number,
) => ({
  type,
  startMs,
  amplitude: 0.4,
  spectralCentroidHz: 1000,
  envelopeMs: 30,
});

beforeEach(() => {
  __resetRhythmForTests();
  dispatch({ type: 'replaceScore', text: '' });
  setMicTransients([]);
});

describe('rhythmStore — the take', () => {
  it('starts idle', () => {
    expect(rhythmPhase()).toBe('idle');
    expect(rhythmHits()).toHaveLength(0);
    expect(rhythmGrid()).toBeNull();
  });

  it('claims the mic-direct channel when the take starts', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-1' }));
    expect(rhythmPhase()).toBe('recording');
    expect(micMutexState().micDirect?.owner.kind).toBe('rhythm');
    expect(micMutexState().micDirect?.sessionId).toBe('r-1');
  });

  it('fails with MicBusyError when another mic-direct owner holds the channel', async () => {
    acquireMic({
      kind: 'mic-direct',
      owner: { kind: 'whistle', sessionId: 'w-1' },
      sessionId: 'w-1',
    });
    let captured: unknown = null;
    await Effect.runPromise(
      startRhythm({ sessionId: 'r-2' }).pipe(
        Effect.catchAll((err) => {
          captured = err;
          return Effect.void;
        }),
      ),
    );
    expect(captured).not.toBeNull();
    expect((captured as { _tag: string })._tag).toBe('MicBusy');
    expect(rhythmPhase()).toBe('idle');
  });

  it('releases the channel when the take stops', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-3' }));
    await Effect.runPromise(stopRhythm());
    expect(rhythmPhase()).toBe('idle');
    expect(micMutexState().micDirect).toBeNull();
  });

  it('reuses one session id across the FAB and the panel', () => {
    expect(ensureRhythmSessionId()).toBe(ensureRhythmSessionId());
  });
});

describe('rhythmStore — the grid preview', () => {
  it('places the hits on the grid as they arrive', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-4' }));
    // The live path: a hit arrives from the capture → the store's
    // subscription refreshes the preview.
    __feedMicTransientForTests(hit('kick', 0));
    __feedMicTransientForTests(hit('snare', 125));
    expect(rhythmHits()).toHaveLength(2);
    expect(rhythmGrid()).not.toBeNull();
    const grid = rhythmGrid();
    expect(grid).not.toBeNull();
    expect(grid!.bars).toBe(1);
    expect(grid!.rows[0]![0]).toBe(true);
    expect(grid!.rows[1]![1]).toBe(true);
  });

  it('reads the tempo from the transport', () => {
    // The default transport runs at 0.5 cps → 120 BPM → a 125 ms step.
    expect(gridBpm()).toBeCloseTo(120, 5);
    expect(gridStepMs()).toBe(125);
  });

  it('estimates the tempo the user tapped at', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-5' }));
    setMicTransients([
      hit('kick', 0), hit('kick', 500), hit('kick', 1000),
    ]);
    await Effect.runPromise(stopRhythm());
    expect(rhythmTapBpm()).toBeCloseTo(120, 5);
  });
});

describe('rhythmStore — the commit', () => {
  it('writes the quantised pattern into the score', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-6' }));
    setMicTransients([hit('kick', 0), hit('snare', 125)]);
    await Effect.runPromise(stopRhythm());
    await Effect.runPromise(commitRhythm());
    expect(appStore.score).toContain('drums_bd');
    expect(appStore.score).toContain('drums_sd');
    // The pattern is a whole bar of 16th notes.
    expect(appStore.score).toContain('~');
  });

  it('clears the hits after the commit', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-7' }));
    setMicTransients([hit('kick', 0)]);
    await Effect.runPromise(stopRhythm());
    await Effect.runPromise(commitRhythm());
    expect(micTransients()).toHaveLength(0);
    expect(rhythmHits()).toHaveLength(0);
  });

  it('leaves the score untouched when nothing was tapped', async () => {
    dispatch({ type: 'replaceScore', text: 'note("c4")' });
    await Effect.runPromise(commitRhythm());
    expect(appStore.score).toBe('note("c4")');
  });

  it('drops the take and keeps the panel open', async () => {
    await Effect.runPromise(startRhythm({ sessionId: 'r-8' }));
    setMicTransients([hit('kick', 0)]);
    await Effect.runPromise(discardRhythm());
    expect(rhythmHits()).toHaveLength(0);
    expect(rhythmGrid()).toBeNull();
    expect(rhythmPhase()).toBe('idle');
  });
});
