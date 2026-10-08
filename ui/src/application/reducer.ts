import type { AppState, AgentStatus, AudioStatus, Message, Role } from '~/domain/types';
import { HISTORY_LIMIT } from '~/domain/types';
import { applyEdit } from '~/domain/tools/editScore';

/**
 * Pure reducer для AppState. Без побочных эффектов.
 * Легко тестируется: на вход (state, event), на выход новый state.
 */

export type AppEvent =
  | { readonly type: 'userMessage'; readonly text: string }
  | { readonly type: 'assistantMessage'; readonly text: string }
  | { readonly type: 'editScore'; readonly oldText: string; readonly newText: string }
  | { readonly type: 'replaceScore'; readonly text: string }
  | { readonly type: 'undoScore' }
  | { readonly type: 'redoScore' }
  | { readonly type: 'commitHistoryCheckpoint' }
  | { readonly type: 'clearMessages' }
  | { readonly type: 'agentStatusChange'; readonly status: AgentStatus; readonly error?: string }
  | { readonly type: 'audioStatusChange'; readonly status: AudioStatus; readonly error?: string };

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const appendMessage = (
  messages: ReadonlyArray<Message>,
  role: Role,
  content: string,
): ReadonlyArray<Message> => [
  ...messages,
  { id: newId(), role, content, ts: Date.now() },
];

const pushCapped = <T,>(arr: ReadonlyArray<T>, item: T, limit: number): ReadonlyArray<T> => {
  const next = [...arr, item];
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
};

export const reduceAppEvent = (state: AppState, event: AppEvent): AppState => {
  switch (event.type) {
    case 'userMessage':
      return { ...state, messages: appendMessage(state.messages, 'user', event.text) };

    case 'assistantMessage':
      return { ...state, messages: appendMessage(state.messages, 'assistant', event.text) };

    case 'editScore':
      return {
        ...state,
        score: applyEdit(state.score, event.oldText, event.newText),
      };

    case 'replaceScore':
      if (state.score === event.text) return state;
      return {
        ...state,
        history: pushCapped(state.history, state.score, HISTORY_LIMIT),
        future: [],
        score: event.text,
      };

    case 'undoScore': {
      const prev = state.history[state.history.length - 1];
      if (prev === undefined) return state;
      const nextHistory = state.history.slice(0, -1);
      return {
        ...state,
        score: prev,
        history: nextHistory,
        future: pushCapped(state.future, state.score, HISTORY_LIMIT),
      };
    }

    case 'redoScore': {
      const next = state.future[state.future.length - 1];
      if (next === undefined) return state;
      const nextFuture = state.future.slice(0, -1);
      return {
        ...state,
        score: next,
        history: pushCapped(state.history, state.score, HISTORY_LIMIT),
        future: nextFuture,
      };
    }

    case 'commitHistoryCheckpoint':
      if (state.history.length < 2) return state;
      return {
        ...state,
        history: state.history.slice(0, -1),
      };

    case 'clearMessages':
      return { ...state, messages: [] };

    case 'agentStatusChange':
      return {
        ...state,
        agent: { status: event.status, ...(event.error ? { lastError: event.error } : {}) },
      };

    case 'audioStatusChange':
      return {
        ...state,
        audio: { status: event.status, ...(event.error ? { lastError: event.error } : {}) },
      };
  }
};