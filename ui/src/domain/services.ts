import { Context, type Effect } from 'effect';
import type { Message } from './types';
import type { NoteEvent } from './midi/encoder';
import type { LiveRecorderHandle } from '~/infrastructure/audio/AudioRecorder';
import type {
  OfflineRenderCallbacks,
  OfflineRenderOptions,
  OfflineRenderResult,
} from '~/infrastructure/audio/OfflineRender';

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
  /** 'low' = fast/minimal thinking, 'high' = deep thinking, 'off' = disabled. */
  readonly thinking?: 'low' | 'high' | 'off';
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
    /**
     * Compile snippet to a Strudel Pattern and query the first N cycles.
     * Returns flat NoteEvent[] (no Strudel types leak to callers).
     * Implementation lives in `infrastructure/audio/`.
     */
    readonly compileAndQuery: (
      snippet: string,
      cycles: number,
    ) => Effect.Effect<ReadonlyArray<NoteEvent>, Error, never>;
    /**
     * Создаёт live recorder (MediaRecorder поверх webaudioRepl output).
     * Возвращает handle, presentation вызывает start()/stop() напрямую
     * (это imperative lifecycle, не Effect-async).
     */
    readonly recordLive: () => Effect.Effect<LiveRecorderHandle, Error, never>;
    /**
     * Offline render snippet → WAV Blob. Не трогает live AudioContext
     * (создаёт свой OfflineAudioContext); в конце восстанавливает live ctx.
     */
    readonly renderOffline: (
      snippet: string,
      opts: OfflineRenderOptions,
      callbacks?: OfflineRenderCallbacks,
    ) => Effect.Effect<OfflineRenderResult, Error, never>;
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