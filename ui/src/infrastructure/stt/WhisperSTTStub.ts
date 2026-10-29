/**
 * WhisperSTTStub — placeholder `STTEngine` implementation that
 * always reports "unsupported". Lives next to `WebSpeechSTT` so the
 * presentation layer (FAB) can probe both candidates in sequence
 * and degrade gracefully:
 *
 *   - if `WebSpeechSTT.isSupported() === true` → use it.
 *   - else → `WhisperSTTStub.start()` returns a failed Effect with
 *     a reason the presentation can render as a disabled FAB with
 *     a tooltip ("открой Chrome — Whisper fallback пока не готов").
 *
 * The stub exists for two reasons:
 *   1. Architecture compliance — every Layer in this codebase has
 *      at least one concrete implementation; the
 *      `extension-points-stable` outcome in
 *      `decisions/wavecode-voice-fab.yaml` requires `STTEngine` to
 *      be a plug-in point even in MVP.
 *   2. Forward compatibility — when Whisper-WASM or a server
 *      Whisper relay lands, the swap is a single-file replacement
 *      in `infrastructure/stt/`. The orchestrator and presentation
 *      layers don't change.
 *
 * No imports from `effect/Stream` — the start() Effect always
 * fails synchronously, so a Stream would never be observed.
 */

import { Effect, Layer, type Context } from 'effect';
import {
  STTEngine,
  type SttStartOptions,
  type SttUnsupportedError,
} from '~/application/voice/STTEngine';

/**
 * User-facing copy surfaced via `SttUnsupportedError.message`.
 * The presentation layer passes this through to the disabled-FAB
 * tooltip, so it must be actionable. Keep it short and concrete.
 */
const WHISPER_UNSUPPORTED_MESSAGE =
  'Whisper fallback not implemented in MVP — open in Chrome for voice control';

const makeService = (): Context.Tag.Service<typeof STTEngine> => ({
  isSupported: () => Effect.succeed(false),

  start: (_opts: SttStartOptions) =>
    Effect.fail({
      _tag: 'SttUnsupported' as const,
      reason: 'no-speech-api' as const,
      message: WHISPER_UNSUPPORTED_MESSAGE,
    } satisfies SttUnsupportedError),

  stop: () => Effect.void,
});

/**
 * Concrete Layer wiring `WhisperSTTStub` as the system's
 * `STTEngine`. Companion to `WebSpeechSTTLive`; pick one (or
 * compose behind a probe layer) when constructing the AppLayer.
 */
export const WhisperSTTStubLive: Layer.Layer<STTEngine, never, never> = Layer.succeed(
  STTEngine,
  makeService() as never,
);