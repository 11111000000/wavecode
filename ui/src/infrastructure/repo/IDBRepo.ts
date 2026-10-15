import { Effect, Layer } from 'effect';
import { get, set, del } from 'idb-keyval';
import { Repo, type GridStateSnapshot } from '~/domain/services';
import type { Message } from '~/domain/types';

/**
 * IDBRepo — persistence через IndexedDB (idb-keyval).
 *
 * Stores (v1, after dialog-per-preset):
 *   - `wavecode-score-v6`         — string (legacy, kept for read)
 *   - `wavecode-dialogs-v1`      — Record<presetId, Message[]>
 *   - `wavecode-active-preset-v1`— string (last active preset id)
 *   - `wavecode-grid-state-v1`   — GridStateSnapshot
 *
 * Legacy keys (pre-v1):
 *   - `wavecode-messages-v6`     — ReadonlyArray<Message>
 *
 * On first read with v1 dialogs absent, we attempt a one-shot
 * migration: legacy `wavecode-messages-v6` becomes
 * `wavecode-dialogs-v1: { 'creep': <messages> }` (Creep is the
 * default preset). The legacy key is deleted after the new
 * state is written.
 */

const KEY_SCORE = 'wavecode-score-v6';
const KEY_DIALOGS = 'wavecode-dialogs-v1';
const KEY_ACTIVE_PRESET = 'wavecode-active-preset-v1';
const KEY_GRID_STATE = 'wavecode-grid-state-v1';
const LEGACY_KEY_MESSAGES = 'wavecode-messages-v6';

const DEFAULT_PRESET_ID = 'creep';

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

const isDialogMap = (
  v: unknown,
): v is Record<string, ReadonlyArray<Message>> => {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return Object.values(m).every(
    (arr) => Array.isArray(arr) && arr.every(isLegacyMessage),
  );
};

const migrateFromLegacy = async (): Promise<
  Readonly<Record<string, ReadonlyArray<Message>>> | null
> => {
  const legacy = await get<ReadonlyArray<unknown>>(LEGACY_KEY_MESSAGES);
  if (!Array.isArray(legacy) || legacy.length === 0) return null;
  const messages = legacy.filter(isLegacyMessage);
  if (messages.length === 0) return null;
  return { [DEFAULT_PRESET_ID]: messages };
};

const cleanupLegacy = async (): Promise<void> => {
  await del(LEGACY_KEY_MESSAGES).catch(() => undefined);
};

export const IDBRepo: Layer.Layer<Repo, never, never> = Layer.succeed(
  Repo,
  {
    loadScore: () =>
      Effect.promise(() =>
        get<string>(KEY_SCORE).then((v) => v ?? ''),
      ),
    saveScore: (score: string) => Effect.promise(() => set(KEY_SCORE, score).then(() => undefined)),

    loadDialogs: () =>
      Effect.promise(async () => {
        const stored = await get<unknown>(KEY_DIALOGS);
        if (isDialogMap(stored)) return stored;
        // Try legacy migration.
        const migrated = await migrateFromLegacy();
        if (migrated !== null) {
          await set(KEY_DIALOGS, migrated);
          await cleanupLegacy();
          return migrated;
        }
        return {};
      }),

    saveDialogs: (dialogs) =>
      Effect.promise(() => set(KEY_DIALOGS, dialogs).then(() => undefined)),

    loadActivePresetId: () =>
      Effect.promise(async () => {
        const stored = await get<string>(KEY_ACTIVE_PRESET);
        if (typeof stored === 'string' && stored.length > 0) return stored;
        return null;
      }),

    saveActivePresetId: (id) =>
      Effect.promise(() => set(KEY_ACTIVE_PRESET, id).then(() => undefined)),

    loadGridState: () =>
      Effect.promise(() =>
        get<GridStateSnapshot>(KEY_GRID_STATE).then((v) => v ?? null),
      ),
    saveGridState: (snapshot) =>
      Effect.promise(() => set(KEY_GRID_STATE, snapshot).then(() => undefined)),
  },
);
