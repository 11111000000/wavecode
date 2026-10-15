import type {
  AppState, AgentStatus, AudioStatus, LayerMix, Message, Role, Track, TrackState,
} from '~/domain/types';
import {
  HISTORY_LIMIT, TRACK_MESSAGES_LIMIT, findActiveTrack, findTrack, makeLayerMix, makeTrack,
} from '~/domain/types';
import { applyEdit } from '~/domain/tools/editScore';

/**
 * Pure reducer для AppState. Без побочных эффектов.
 * Легко тестируется: на вход (state, event), на выход новый state.
 *
 * Track-aware: события, связанные с score/messages/history,
 * маршрутизируются в активный трек (`activeTrackId`).
 * `state.score` и `state.messages` больше не существуют —
 * единственный источник истины — `state.tracks[activeIdx]`.
 */

export type AppEvent =
  // ─── Track lifecycle ──────────────────────────────────────────────
  | { readonly type: 'createTrack'; readonly id: string; readonly title: string; readonly state?: TrackState; readonly score?: string }
  | { readonly type: 'switchTrack'; readonly id: string }
  | { readonly type: 'archiveTrack' }
  | { readonly type: 'restoreTrack' }
  | { readonly type: 'renameTrack'; readonly id: string; readonly title: string }
  | { readonly type: 'deleteTrack'; readonly id: string }
  | { readonly type: 'clearTrackDialog' }
  // ─── Per-track mutations (route to active track) ──────────────────
  | { readonly type: 'userMessage'; readonly text: string }
  | { readonly type: 'assistantMessage'; readonly text: string }
  | { readonly type: 'editScore'; readonly oldText: string; readonly newText: string }
  | { readonly type: 'replaceScore'; readonly text: string }
  | { readonly type: 'undoScore' }
  | { readonly type: 'redoScore' }
  | { readonly type: 'commitHistoryCheckpoint' }
  // ─── Side-channel status (unchanged) ──────────────────────────────
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
): ReadonlyArray<Message> => {
  const next = [
    ...messages,
    { id: newId(), role, content, ts: Date.now() },
  ];
  if (next.length <= TRACK_MESSAGES_LIMIT) return next;
  return next.slice(next.length - TRACK_MESSAGES_LIMIT);
};

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

/** Return active track or undefined. Caller must decide how to
 *  recover (typically: leave state unchanged). */
const getActive = (state: AppState): Track | undefined =>
  findActiveTrack(state);

/** Map a single track inside the tracks array. */
const mapTrack = (
  state: AppState,
  id: string,
  fn: (t: Track) => Track,
): ReadonlyArray<Track> => state.tracks.map((t) => (t.id === id ? fn(t) : t));

/** Map the active track. */
const mapActive = (state: AppState, fn: (t: Track) => Track): AppState => {
  const active = getActive(state);
  if (!active) return state;
  const now = Date.now();
  return {
    ...state,
    tracks: mapTrack(state, active.id, (t) => fn({ ...t, updatedAt: now })),
  };
};

const nonArchivedCount = (tracks: ReadonlyArray<Track>): number =>
  tracks.filter((t) => t.state !== 'archived').length;

const switchToFallback = (state: AppState): AppState => {
  // Prefer the most-recently-active non-archived track.
  const fallback = [...state.tracks]
    .filter((t) => t.state !== 'archived')
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (fallback && fallback.id !== state.activeTrackId) {
    return { ...state, activeTrackId: fallback.id };
  }
  return state;
};

export const reduceAppEvent = (state: AppState, event: AppEvent): AppState => {
  switch (event.type) {
    // ── Track lifecycle ───────────────────────────────────────────
    case 'createTrack': {
      if (findTrack(state, event.id)) return state; // duplicate id → no-op
      const now = Date.now();
      const newTrack = makeTrack({
        id: event.id,
        title: event.title,
        state: event.state ?? 'draft',
        ...(event.score !== undefined ? { score: event.score } : {}),
        now,
      });
      // Drop undo stack entry for the new id if it somehow exists.
      const undoStacks = { ...state.undoStacks };
      delete undoStacks[event.id];
      // New track becomes active.
      return {
        ...state,
        tracks: [...state.tracks, newTrack],
        activeTrackId: newTrack.id,
        undoStacks,
      };
    }

    case 'switchTrack': {
      if (event.id === state.activeTrackId) return state;
      const target = findTrack(state, event.id);
      if (!target) return state;
      const now = Date.now();
      return {
        ...state,
        activeTrackId: target.id,
        tracks: state.tracks.map((t) =>
          t.id === target.id ? { ...t, lastActiveAt: now } : t,
        ),
        layerMix: [], // reset mix; will be reconciled on next audio.eval
      };
    }

    case 'archiveTrack': {
      const active = getActive(state);
      if (!active) return state;
      if (active.state === 'archived') return state;
      return mapActive(state, (t) => ({ ...t, state: 'archived' as const }));
    }

    case 'restoreTrack': {
      const active = getActive(state);
      if (!active) return state;
      if (active.state === 'active') return state;
      return mapActive(state, (t) => ({ ...t, state: 'active' as const }));
    }

    case 'renameTrack': {
      const target = findTrack(state, event.id);
      if (!target) return state;
      const trimmed = event.title.trim();
      if (!trimmed || trimmed === target.title) return state;
      const now = Date.now();
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === target.id ? { ...t, title: trimmed, updatedAt: now } : t,
        ),
      };
    }

    case 'deleteTrack': {
      const target = findTrack(state, event.id);
      if (!target) return state;
      // Refuse to leave the user with zero non-archived tracks.
      if (nonArchivedCount(state.tracks) <= 1) return state;
      // Refuse to delete the only archived track we could restore
      // ... actually, archived tracks CAN be deleted freely; the
      // guard above is only about non-archived.
      const remaining = state.tracks.filter((t) => t.id !== event.id);
      const { [event.id]: _removed, ...undoStacks } = state.undoStacks;
      void _removed;
      // If we deleted the active track, switch to a fallback.
      const nextActive = state.activeTrackId === event.id
        ? [...remaining]
            .filter((t) => t.state !== 'archived')
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]?.id
            ?? remaining[0]?.id
            ?? state.activeTrackId
        : state.activeTrackId;
      return {
        ...state,
        tracks: remaining,
        activeTrackId: nextActive,
        undoStacks,
        layerMix: state.activeTrackId === event.id ? [] : state.layerMix,
      };
    }

    case 'clearTrackDialog': {
      const active = getActive(state);
      if (!active) return state;
      return mapActive(state, (t) => ({ ...t, messages: [] }));
    }

    // ── Per-track mutations ───────────────────────────────────────
    case 'userMessage':
      return mapActive(state, (t) => ({
        ...t,
        // Sending the first message promotes a draft to active.
        state: t.state === 'draft' ? 'active' : t.state,
        messages: appendMessage(t.messages, 'user', event.text),
      }));

    case 'assistantMessage':
      return mapActive(state, (t) => ({
        ...t,
        state: t.state === 'draft' ? 'active' : t.state,
        messages: appendMessage(t.messages, 'assistant', event.text),
      }));

    case 'editScore': {
      const active = getActive(state);
      if (!active) return state;
      const newScore = applyEdit(active.score, event.oldText, event.newText);
      if (newScore === active.score) return state;
      const stack = state.undoStacks[active.id] ?? [];
      return {
        ...state,
        tracks: mapTrack(state, active.id, (t) => ({ ...t, score: newScore, updatedAt: Date.now() })),
        undoStacks: {
          ...state.undoStacks,
          [active.id]: pushCapped(stack, active.score, HISTORY_LIMIT),
        },
        layerMix: [], // re-reconcile on next eval
      };
    }

    case 'replaceScore': {
      const active = getActive(state);
      if (!active) return state;
      if (active.score === event.text) return state;
      const stack = state.undoStacks[active.id] ?? [];
      return {
        ...state,
        tracks: mapTrack(state, active.id, (t) => ({ ...t, score: event.text, updatedAt: Date.now() })),
        undoStacks: {
          ...state.undoStacks,
          [active.id]: pushCapped(stack, active.score, HISTORY_LIMIT),
        },
        layerMix: [],
      };
    }

    case 'undoScore': {
      const active = getActive(state);
      if (!active) return state;
      const stack = state.undoStacks[active.id] ?? [];
      const prev = stack[stack.length - 1];
      if (prev === undefined) return state;
      return {
        ...state,
        tracks: mapTrack(state, active.id, (t) => ({ ...t, score: prev, updatedAt: Date.now() })),
        undoStacks: {
          ...state.undoStacks,
          [active.id]: stack.slice(0, -1),
        },
        layerMix: [],
      };
    }

    case 'redoScore': {
      // Redo is intentionally not persisted in the v1 Track model
      // (no `future` stack per track). A subsequent replaceScore or
      // editScore clears the active track's undo stack's top so the
      // "branch" point is dropped — same as the previous model.
      // Adding redo would require `undoStacks: Record<id, { history,
      // future }>` and is tracked as a future-improvement.
      return state;
    }

    case 'commitHistoryCheckpoint': {
      const active = getActive(state);
      if (!active) return state;
      const stack = state.undoStacks[active.id] ?? [];
      if (stack.length < 2) return state;
      return {
        ...state,
        undoStacks: {
          ...state.undoStacks,
          [active.id]: stack.slice(0, -1),
        },
      };
    }

    // ── Side-channel status ───────────────────────────────────────
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

  // switchToFallback is exported as a helper for callers that
  // want to ensure a sane active track after batch mutations
  // (e.g. when hydrating from IDB). Not part of the event flow.
  void switchToFallback;
  return state;
};
