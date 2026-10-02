import { Effect, Layer } from 'effect';
import { get, set } from 'idb-keyval';
import { Repo } from '~/domain/services';
import type { Message } from '~/domain/types';

/**
 * IDBRepo — persistence через IndexedDB (idb-keyval).
 * Stores: score (string), messages (ReadonlyArray<Message>).
 * Reload восстанавливает state.
 */

const KEY_SCORE = 'wavecode-score-v6';
const KEY_MESSAGES = 'wavecode-messages-v6';

export const IDBRepo: Layer.Layer<Repo, never, never> = Layer.succeed(
  Repo,
  {
    loadScore: () =>
      Effect.promise(() =>
        get<string>(KEY_SCORE).then((v) => v ?? ''),
      ),
    saveScore: (score: string) => Effect.promise(() => set(KEY_SCORE, score).then(() => undefined)),
    loadMessages: () =>
      Effect.promise(() =>
        get<ReadonlyArray<Message>>(KEY_MESSAGES).then((v) => v ?? []),
      ),
    saveMessages: (messages: ReadonlyArray<Message>) =>
      Effect.promise(() => set(KEY_MESSAGES, messages).then(() => undefined)),
  },
);
