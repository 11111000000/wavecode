import { Effect, Layer } from 'effect';
import { get, set, del } from 'idb-keyval';
import { Repo, type GridStateSnapshot } from '~/domain/services';
import { makeTrack, type Track, type TrackState } from '~/domain/types';
import type { Message } from '~/domain/types';

/**
 * IDBRepo — persistence через IndexedDB (idb-keyval).
 *
 * Stores (v1, after dialog-sessions):
 *   - `wavecode-tracks-v1`        — ReadonlyArray<Track>
 *   - `wavecode-active-track-id-v1` — string (active track id)
 *   - `wavecode-grid-state-v1`    — GridStateSnapshot
 *
 * Legacy keys (pre-v1, v6):
 *   - `wavecode-score-v6`         — string
 *   - `wavecode-messages-v6`      — ReadonlyArray<Message>
 *
 * On first read with v1 keys absent, we attempt a one-shot
 * migration from the v6 keys. The legacy keys are deleted
 * after the new state is written. If the v1 keys exist but
 * the v6 keys also exist (e.g. corrupted state from a manual
 * edit), the v6 keys are ignored — v1 is authoritative.
 */

const KEY_TRACKS = 'wavecode-tracks-v1';
const KEY_ACTIVE_TRACK_ID = 'wavecode-active-track-id-v1';
const KEY_GRID_STATE = 'wavecode-grid-state-v1';
const LEGACY_KEY_SCORE = 'wavecode-score-v6';
const LEGACY_KEY_MESSAGES = 'wavecode-messages-v6';

const isTrackState = (v: unknown): v is TrackState =>
  v === 'draft' || v === 'active' || v === 'archived';

const isTrack = (v: unknown): v is Track => {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t['id'] === 'string' &&
    typeof t['title'] === 'string' &&
    isTrackState(t['state']) &&
    typeof t['score'] === 'string' &&
    Array.isArray(t['messages']) &&
    typeof t['createdAt'] === 'number' &&
    typeof t['updatedAt'] === 'number' &&
    typeof t['lastActiveAt'] === 'number'
  );
};

const isLegacyMessage = (v: unknown): v is Message => {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m['id'] === 'string' &&
    (m['role'] === 'user' || m['role'] === 'assistant' || m['role'] === 'system') &&
    typeof m['content'] === 'string' &&
    typeof m['ts'] === 'number'
  );
};

/**
 * Attempt to read legacy score/messages and produce a single
 * default Track. Returns [] if legacy data is absent or
 * unparseable. Caller persists the returned track list
 * (and the 'default' active id) before deleting the legacy
 * keys — this avoids losing data on a partial migration.
 */
const migrateFromLegacy = async (): Promise<ReadonlyArray<Track>> => {
  const [legacyScore, legacyMessages] = await Promise.all([
    get<string>(LEGACY_KEY_SCORE),
    get<ReadonlyArray<unknown>>(LEGACY_KEY_MESSAGES),
  ]);
  if (!legacyScore && !legacyMessages) return [];
  const messages = (legacyMessages ?? []).filter(isLegacyMessage);
  const now = Date.now();
  const track = makeTrack({
    id: 'default',
    title: 'Главный',
    score: legacyScore ?? '',
    messages,
    state: 'active',
    now,
  });
  return [track];
};

const cleanupLegacy = async (): Promise<void> => {
  await Promise.all([
    del(LEGACY_KEY_SCORE).catch(() => undefined),
    del(LEGACY_KEY_MESSAGES).catch(() => undefined),
  ]);
};

export const IDBRepo: Layer.Layer<Repo, never, never> = Layer.succeed(
  Repo,
  {
    loadTracks: () =>
      Effect.promise(async () => {
        const stored = await get<ReadonlyArray<unknown>>(KEY_TRACKS);
        if (Array.isArray(stored) && stored.length > 0 && stored.every(isTrack)) {
          return stored;
        }
        // No v1 state (or corrupted). Try legacy migration.
        const migrated = await migrateFromLegacy();
        if (migrated.length > 0) {
          // Persist the migrated state and clean up legacy keys.
          await set(KEY_TRACKS, migrated);
          await set(KEY_ACTIVE_TRACK_ID, migrated[0]!.id);
          await cleanupLegacy();
          return migrated;
        }
        // Truly empty: return the default singleton so the
        // app has something to render.
        const now = Date.now();
        const fallback: ReadonlyArray<Track> = [
          makeTrack({ id: 'default', title: 'Главный', state: 'active', now }),
        ];
        return fallback;
      }),

    saveTracks: (tracks) =>
      Effect.promise(() =>
        set(KEY_TRACKS, tracks).then(() => undefined),
      ),

    loadActiveTrackId: () =>
      Effect.promise(async () => {
        const stored = await get<string>(KEY_ACTIVE_TRACK_ID);
        if (typeof stored === 'string' && stored.length > 0) return stored;
        // Try legacy migration if the active id wasn't persisted
        // but the v6 keys were.
        const migrated = await migrateFromLegacy();
        if (migrated.length > 0) {
          await set(KEY_TRACKS, migrated);
          await set(KEY_ACTIVE_TRACK_ID, migrated[0]!.id);
          await cleanupLegacy();
          return migrated[0]!.id;
        }
        return null;
      }),

    saveActiveTrackId: (id) =>
      Effect.promise(() => set(KEY_ACTIVE_TRACK_ID, id).then(() => undefined)),

    loadGridState: () =>
      Effect.promise(() =>
        get<GridStateSnapshot>(KEY_GRID_STATE).then((v) => v ?? null),
      ),
    saveGridState: (snapshot) =>
      Effect.promise(() => set(KEY_GRID_STATE, snapshot).then(() => undefined)),
  },
);
