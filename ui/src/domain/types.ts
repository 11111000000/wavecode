/**
 * Domain types: чистые данные, никаких эффектов.
 * Это контракт между всеми слоями — изменение здесь затрагивает всё.
 */

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

/**
 * Lifecycle of a Track. `draft` = newly created, no AI interaction yet;
 * `active` = being worked on; `archived` = frozen, kept for reference.
 *
 * Allowed transitions:
 *   draft   → active    (first user message or explicit promote)
 *   active  → archived  (user pressed "archive")
 *   archived → active   (user pressed "restore")
 *   draft   → archived  (user abandoned it before doing anything)
 *   any     → (deleted) (terminal; removed from `tracks`)
 */
export type TrackState = 'draft' | 'active' | 'archived';

/**
 * Track — самостоятельная единица работы в wavecode.
 * Аналог git worktree + AI-agent session: каждый трек несёт
 * собственный score, историю диалога и метаданные.
 *
 * `score` и `messages` — единственный источник истины; полей
 * `AppState.score` / `AppState.messages` больше нет.
 */
export type Track = {
  readonly id: string;
  readonly title: string;
  readonly state: TrackState;
  readonly score: Score;
  readonly messages: ReadonlyArray<Message>;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Updated whenever the track becomes the active one. Used for
   *  ordering ("most recently active first") and to detect
   *  stale activeTrackId references after deletion. */
  readonly lastActiveAt: number;
};

export type AppState = {
  /** Per-track history stacks for undo/redo. Keyed by track id.
   *  Lives in AppState (not on Track) so it doesn't bloat IDB —
   *  undo is a session-only affordance, not part of the
   *  persisted record. */
  readonly undoStacks: Readonly<Record<string, ReadonlyArray<Score>>>;
  readonly tracks: ReadonlyArray<Track>;
  readonly activeTrackId: string;
  readonly agent: { readonly status: AgentStatus; readonly lastError?: string };
  readonly audio: { readonly status: AudioStatus; readonly lastError?: string };
  /** Side-state: mixer tracks for the top-level stack of the
   *  active track's score. Length is reconciled to actual
   *  stack size on every `audio.eval`. */
  readonly layerMix: ReadonlyArray<LayerMix>;
  readonly transportState: TransportState;
};

export const HISTORY_LIMIT = 50;
export const TRACK_MESSAGES_LIMIT = 200;

/** Default Creep score used to seed new tracks. Kept as a
 *  module constant so the `Track` factory can reuse it without
 *  duplicating the string. */
export const DEFAULT_TRACK_SCORE: Score = [
  '// Creep (Radiohead) — G → B → C → Cm, indie-rock 4/4',
  'stack(',
  '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
  '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),',
  '  n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),',
  '  s("bd ~ sbd ~").gain(0.5),',
  '  s("~ white ~ white").decay(.05).sustain(0).gain(0.22),',
  '  s("white*8").decay(.04).sustain(0).gain(0.15)',
  ')',
].join('\n');

/**
 * Construct a brand-new Track. Caller chooses id/title; `state`
 * defaults to `'active'` (the typical "I'm now working on this"
 * case — `draft` is reserved for explicitly-created-but-not-yet-
 * used tracks, set via explicit `state: 'draft'`).
 */
export const makeTrack = (params: {
  readonly id: string;
  readonly title: string;
  readonly score?: Score;
  readonly state?: TrackState;
  readonly messages?: ReadonlyArray<Message>;
  readonly now?: number;
}): Track => {
  const now = params.now ?? Date.now();
  return {
    id: params.id,
    title: params.title,
    state: params.state ?? 'active',
    score: params.score ?? DEFAULT_TRACK_SCORE,
    messages: params.messages ?? [],
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  };
};

const DEFAULT_TRACK_ID = 'default';

export const initialAppState: AppState = (() => {
  const now = 0;
  const defaultTrack = makeTrack({
    id: DEFAULT_TRACK_ID,
    title: 'Главный',
    score: DEFAULT_TRACK_SCORE,
    state: 'active',
    now,
  });
  return {
    undoStacks: { [DEFAULT_TRACK_ID]: [] },
    tracks: [defaultTrack],
    activeTrackId: defaultTrack.id,
    agent: { status: 'idle' },
    audio: { status: 'stopped' },
    layerMix: [],
    transportState: { cps: 0.5, swingAmount: 0, swingDivisor: '1/8' },
  };
})();

/** Find the active Track; returns undefined only if state is
 *  corrupted (activeTrackId points nowhere). Callers must
 *  treat undefined as "fall back to first track". */
export const findActiveTrack = (state: AppState): Track | undefined =>
  state.tracks.find((t) => t.id === state.activeTrackId);

/** Find any track by id. */
export const findTrack = (
  state: AppState,
  id: string,
): Track | undefined => state.tracks.find((t) => t.id === id);
