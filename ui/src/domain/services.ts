import { Context, type Effect } from 'effect';
import type { LayerMix, Message } from './types';
import type { NoteEvent } from './midi/encoder';
import type { LiveRecorderHandle } from '~/infrastructure/audio/AudioRecorder';
import type {
  OfflineRenderCallbacks,
  OfflineRenderOptions,
  OfflineRenderResult,
} from '~/infrastructure/audio/OfflineRender';
import type { GridMode } from './music/gridTypes';
import type { Grid } from './music/gridTypes';

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

/**
 * Which part of the live audio graph a live parameter addresses.
 *
 * `master` — the single global output of superdough
 * (`channelMerger → destinationGain → audioContext.destination`).
 * This is the only scope that is reachable from user code today.
 *
 * `layer` — one of wavecode's score layers. Layers exist only inside the
 * score string (they are pattern-level constructs, not audio-graph
 * nodes), so a layer-scoped live change is currently a documented no-op
 * rather than an error.
 */
export type LiveParamScope =
  | { readonly scope: 'master' }
  | { readonly scope: 'layer'; readonly index: number };

/**
 * Continuous parameters that a live gesture can drive.
 *
 * `gain` is applied to the master GainNode (reachable). `cutoff`,
 * `hcutoff`, `room` and `speed` are per-voice superdough FX — they are
 * built inside `superdough()` on every trigger and are not globally
 * reachable yet, so they are accepted (validated + clamped) but not
 * applied.
 */
export type LiveParamName = 'gain' | 'cutoff' | 'hcutoff' | 'room' | 'speed';

/**
 * A single live parameter change.
 *
 * This is the "real" continuous-control path: it changes the running
 * audio graph WITHOUT re-evaluating the pattern string (the textual
 * `.gain(X)` rewrite in `injectMix` re-compiles and re-swaps the whole
 * scheduler pattern, which is unusable at frame rate).
 */
export type LiveParam = {
  readonly scope: LiveParamScope;
  readonly param: LiveParamName;
  readonly value: number;
  /** 0 = immediate, otherwise smoothed over this duration (ms). */
  readonly rampMs: number;
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
     * See decisions/wavecode-mixer-live-update.yaml for trade-offs.
     */
    readonly setLayerMix: (
      layerMix: ReadonlyArray<LayerMix>,
    ) => Effect.Effect<void, never, never>;
    /**
     * Hot-swap a new score into the live scheduler without a full
     * `eval` cycle (no `repl.stop`, scheduler keeps running, the new
     * pattern takes over at the next lookahead window). Used by
     * StepGrid edit-mode per-tap — the score is mutated by splicing
     * one `s("…")` row in-place via `editGridLayer`, and we push the
     * new snippet into the scheduler without disrupting playback.
     *
     * On parse failure (corrupt snippet), the existing
     * `repl.scheduler.pattern` is left untouched — same silent-
     * rollback contract as `setLayerMix`. Implementations must be
     * idempotent.
     *
     * Companion of `setLayerMix` — both are runtime state pushers.
     * See decisions/wavecode-step-grid-modes.yaml synthesis (d).
     */
    readonly setScore: (
      score: string,
      layerMix: ReadonlyArray<LayerMix>,
    ) => Effect.Effect<void, never, never>;
    /**
     * Push a CONTINUOUS parameter change into the running audio graph
     * without touching the pattern.
     *
     * This is the live-parameter path used by the camera hand-gesture
     * feature: a gesture produces a new value every frame, and the
     * value must be applied to the already-playing audio graph. The
     * textual alternative (rewrite `.gain(X)` in the score and
     * re-evaluate it — `injectMix` → `repl.evaluate`) re-compiles the
     * pattern and swaps the scheduler pattern, which is unusable at
     * frame rate.
     *
     * Optional on purpose: implementations that cannot expose a live
     * parameter (and the existing test doubles) keep type-checking.
     * Implementations MUST be silent and non-throwing — a gesture frame
     * that cannot be applied is dropped, never surfaced as an error.
     */
    readonly setLiveParam?: (p: LiveParam) => void;
    /**
     * Synchronous read of current playback cycle position (0..1).
     * Computed from AudioContext clock + last successful eval start time.
     * Returns 0 when audio has never been started.
     */
    readonly getCycleProgress: () => Effect.Effect<number, never, never>;
    /**
     * Absolute playback position in scheduler cycles since the
     * scheduler started (0 at start, grows monotonically while the
     * pattern repeats).
     *
     * `getCycleProgress` answers "where are we INSIDE the current
     * cycle" (a fraction 0..1) — that is what a step sequencer needs.
     * A playhead on a timeline needs the opposite: the position on the
     * pattern's own timeline, so it can be mapped onto the score's
     * bars (and wrapped at the end of one repetition).
     *
     * Implementation prefers the scheduler's own cycle counter (it
     * stays correct when the tempo changes) and falls back to
     * `elapsed × cps` measured from the last successful eval.
     */
    readonly getCyclePosition: () => Effect.Effect<number, never, never>;
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
    ) => Effect.Effect<OfflineRenderResult, Error, never>;
  }
>() {}

export class Repo extends Context.Tag('Repo')<
  Repo,
  {
    readonly loadScore: () => Effect.Effect<string, never, never>;
    readonly saveScore: (score: string) => Effect.Effect<void, never, never>;
    /**
     * Dialog threads, keyed by preset id. Each entry is the
     * full conversation history for that preset. Switching
     * presets swaps the visible thread; each thread persists
     * independently across sessions.
     */
    readonly loadDialogs: () => Effect.Effect<
      Readonly<Record<string, ReadonlyArray<Message>>>,
      never,
      never
    >;
    readonly saveDialogs: (
      dialogs: Readonly<Record<string, ReadonlyArray<Message>>>,
    ) => Effect.Effect<void, never, never>;
    readonly loadActivePresetId: () => Effect.Effect<string | null, never, never>;
    readonly saveActivePresetId: (id: string) => Effect.Effect<void, never, never>;
    /**
     * Load the persisted StepGrid state — mode, draft, and
     * lastCommitted grid. Reload restores user intent so a
     * mid-sketch user doesn't lose their unsaved work.
     */
    readonly loadGridState: () => Effect.Effect<GridStateSnapshot | null, never, never>;
    readonly saveGridState: (
      snapshot: GridStateSnapshot,
    ) => Effect.Effect<void, never, never>;
  }
>() {}

/**
 * Persisted StepGrid state. `null` from `loadGridState` means
 * "no state saved yet" — caller should seed the defaults
 * (mode=view, empty grids).
 */
export type GridStateSnapshot = {
  readonly mode: GridMode;
  readonly draftGrid: Grid;
  readonly lastCommittedGrid: Grid;
};

export type AppEnv = LLMClient | AudioEngine | Repo;