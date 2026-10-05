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
});
