import { Context, type Effect } from 'effect';
import type { LayerMix, Message } from './types';
import type { NoteEvent } from './midi/encoder';
import type { LanguageMode } from './languageMode';
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
    readonly eval: (
      snippet: string,
      mode?: LanguageMode,
    ) => Effect.Effect<void, Error, never>;
    readonly stop: () => Effect.Effect<void, never, never>;
    /**
     * Compile snippet to a Strudel Pattern and query the first N cycles.
     * Returns flat NoteEvent[] (no Strudel types leak to callers).
     * Implementation lives in `infrastructure/audio/`.
     */
    readonly compileAndQuery: (
      snippet: string,
      cycles: number,
      mode?: LanguageMode,
    ) => Effect.Effect<ReadonlyArray<NoteEvent>, Error, never>;
    /**
     * Update Strudel scheduler tempo in real-time (cycles per second).
     * Used by the Transport panel — debounced 100ms from UI.
     */
    readonly setCps: (cps: number) => Effect.Effect<void, never, never>;
    /**
     * Push mixer edits (gain / mute / solo) into the live Strudel pattern
     * without a full `eval` cycle. Rebuilds the snippet via `injectMix`,
     * parses it back to a Pattern and calls `repl.setPattern(newPat,
     * autostart=false)` so the scheduler swaps the pattern at its next
     * lookahead (no stop/start, no `beforeEval` side-effects).
     *
     * Used by the MixerPanel — debounced 50 ms from UI. Implementations
     * must be idempotent and silent on parse failure: on error, the
     * existing `repl.scheduler.pattern` is left untouched and audio
     * continues uninterrupted.
     *
     * Companion of `setCps` — both are runtime state pushers.
     * See `math/wavecode-mixer-live-update` for trade-offs.
     */
    readonly setLayerMix: (
      layerMix: ReadonlyArray<LayerMix>,
    ) => Effect.Effect<void, never, never>;
    /**
     * Synchronous read of current playback cycle position (0..1).
     * Computed from AudioContext clock + last successful eval start time.
     * Returns 0 when audio has never been started.
     */
    readonly getCycleProgress: () => Effect.Effect<number, never, never>;
    /**
     * Return the haps currently sounding in the live scheduler. Used by
     * PianoKeyboard FOLLOW mode to highlight piano keys whose MIDI
     * numbers are in `audio.eval(snippet)`'s scheduler at the moment
     * of the call.
     *
     * Implementations should query haps in a window of `[now, now + 1)`
     * cycle-positions relative to the AudioContext clock so that the
     * piano highlights the note that JUST started even if its end is
     * still some cycles away.
     *
     * Returns ONLY the active MIDI set — note durations and onsets are
     * dropped because PianoKeyboard only needs a `Set<number>` to light
     * up keys. Returns `[]` when audio was never started (no lastEval
     * anchor), or when the scheduler is not currently evaluating.
     */
    readonly getActiveHaps: () => Effect.Effect<
      ReadonlyArray<{ readonly midi: number }>,
      never,
      never
    >;
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
      mode?: LanguageMode,
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