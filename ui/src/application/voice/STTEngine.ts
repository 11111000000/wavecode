/**
 * STTEngine — application-layer service tag for speech-to-text
 * implementations (WebSpeechSTT today; WhisperSTTStub tomorrow).
 *
 * The interface is intentionally narrow: capability check, start a
 * stream of transcript chunks, stop. Streaming is exposed via
 * Effect-TS `Stream` because the orchestrator (VoiceAISession.ts)
 * consumes chunks across async boundaries, and Effect already gives
 * us back-pressure, interruption, and structured concurrency for
 * free. The MVP implementation (`WebSpeechSTT`, written by a later
 * agent) wraps `window.SpeechRecognition` events into this shape.
 *
 * Layer rules: this tag lives in `application/` because it is the
 * abstraction that callers depend on — concrete implementations
 * live in `infrastructure/stt/`. The orchestrator depends on the
 * tag, not on any concrete class, so swapping WebSpeechSTT for a
 * WhisperSTT or a server-Whisper relay requires zero changes
 * downstream of this file.
 *
 * Glossary:
 *   - `isSupported()` — capability check, never throws; the presentation
 *      layer calls this on mount to decide whether to enable the FAB.
 *   - `start(opts)`    — start a session; returns a stream of chunks.
 *      Failures (permission denied, browser without SpeechRecognition,
 *      network down) are surfaced as `SttUnsupportedError` rather than
 *      thrown — the orchestrator maps each `_tag` reason to UI state.
 *   - `stop()`         — idempotent terminal signal. Web Speech API
 *      doesn't reject double-`stop()`, so this never errors.
 */

import { Context, type Effect, type Stream } from 'effect';
import type { TranscriptChunk, TranscriptLang } from '~/domain/voice/Transcript';

export type SttStartOptions = {
  readonly lang: TranscriptLang;
  readonly interim: boolean;
};

/**
 * Tagged failure from `start` or the stream itself. Carries a
 * discriminator `reason` so the UI can decide between "browser
 * doesn't support voice input" (hide the FAB), "user denied mic
 * permission" (show retry), "network error" (auto-retry once), or
 * "aborted" (interrupted by `stop()` / `cancelInFlight`).
 *
 * Modeled on Effect's `Data.TaggedError` semantics but kept as a
 * plain object so we don't pull `@effect/schema` or runtime classes
 * into this module — presentation can do `case` on `reason`.
 */
export type SttUnsupportedError = {
  readonly _tag: 'SttUnsupported';
  readonly reason: 'no-speech-api' | 'permission-denied' | 'network' | 'aborted';
  readonly message: string;
};

/**
 * Type guard: matches the `_tag === 'SttUnsupported'` discriminator
 * AND ensures `reason` is one of the four documented values (so a
 * subtle typo in the orchestrator's switch becomes a type error
 * rather than a silent drop).
 */
export const isSttUnsupportedError = (e: unknown): e is SttUnsupportedError => {
  if (typeof e !== 'object' || e === null) return false;
  const tag = (e as { readonly _tag?: unknown })._tag;
  if (tag !== 'SttUnsupported') return false;
  const reason = (e as { readonly reason?: unknown }).reason;
  return reason === 'no-speech-api'
    || reason === 'permission-denied'
    || reason === 'network'
    || reason === 'aborted';
};

export class STTEngine extends Context.Tag('STTEngine')<
  STTEngine,
  {
    readonly isSupported: () => Effect.Effect<boolean, never, never>;
    readonly start: (
      opts: SttStartOptions,
    ) => Effect.Effect<
      Stream.Stream<TranscriptChunk, SttUnsupportedError>,
      SttUnsupportedError,
      never
    >;
    readonly stop: () => Effect.Effect<void, never, never>;
  }
>() {}
