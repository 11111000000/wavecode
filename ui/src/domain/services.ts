import { Context, type Effect } from 'effect';
import type { Message } from './types';

/**
 * Service Tags (интерфейсы).
 * Определяются в domain/, реализуются в infrastructure/.
 * Dependency Inversion: presentation/application зависят от абстракций,
 * а не от конкретных реализаций.
 */

export type CompletionRequest = {
  readonly messages: ReadonlyArray<Message>;
  readonly model: 'smart' | 'fast';
  readonly systemPrompt?: string;
};

export type CompletionChunk = {
  readonly type: 'text';
  readonly delta: string;
};

export class LLMClient extends Context.Tag('LLMClient')<
  LLMClient,
  {
    readonly streamCompletion: (
      req: CompletionRequest,
    ) => Effect.Effect<ReadableStream<CompletionChunk>, Error, never>;
  }
>() {}

export class AudioEngine extends Context.Tag('AudioEngine')<
  AudioEngine,
  {
    readonly eval: (snippet: string) => Effect.Effect<void, Error, never>;
    readonly stop: () => Effect.Effect<void, never, never>;
  }
>() {}

export class Repo extends Context.Tag('Repo')<
  Repo,
  {
    readonly loadScore: () => Effect.Effect<string, never, never>;
    readonly saveScore: (score: string) => Effect.Effect<void, never, never>;
    readonly loadMessages: () => Effect.Effect<ReadonlyArray<Message>, never, never>;
    readonly saveMessages: (
      messages: ReadonlyArray<Message>,
    ) => Effect.Effect<void, never, never>;
  }
>() {}

export type AppEnv = LLMClient | AudioEngine | Repo;