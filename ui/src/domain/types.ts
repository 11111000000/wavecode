/**
 * Domain types: чистые данные, никаких эффектов.
 * Это контракт между всеми слоями — изменение здесь затрагивает всё.
 */

import { BUILTIN_PRESETS } from './presets';

/** Дефолтный score = built-in `creep` (единый источник истины). */
const creepScore: string =
  BUILTIN_PRESETS.find((p) => p.id === 'creep')?.score ?? '';

export type Score = string;

export type Role = 'user' | 'assistant' | 'system';

export type Message = {
  readonly id: string;
  readonly role: Role;
  readonly content: string;
  readonly ts: number;
};

export type AgentStatus = 'idle' | 'streaming' | 'awaiting-tool' | 'error';

export type AudioStatus = 'stopped' | 'playing' | 'error';

export type LayerMix = {
  readonly layerIndex: number;
  /** 0..1.5 amplitude scalar applied via .gain() */
  readonly gain: number;
  readonly muted: boolean;
  readonly soloed: boolean;
};

export const makeLayerMix = (index: number): LayerMix => ({
  layerIndex: index,
  gain: 1,
  muted: false,
  soloed: false,
});

export type TransportState = {
  readonly cps: number;
  /** 0..1 swing amount; 0 = off. */
  readonly swingAmount: number;
  /** Strudel `.swing(amount, divisor)` divisor; common: '1/4', '1/8', '1/16', '1/3'. */
  readonly swingDivisor: string;
};

export type AppState = {
  readonly score: Score;
  readonly history: ReadonlyArray<Score>;
  readonly future: ReadonlyArray<Score>;
  /** Dialog messages per preset id. Each preset (built-in or
   *  custom) has its own conversation thread with the LLM —
   *  switching presets in the top-bar selector swaps the visible
   *  thread and routes the next LLM call into the new thread.
   *  Keys are `presetId` strings from `presetsStore`. */
  readonly dialogs: Readonly<Record<string, ReadonlyArray<Message>>>;
  /** Currently selected preset id. Source of truth for which
   *  dialog thread is active. Mirrored to `localStorage` via
   *  `selectedPreset.ts` (kept for backward compat) and to
   *  IDB via `useAutoSave` for cross-tab/cross-session restore. */
  readonly activePresetId: string;
  readonly agent: { readonly status: AgentStatus; readonly lastError?: string };
  readonly audio: { readonly status: AudioStatus; readonly lastError?: string };
  /** Side-state: mixer tracks for the top-level stack of `score`.
   *  Length is reconciled to actual stack size on every `audio.eval`. */
  readonly layerMix: ReadonlyArray<LayerMix>;
  readonly transportState: TransportState;
};

export const HISTORY_LIMIT = 50;

export const initialAppState: AppState = {
  // Дефолтный score при первом запуске (IDB пуст) — совпадает с
  // built-in пресетом `creep` (single source of truth в presets.ts).
  score: creepScore,
  history: [],
  future: [],
  dialogs: { creep: [] },
  activePresetId: 'creep',
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
  layerMix: [],
  transportState: { cps: 0.5, swingAmount: 0, swingDivisor: '1/8' },
};
