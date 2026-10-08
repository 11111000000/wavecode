import { describe, it, expect } from 'vitest';
import { reduceAppEvent, type AppEvent } from './reducer';
import { initialAppState, makeLayerMix, type AppState, HISTORY_LIMIT, type LayerMix } from '~/domain/types';

const baseState = (): AppState => ({ ...initialAppState });

const withLayerMix = (mix: ReadonlyArray<LayerMix>): AppState => ({
  ...baseState(),
  layerMix: mix,
});

describe('reduceAppEvent', () => {
  it('userMessage appends a user message', () => {
    const event: AppEvent = { type: 'userMessage', text: 'make it faster' };
    const next = reduceAppEvent(baseState(), event);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ role: 'user', content: 'make it faster' });
  });

  it('assistantMessage appends an assistant message', () => {
    const event: AppEvent = { type: 'assistantMessage', text: 'stack(s("bd*4"))' };
    const next = reduceAppEvent(baseState(), event);
    expect(next.messages[0]).toMatchObject({ role: 'assistant' });
  });

  it('editScore applies the edit atomically', () => {
    const start: AppState = { ...baseState(), score: 'note("c4").s("sine")' };
    const next = reduceAppEvent(start, {
      type: 'editScore',
      oldText: 'c4',
      newText: 'e4',
    });
    expect(next.score).toBe('note("e4").s("sine")');
  });

  it('replaceScore replaces the entire score', () => {
    const next = reduceAppEvent(baseState(), { type: 'replaceScore', text: 'new score' });
    expect(next.score).toBe('new score');
  });

  it('replaceScore snapshots previous score into history and clears future', () => {
    const start: AppState = {
      ...baseState(),
      score: 'note("c4")',
      history: ['prev-a'],
      future: ['pending-redo'],
    };
    const next = reduceAppEvent(start, { type: 'replaceScore', text: 'note("e4")' });
    expect(next.score).toBe('note("e4")');
    expect(next.history).toEqual(['prev-a', 'note("c4")']);
    expect(next.future).toEqual([]);
  });

  it('replaceScore with identical text is a no-op', () => {
    const start: AppState = {
      ...baseState(),
      score: 'note("c4")',
      history: ['prev-a'],
    };
    const next = reduceAppEvent(start, { type: 'replaceScore', text: 'note("c4")' });
    expect(next).toBe(start);
  });

  it('history cap drops oldest entry when limit exceeded', () => {
    let state: AppState = baseState();
    const overflow = HISTORY_LIMIT + 5;
    for (let i = 0; i < overflow; i++) {
      state = reduceAppEvent(state, { type: 'replaceScore', text: `v${i}` });
    }
    expect(state.history.length).toBe(HISTORY_LIMIT);
    expect(state.history[0]).toBe(`v${overflow - HISTORY_LIMIT - 1}`);
    expect(state.score).toBe(`v${overflow - 1}`);
  });

  it('undoScore pops history and pushes current score into future', () => {
    const start: AppState = {
      ...baseState(),
      score: 'note("e4")',
      history: ['note("c4")'],
    };
    const next = reduceAppEvent(start, { type: 'undoScore' });
    expect(next.score).toBe('note("c4")');
    expect(next.history).toEqual([]);
    expect(next.future).toEqual(['note("e4")']);
  });

  it('undoScore is a no-op when history is empty', () => {
    const start: AppState = { ...baseState(), score: 'note("c4")' };
    const next = reduceAppEvent(start, { type: 'undoScore' });
    expect(next).toBe(start);
  });

  it('redoScore pops future and pushes current score into history', () => {
    const start: AppState = {
      ...baseState(),
      score: 'note("c4")',
      future: ['note("e4")'],
    };
    const next = reduceAppEvent(start, { type: 'redoScore' });
    expect(next.score).toBe('note("e4")');
    expect(next.future).toEqual([]);
    expect(next.history).toEqual(['note("c4")']);
  });

  it('redoScore is a no-op when future is empty', () => {
    const start: AppState = { ...baseState(), score: 'note("c4")' };
    const next = reduceAppEvent(start, { type: 'redoScore' });
    expect(next).toBe(start);
  });

  it('undo/redo round-trip restores the original score', () => {
    let state: AppState = { ...baseState(), score: 'note("c4")' };
    state = reduceAppEvent(state, { type: 'replaceScore', text: 'note("e4")' });
    state = reduceAppEvent(state, { type: 'undoScore' });
    expect(state.score).toBe('note("c4")');
    state = reduceAppEvent(state, { type: 'redoScore' });
    expect(state.score).toBe('note("e4")');
  });

  it('a new replaceScore after undo clears the future', () => {
    let state: AppState = { ...baseState(), score: 'a' };
    state = reduceAppEvent(state, { type: 'replaceScore', text: 'b' });
    state = reduceAppEvent(state, { type: 'undoScore' });
    expect(state.future).toEqual(['b']);
    state = reduceAppEvent(state, { type: 'replaceScore', text: 'c' });
    expect(state.future).toEqual([]);
    expect(state.score).toBe('c');
    expect(state.history).toEqual(['a']);
  });

  it('commitHistoryCheckpoint merges with top by dropping the top entry', () => {
    const start: AppState = {
      ...baseState(),
      score: 'd',
      history: ['a', 'b', 'c'],
    };
    const next = reduceAppEvent(start, { type: 'commitHistoryCheckpoint' });
    expect(next.history).toEqual(['a', 'b']);
    expect(next.score).toBe('d');
  });

  it('commitHistoryCheckpoint is a no-op when history has fewer than two entries', () => {
    const start: AppState = { ...baseState(), score: 'b', history: ['a'] };
    const next = reduceAppEvent(start, { type: 'commitHistoryCheckpoint' });
    expect(next).toBe(start);
  });

  it('commitHistoryCheckpoint is a no-op when history is empty', () => {
    const start: AppState = { ...baseState(), score: 'a' };
    const next = reduceAppEvent(start, { type: 'commitHistoryCheckpoint' });
    expect(next).toBe(start);
  });

  it('clearMessages empties the message history but keeps the score', () => {
    const withMessages: AppState = {
      ...baseState(),
      score: 'note("c4")',
      messages: [
        { id: '1', role: 'user', content: 'a', ts: 1 },
        { id: '2', role: 'assistant', content: 'b', ts: 2 },
      ],
    };
    const next = reduceAppEvent(withMessages, { type: 'clearMessages' });
    expect(next.messages).toEqual([]);
    expect(next.score).toBe('note("c4")');
  });

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
    const nan = reduceAppEvent(under, { type: 'setLayerGain', index: 0, gain: Number.NaN });
    expect(nan.layerMix[0]?.gain).toBe(1);
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
    expect(next.layerMix[0]).toEqual(makeLayerMix(0));
    expect(next.layerMix[1]).toEqual(makeLayerMix(1));
    expect(next.layerMix[2]).toEqual(makeLayerMix(2));
  });

  it('setLayerCount preserves existing entries when shrinking', () => {
    const start = withLayerMix([
      { layerIndex: 0, gain: 0.4, muted: true, soloed: false },
      { layerIndex: 1, gain: 0.7, muted: false, soloed: true },
    ]);
    const next = reduceAppEvent(start, { type: 'setLayerCount', count: 1 });
    expect(next.layerMix).toHaveLength(1);
    expect(next.layerMix[0]?.gain).toBe(0.4);
    expect(next.layerMix[0]?.muted).toBe(true);
  });

  it('setLayerCount is a no-op when count equals current length', () => {
    const start = withLayerMix([makeLayerMix(0), makeLayerMix(1)]);
    const next = reduceAppEvent(start, { type: 'setLayerCount', count: 2 });
    expect(next.layerMix).toBe(start.layerMix);
  });
});

