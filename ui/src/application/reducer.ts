import type { AppState, AgentStatus, AudioStatus, LayerMix, Message, Role } from '~/domain/types';
import { HISTORY_LIMIT, makeLayerMix } from '~/domain/types';
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
  | { readonly type: 'coalesceLatestHistoryEntry' }
  | { readonly type: 'clearMessages' }
  | { readonly type: 'switchPreset'; readonly id: string }
  | { readonly type: 'agentStatusChange'; readonly status: AgentStatus; readonly error?: string }
  | { readonly type: 'audioStatusChange'; readonly status: AudioStatus; readonly error?: string }
  | { readonly type: 'setLayerGain'; readonly index: number; readonly gain: number }
  | { readonly type: 'toggleLayerMute'; readonly index: number }
  | { readonly type: 'toggleLayerSolo'; readonly index: number }
  | { readonly type: 'setLayerCount'; readonly count: number }
  | { readonly type: 'setCps'; readonly cps: number }
  | { readonly type: 'setSwingAmount'; readonly amount: number }
  | { readonly type: 'setSwingDivisor'; readonly divisor: string };

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

/** Append a message to the dialog thread of the given preset id. */
const appendToDialog = (
  dialogs: Readonly<Record<string, ReadonlyArray<Message>>>,
  presetId: string,
  role: Role,
  content: string,
): Readonly<Record<string, ReadonlyArray<Message>>> => ({
  ...dialogs,
  [presetId]: appendMessage(dialogs[presetId] ?? [], role, content),
});

const pushCapped = <T,>(arr: ReadonlyArray<T>, item: T, limit: number): ReadonlyArray<T> => {
  const next = [...arr, item];
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
};

const reconcileLayerMix = (
  prev: ReadonlyArray<LayerMix>,
  count: number,
): ReadonlyArray<LayerMix> => {
  if (count < 0) return prev;
  if (prev.length === count) return prev;
  if (prev.length > count) return prev.slice(0, count);
  const additions: LayerMix[] = [];
  for (let i = prev.length; i < count; i += 1) additions.push(makeLayerMix(i));
  return [...prev, ...additions];
};

const clampGain = (g: number): number => {
  if (!Number.isFinite(g)) return 1;
  return Math.max(0, Math.min(1.5, g));
};

export const reduceAppEvent = (state: AppState, event: AppEvent): AppState => {
  switch (event.type) {
    case 'userMessage':
      return {
        ...state,
        dialogs: appendToDialog(state.dialogs, state.activePresetId, 'user', event.text),
      };

    case 'assistantMessage':
      return {
        ...state,
        dialogs: appendToDialog(state.dialogs, state.activePresetId, 'assistant', event.text),
      };

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

    case 'coalesceLatestHistoryEntry':
      if (state.history.length < 2) return state;
      return {
        ...state,
        history: state.history.slice(0, -1),
      };

    case 'clearMessages':
      return {
        ...state,
        dialogs: { ...state.dialogs, [state.activePresetId]: [] },
      };

    case 'switchPreset':
      if (event.id === state.activePresetId) return state;
      return {
        ...state,
        activePresetId: event.id,
        // Ensure the new preset has a thread entry (empty array)
        // so the UI can render an empty conversation without
        // having to fall back to `?? []` everywhere.
        dialogs: state.dialogs[event.id]
          ? state.dialogs
          : { ...state.dialogs, [event.id]: [] },
      };

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

    case 'setLayerGain': {
      const { index, gain } = event;
      if (index < 0 || index >= state.layerMix.length) return state;
      return {
        ...state,
        layerMix: state.layerMix.map((m, i) =>
          i === index ? { ...m, gain: clampGain(gain) } : m,
        ),
      };
    }

    case 'toggleLayerMute': {
      const { index } = event;
      if (index < 0 || index >= state.layerMix.length) return state;
      return {
        ...state,
        layerMix: state.layerMix.map((m, i) =>
          i === index ? { ...m, muted: !m.muted } : m,
        ),
      };
    }

    case 'toggleLayerSolo': {
      const { index } = event;
      if (index < 0 || index >= state.layerMix.length) return state;
      return {
        ...state,
        layerMix: state.layerMix.map((m, i) =>
          i === index ? { ...m, soloed: !m.soloed } : m,
        ),
      };
    }

    case 'setLayerCount': {
      const { count } = event;
      return { ...state, layerMix: reconcileLayerMix(state.layerMix, count) };
    }

    case 'setCps':
      return {
        ...state,
        transportState: { ...state.transportState, cps: event.cps },
      };

    case 'setSwingAmount': {
      const amount = Math.max(0, Math.min(1, event.amount));
      return {
        ...state,
        transportState: { ...state.transportState, swingAmount: amount },
      };
    }

    case 'setSwingDivisor':
      return {
        ...state,
        transportState: { ...state.transportState, swingDivisor: event.divisor },
      };
  }
};