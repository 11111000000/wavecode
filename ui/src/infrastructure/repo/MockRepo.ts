import { Effect, Layer } from 'effect';
import { Repo } from '~/domain/services';
import type { Message } from '~/domain/types';

/**
 * In-memory Repo. Состояние хранится в замыкании, при перезагрузке страницы
 * теряется. В Phase 3 заменяется на IDBRepo (через idb-keyval).
 */

const make = () => {
  let score = '';
  let messages: ReadonlyArray<Message> = [];
  return {
    loadScore: () => Effect.sync(() => score),
    saveScore: (s: string) =>
      Effect.sync(() => {
        score = s;
      }),
    loadMessages: () => Effect.sync(() => messages),
    saveMessages: (m: ReadonlyArray<Message>) =>
      Effect.sync(() => {
        messages = m;
      }),
  };
};

export const MockRepo: Layer.Layer<Repo, never, never> = Layer.effect(
  Repo,
  Effect.sync(() => make()),
);