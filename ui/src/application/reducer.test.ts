import { describe, it, expect } from 'vitest';
import { reduceAppEvent, type AppEvent } from './reducer';
import { initialAppState, type AppState } from '~/domain/types';

const baseState = (): AppState => ({ ...initialAppState });

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

  it('replaceScore snapshots previous score into scorePrev', () => {
    const start: AppState = { ...baseState(), score: 'note("c4")' };
    const next = reduceAppEvent(start, { type: 'replaceScore', text: 'note("e4")' });
    expect(next.score).toBe('note("e4")');
    expect(next.scorePrev).toBe('note("c4")');
  });

  it('rollbackScore restores score from scorePrev and clears it', () => {
    const start: AppState = {
      ...baseState(),
      score: 'note("e4")',
      scorePrev: 'note("c4")',
    };
    const next = reduceAppEvent(start, { type: 'rollbackScore' });
    expect(next.score).toBe('note("c4")');
    expect(next.scorePrev).toBe('');
  });

  it('rollbackScore is a no-op when scorePrev is empty', () => {
    const start: AppState = { ...baseState(), score: 'note("c4")' };
    const next = reduceAppEvent(start, { type: 'rollbackScore' });
    expect(next).toEqual(start);
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

  it('setCps updates transportState.cps but keeps swing and other fields', () => {
    const start: AppState = {
      ...baseState(),
      transportState: { cps: 0.5, swing: true },
    };
    const next = reduceAppEvent(start, { type: 'setCps', cps: 1.25 });
    expect(next.transportState.cps).toBe(1.25);
    expect(next.transportState.swing).toBe(true);
  });

  it('toggleSwing flips transportState.swing and keeps cps', () => {
    const start: AppState = {
      ...baseState(),
      transportState: { cps: 0.7, swing: false },
    };
    const on = reduceAppEvent(start, { type: 'toggleSwing' });
    expect(on.transportState.swing).toBe(true);
    expect(on.transportState.cps).toBe(0.7);
    const off = reduceAppEvent(on, { type: 'toggleSwing' });
    expect(off.transportState.swing).toBe(false);
  });

  it('setCps with the same value still produces a new state object (immutable)', () => {
    const start: AppState = {
      ...baseState(),
      transportState: { cps: 0.5, swing: false },
    };
    const next = reduceAppEvent(start, { type: 'setCps', cps: 0.5 });
    expect(next).not.toBe(start);
    expect(next.transportState).not.toBe(start.transportState);
    expect(next.transportState.cps).toBe(0.5);
  });
});
