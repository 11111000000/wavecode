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
  | { readonly type: 'rollbackScore' }
  | { readonly type: 'clearMessages' }
  | { readonly type: 'agentStatusChange'; readonly status: AgentStatus; readonly error?: string }
  | { readonly type: 'audioStatusChange'; readonly status: AudioStatus; readonly error?: string }
  | { readonly type: 'setCps'; readonly cps: number }
  | { readonly type: 'toggleSwing' };

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
      return { ...state, scorePrev: state.score, score: event.text };

    case 'rollbackScore':
      if (!state.scorePrev) return state;
      return { ...state, score: state.scorePrev, scorePrev: '' };

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

    case 'setCps':
      return {
        ...state,
        transportState: { ...state.transportState, cps: event.cps },
      };

    case 'toggleSwing':
      return {
        ...state,
        transportState: {
          ...state.transportState,
          swing: !state.transportState.swing,
        },
      };
  }
};