/**
 * WakeWordDetector — application-layer service tag stub for a
 * future "hey wavecode" hands-free trigger. Not used by the MVP
 * orchestrator (VoiceAISession.ts is fully push-driven today) but
 * declared here so a later wake-word package can plug in without
 * touching the orchestrator's import surface.
 *
 * The MVP decision is explicit: tap-on-FAB is the primary entry
 * point (see `decisions/wavecode-voice-fab.yaml` commitment).
 * Wake-word ships as opt-in once a Porcupine (or equivalent)
 * license + WASM bundle is available, without changing any of the
 * existing files. See `awareness.thinking` in `domain/voice/` for
 * the FSM events the wake-word extension would dispatch.
 *
 * Glossary:
 *   - `WakeWordConfig.phrases`     — list of trigger phrases; detector
 *      does fuzzy-match (e.g., "hey wavecode", "wavecode").
 *   - `WakeWordConfig.sensitivity` — 0..1 trade-off between false
 *      positives and missed triggers. UI exposes as a slider.
 *   - `WakeWordEvent.phrase`       — which phrase matched.
 *   - `WakeWordEvent.confidence`   — detector-internal score in 0..1.
 */

import { Context, type Effect, type Stream } from 'effect';

export type WakeWordConfig = {
  readonly phrases: ReadonlyArray<string>;
  readonly sensitivity: number;
};

export type WakeWordEvent = {
  readonly phrase: string;
  readonly timestampMs: number;
  readonly confidence: number;
};

export class WakeWordDetector extends Context.Tag('WakeWordDetector')<
  WakeWordDetector,
  {
    readonly isSupported: () => Effect.Effect<boolean, never, never>;
    readonly start: (
      cfg: WakeWordConfig,
    ) => Effect.Effect<Stream.Stream<WakeWordEvent, never>, never, never>;
    readonly stop: () => Effect.Effect<void, never, never>;
  }
>() {}
