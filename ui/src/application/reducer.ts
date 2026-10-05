import type { AppState, AgentStatus, AudioStatus, Message, Role } from '~/domain/types';
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
      return { ...state, score: event.text };

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