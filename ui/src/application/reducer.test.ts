import { describe, it, expect } from 'vitest';
import { reduceAppEvent } from './reducer';
import {
  initialAppState,
  makeLayerMix,
  makeTrack,
  TRACK_MESSAGES_LIMIT,
  type AppState,
  type LayerMix,
  type Track,
} from '~/domain/types';

const baseState = (): AppState => structuredClone(initialAppState);

const withTrack = (
  state: AppState,
  track: Track,
  active = true,
): AppState => {
  const tracks = [...state.tracks, track];
  const undoStacks = { ...state.undoStacks, [track.id]: [] };
  return {
    ...state,
    tracks,
    activeTrackId: active ? track.id : state.activeTrackId,
    undoStacks,
  };
};

const activeTrack = (state: AppState): Track | undefined =>
  state.tracks.find((t) => t.id === state.activeTrackId);

const withLayerMix = (mix: ReadonlyArray<LayerMix>): AppState => ({
  ...baseState(),
  layerMix: mix,
});

describe('reduceAppEvent — Track lifecycle', () => {
  it('createTrack adds a new track and makes it active', () => {
    const start = baseState();
    const next = reduceAppEvent(start, {
      type: 'createTrack',
      id: 't-1',
      title: 'Эмбиент',
      state: 'draft',
    });
    expect(next.tracks).toHaveLength(2);
    expect(next.activeTrackId).toBe('t-1');
    const t = next.tracks.find((x) => x.id === 't-1')!;
    expect(t.title).toBe('Эмбиент');
    expect(t.state).toBe('draft');
  });

  it('createTrack with duplicate id is a no-op', () => {
    const start = baseState();
    const next = reduceAppEvent(start, { type: 'createTrack', id: 'default', title: 'X' });
    expect(next).toBe(start);
  });

  it('createTrack seeds the new id with the supplied score', () => {
    const next = reduceAppEvent(baseState(), {
      type: 'createTrack',
      id: 't-1',
      title: 'X',
      score: 'note("c4")',
    });
    const t = next.tracks.find((x) => x.id === 't-1')!;
    expect(t.score).toBe('note("c4")');
  });

  it('switchTrack updates activeTrackId and lastActiveAt', () => {
    const t0 = activeTrack(baseState())!;
    const start = withTrack(baseState(), makeTrack({ id: 'a', title: 'A' }));
    const before = Date.now();
    const next = reduceAppEvent(start, { type: 'switchTrack', id: 'a' });
    expect(next.activeTrackId).toBe('a');
    const a = next.tracks.find((x) => x.id === 'a')!;
    expect(a.lastActiveAt).toBeGreaterThanOrEqual(before);
    void t0;
  });

  it('switchTrack to the same id is a no-op', () => {
    const start = baseState();
    const next = reduceAppEvent(start, { type: 'switchTrack', id: start.activeTrackId });
    expect(next).toBe(start);
  });

  it('switchTrack to a non-existent id is a no-op', () => {
    const next = reduceAppEvent(baseState(), { type: 'switchTrack', id: 'nope' });
    expect(next.activeTrackId).toBe(baseState().activeTrackId);
  });

  it('archiveTrack sets state to archived on the active track', () => {
    const next = reduceAppEvent(baseState(), { type: 'archiveTrack' });
    const t = activeTrack(next)!;
    expect(t.state).toBe('archived');
  });

  it('archiveTrack on an already-archived track is a no-op', () => {
    const start = baseState();
    const archived = reduceAppEvent(start, { type: 'archiveTrack' });
    const again = reduceAppEvent(archived, { type: 'archiveTrack' });
    expect(again).toBe(archived);
  });

  it('restoreTrack returns an archived track to active', () => {
    const archived = reduceAppEvent(baseState(), { type: 'archiveTrack' });
    const restored = reduceAppEvent(archived, { type: 'restoreTrack' });
    expect(activeTrack(restored)!.state).toBe('active');
  });

  it('restoreTrack on an already-active track is a no-op', () => {
    const start = baseState();
    const next = reduceAppEvent(start, { type: 'restoreTrack' });
    expect(next).toBe(start);
  });

  it('renameTrack updates the title (trimmed)', () => {
    const next = reduceAppEvent(baseState(), {
      type: 'renameTrack',
      id: 'default',
      title: '  Техно-черновик  ',
    });
    expect(activeTrack(next)!.title).toBe('Техно-черновик');
  });

  it('renameTrack with empty title is a no-op', () => {
    const start = baseState();
    const next = reduceAppEvent(start, {
      type: 'renameTrack',
      id: 'default',
      title: '   ',
    });
    expect(next).toBe(start);
  });

  it('renameTrack with the same title is a no-op', () => {
    const start = baseState();
    const next = reduceAppEvent(start, {
      type: 'renameTrack',
      id: 'default',
      title: activeTrack(start)!.title,
    });
    expect(next).toBe(start);
  });

  it('deleteTrack removes a non-active track', () => {
    const start = withTrack(baseState(), makeTrack({ id: 'extra', title: 'X' }));
    const next = reduceAppEvent(start, { type: 'deleteTrack', id: 'extra' });
    expect(next.tracks.find((t) => t.id === 'extra')).toBeUndefined();
    expect(next.activeTrackId).toBe('default');
  });

  it('deleteTrack refuses to remove the only non-archived track', () => {
    const start = baseState();
    const next = reduceAppEvent(start, { type: 'deleteTrack', id: 'default' });
    expect(next).toBe(start);
    expect(next.tracks).toHaveLength(1);
  });

  it('deleteTrack allows removing an archived track even if it is the only one', () => {
    const archived = reduceAppEvent(baseState(), { type: 'archiveTrack' });
    const next = reduceAppEvent(archived, { type: 'deleteTrack', id: 'default' });
    expect(next.tracks).toHaveLength(0);
  });

  it('deleteTrack on the active track switches to a fallback', () => {
    let state: AppState = baseState();
    state = withTrack(state, makeTrack({ id: 'extra', title: 'X' }));
    // Active is 'default'; add 'extra' and switch to it.
    state = reduceAppEvent(state, { type: 'switchTrack', id: 'extra' });
    expect(state.activeTrackId).toBe('extra');
    const next = reduceAppEvent(state, { type: 'deleteTrack', id: 'extra' });
    expect(next.tracks).toHaveLength(1);
    expect(next.activeTrackId).toBe('default');
  });

  it('clearTrackDialog empties messages of the active track only', () => {
    let state: AppState = baseState();
    state = reduceAppEvent(state, { type: 'userMessage', text: 'hi' });
    state = withTrack(state, makeTrack({ id: 'other', title: 'O' }));
    state = reduceAppEvent(state, { type: 'switchTrack', id: 'other' });
    state = reduceAppEvent(state, { type: 'userMessage', text: 'other-msg' });
    // Switch back to default and clear its dialog.
    state = reduceAppEvent(state, { type: 'switchTrack', id: 'default' });
    const cleared = reduceAppEvent(state, { type: 'clearTrackDialog' });
    expect(activeTrack(cleared)!.messages).toHaveLength(0);
    const other = cleared.tracks.find((t) => t.id === 'other')!;
    expect(other.messages).toHaveLength(1);
  });
});

describe('reduceAppEvent — per-track mutations', () => {
  it('userMessage appends to the active track', () => {
    const next = reduceAppEvent(baseState(), { type: 'userMessage', text: 'make it faster' });
    const t = activeTrack(next)!;
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ role: 'user', content: 'make it faster' });
  });

  it('userMessage on a draft track promotes it to active', () => {
    let state: AppState = baseState();
    state = withTrack(state, makeTrack({ id: 'd', title: 'D', state: 'draft' }));
    state = reduceAppEvent(state, { type: 'switchTrack', id: 'd' });
    const next = reduceAppEvent(state, { type: 'userMessage', text: 'first!' });
    const t = next.tracks.find((x) => x.id === 'd')!;
    expect(t.state).toBe('active');
    expect(t.messages).toHaveLength(1);
  });

  it('assistantMessage appends to the active track', () => {
    const next = reduceAppEvent(baseState(), {
      type: 'assistantMessage',
      text: 'stack(s("bd*4"))',
    });
    const t = activeTrack(next)!;
    expect(t.messages[0]).toMatchObject({ role: 'assistant' });
  });

  it('userMessage caps messages at TRACK_MESSAGES_LIMIT', () => {
    let state: AppState = baseState();
    for (let i = 0; i < TRACK_MESSAGES_LIMIT + 5; i++) {
      state = reduceAppEvent(state, { type: 'userMessage', text: `m-${i}` });
    }
    const t = activeTrack(state)!;
    expect(t.messages).toHaveLength(TRACK_MESSAGES_LIMIT);
    expect(t.messages[0]!.content).toBe(`m-5`);
    expect(t.messages[t.messages.length - 1]!.content).toBe(`m-${TRACK_MESSAGES_LIMIT + 4}`);
  });

  it('editScore applies the edit atomically on the active track', () => {
    const start: AppState = {
      ...baseState(),
      tracks: [
        makeTrack({ id: 'default', title: 'Главный', score: 'note("c4").s("sine")' }),
      ],
      activeTrackId: 'default',
    };
    const next = reduceAppEvent(start, {
      type: 'editScore',
      oldText: 'c4',
      newText: 'e4',
    });
    expect(activeTrack(next)!.score).toBe('note("e4").s("sine")');
  });

  it('replaceScore replaces the entire active track score', () => {
    const next = reduceAppEvent(baseState(), { type: 'replaceScore', text: 'new score' });
    expect(activeTrack(next)!.score).toBe('new score');
  });

  it('replaceScore snapshots the previous score into the track undo stack', () => {
    const start: AppState = baseState();
    const before = activeTrack(start)!.score;
    const next = reduceAppEvent(start, { type: 'replaceScore', text: 'new score' });
    const stack = next.undoStacks[next.activeTrackId] ?? [];
    expect(stack[stack.length - 1]).toBe(before);
  });

  it('replaceScore with identical text is a no-op', () => {
    const start: AppState = baseState();
    const next = reduceAppEvent(start, {
      type: 'replaceScore',
      text: activeTrack(start)!.score,
    });
    expect(next).toBe(start);
  });

  it('undoScore pops the per-track undo stack and restores the previous score', () => {
    let state: AppState = baseState();
    const original = activeTrack(state)!.score;
    state = reduceAppEvent(state, { type: 'replaceScore', text: 'changed' });
    expect(activeTrack(state)!.score).toBe('changed');
    state = reduceAppEvent(state, { type: 'undoScore' });
    expect(activeTrack(state)!.score).toBe(original);
  });

  it('undoScore is a no-op when the active track has no undo history', () => {
    const start = baseState();
    const next = reduceAppEvent(start, { type: 'undoScore' });
    expect(next).toBe(start);
  });

  it('commitHistoryCheckpoint merges with top by dropping the top entry', () => {
    let state: AppState = baseState();
    // Build a small undo stack on the active track.
    for (let i = 0; i < 3; i++) {
      state = reduceAppEvent(state, { type: 'replaceScore', text: `v-${i}` });
    }
    const stackBefore = (state.undoStacks[state.activeTrackId] ?? []).length;
    expect(stackBefore).toBeGreaterThanOrEqual(2);
    const next = reduceAppEvent(state, { type: 'commitHistoryCheckpoint' });
    const stackAfter = next.undoStacks[state.activeTrackId] ?? [];
    expect(stackAfter.length).toBe(stackBefore - 1);
  });

  it('commitHistoryCheckpoint is a no-op when undo stack has fewer than two entries', () => {
    const start: AppState = {
      ...baseState(),
      undoStacks: { ...baseState().undoStacks, default: ['only-one'] },
    };
    const next = reduceAppEvent(start, { type: 'commitHistoryCheckpoint' });
    expect(next).toBe(start);
  });

  it('replaceScore on track A does not pollute the undo stack of track B', () => {
    let state: AppState = baseState();
    state = withTrack(state, makeTrack({ id: 'b', title: 'B' }));
    // Re-activate the default track so replaceScore targets it.
    state = reduceAppEvent(state, { type: 'switchTrack', id: 'default' });
    const stackABefore = (state.undoStacks['default'] ?? []).length;
    state = reduceAppEvent(state, { type: 'replaceScore', text: 'mut-A' });
    const stackAAfter = (state.undoStacks['default'] ?? []).length;
    const stackB = state.undoStacks['b'] ?? [];
    expect(stackAAfter).toBe(stackABefore + 1);
    expect(stackB).toHaveLength(0);
  });
});

describe('reduceAppEvent — side-channel status (unchanged)', () => {
  it('agentStatusChange updates agent.status', () => {
    const next = reduceAppEvent(baseState(), { type: 'agentStatusChange', status: 'streaming' });
    expect(next.agent.status).toBe('streaming');
  });

  it('audioStatusChange preserves lastError only when provided', () => {
    const a = reduceAppEvent(baseState(), { type: 'audioStatusChange', status: 'error', error: 'boom' });
    expect(a.audio.lastError).toBe('boom');
    const b = reduceAppEvent(a, { type: 'audioStatusChange', status: 'playing' });
    expect(b.audio.lastError).toBeUndefined();
  });
});

describe('reduceAppEvent — mixer / transport (unchanged)', () => {
  it('setLayerGain updates gain for the targeted layer only', () => {
    const start = withLayerMix([makeLayerMix(0), makeLayerMix(1), makeLayerMix(2)]);
    const next = reduceAppEvent(start, { type: 'setLayerGain', index: 1, gain: 0.3 });
    expect(next.layerMix[0]?.gain).toBe(1);
    expect(next.layerMix[1]?.gain).toBe(0.3);
    expect(next.layerMix[2]?.gain).toBe(1);
  });

  it('setLayerGain clamps into 0..1.5', () => {
    const start = withLayerMix([makeLayerMix(0)]);
    const over = reduceAppEvent(start, { type: 'setLayerGain', index: 0, gain: 99 });
    expect(over.layerMix[0]?.gain).toBe(1.5);
    const under = reduceAppEvent(over, { type: 'setLayerGain', index: 0, gain: -1 });
    expect(under.layerMix[0]?.gain).toBe(0);
  });

  it('setLayerGain is a no-op for out-of-range index', () => {
    const start = withLayerMix([makeLayerMix(0)]);
    const next = reduceAppEvent(start, { type: 'setLayerGain', index: 5, gain: 0.2 });
    expect(next).toEqual(start);
  });

  it('toggleLayerMute flips the muted flag on the targeted layer only', () => {
    const start = withLayerMix([makeLayerMix(0), makeLayerMix(1)]);
    const next = reduceAppEvent(start, { type: 'toggleLayerMute', index: 1 });
    expect(next.layerMix[0]?.muted).toBe(false);
    expect(next.layerMix[1]?.muted).toBe(true);
  });

  it('toggleLayerSolo flips the soloed flag on the targeted layer only', () => {
    const start = withLayerMix([makeLayerMix(0), makeLayerMix(1)]);
    const next = reduceAppEvent(start, { type: 'toggleLayerSolo', index: 0 });
    expect(next.layerMix[0]?.soloed).toBe(true);
    expect(next.layerMix[1]?.soloed).toBe(false);
  });

  it('setLayerCount grows the layerMix array with default entries', () => {
    const start = withLayerMix([makeLayerMix(0)]);
    const next = reduceAppEvent(start, { type: 'setLayerCount', count: 3 });
    expect(next.layerMix).toHaveLength(3);
  });

  it('setLayerCount preserves existing entries when shrinking', () => {
    const start = withLayerMix([
      { layerIndex: 0, gain: 0.4, muted: true, soloed: false },
      { layerIndex: 1, gain: 0.7, muted: false, soloed: true },
    ]);
    const next = reduceAppEvent(start, { type: 'setLayerCount', count: 1 });
    expect(next.layerMix).toHaveLength(1);
    expect(next.layerMix[0]?.gain).toBe(0.4);
  });

  it('setCps updates transportState.cps but keeps swing', () => {
    const start: AppState = {
      ...baseState(),
      transportState: { cps: 0.5, swingAmount: 0.3, swingDivisor: '1/8' },
    };
    const next = reduceAppEvent(start, { type: 'setCps', cps: 1.25 });
    expect(next.transportState.cps).toBe(1.25);
    expect(next.transportState.swingAmount).toBe(0.3);
  });

  it('setSwingAmount clamps to [0, 1]', () => {
    const start = baseState();
    const over = reduceAppEvent(start, { type: 'setSwingAmount', amount: 1.5 });
    expect(over.transportState.swingAmount).toBe(1);
    const under = reduceAppEvent(over, { type: 'setSwingAmount', amount: -0.3 });
    expect(under.transportState.swingAmount).toBe(0);
  });
});
