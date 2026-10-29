/**
 * selectSttLayer — composition-root choice of the `STTEngine`
 * implementation. Kept out of `App.tsx` so the rule is testable
 * without rendering the app: the resolution is a pure function of
 * (requested backend, browser capabilities), the DOM probing only
 * feeds it.
 *
 * `VITE_STT_BACKEND`
 *   server (default) — our own whisper relay on angara-1. Works in
 *            every browser, keeps the audio on our infrastructure,
 *            and exposes a live RMS meter (we own the mic stream).
 *   auto   — Web Speech if the constructor exists, with the server
 *            relay as fallback.
 *   web    — Web Speech only, whatever the capabilities say (debug:
 *            see the real cloud error without the fallback hiding it).
 *
 * Anything else in the env var is treated as `server`: a typo must
 * not take the whole voice feature down.
 *
 * Why `server` and not `auto` is the default
 * -----------------------------------------
 * `auto` preferred Web Speech, which cost every single press a fixed
 * penalty before the user heard anything:
 *
 *   1. `resolveSttEngineKind()` returns `web` on any Chrome that has
 *      the constructor — which is most desktops and all Android
 *      Chrome, the platform this feature is actually used from.
 *   2. Chrome's Web Speech does not ship a recogniser. Without
 *      Google speech services behind it the recogniser object starts
 *      fine and then emits nothing, forever.
 *   3. `FallbackSTT` cannot tell "not started yet" from "started and
 *      silent", so it waits out `WATCHDOG_MS` (2.5 s) before it
 *      abandons the primary.
 *   4. Only then does the server relay open the mic, encode, and
 *      answer (2.6-5.2 s measured).
 *
 * Measured on the server: ~8 s of dead air before the first word
 * appeared, on every press. The same transcription through the server
 * relay alone is 2.6-5.2 s, so the fallback chain was buying a
 * ~3 s constant tax plus a class of privacy problem — Chrome ships
 * the microphone audio to Google. That contradicts
 * `AngaraConfig/KB/30_decisions/llm-proxy-audio-route-2026-10-20.md`,
 * whose own comparison table lists Chrome/Web Speech as "есть, но
 * шлёт аудио в Google → Cloud STT — утечка голоса наружу".
 *
 * The fallback chain is not deleted: `auto` and `web` still select
 * it, so anyone who wants to A/B the cloud path can. It is just no
 * longer what a user gets by accident.
 *
 * There is deliberately no `none` in the public backend type. When
 * no engine can work (no MediaRecorder, no getUserMedia) we still
 * hand the app `ServerWhisperSTTLive` — its `isSupported()`
 * returns false, which is exactly how the rest of the app learns to
 * disable the FAB and show a tooltip.
 */

import type { Layer } from 'effect';
import type { STTEngine } from '~/application/voice/STTEngine';
import {
  WebSpeechSTTLive,
  isWebSpeechSTTSupported,
} from './WebSpeechSTT';
import {
  ServerWhisperSTTLive,
  isServerWhisperSTTSupported,
} from './ServerWhisperSTT';
import { fallbackSTTLayer } from './FallbackSTT';

export type SttBackend = 'auto' | 'web' | 'server';

export const parseSttBackend = (
  raw: string | undefined,
): SttBackend => {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'web' || value === 'auto' || value === 'server'
    ? value
    : 'server';
};

export type SttCapabilities = {
  readonly web: boolean;
  readonly server: boolean;
};

/** Which engine a resolved backend maps to. `none` never reaches the
 *  app — see the header — but keeping it here makes the decision
 *  table complete and testable. */
export const resolveSttEngine = (
  backend: SttBackend,
  caps: SttCapabilities,
): 'web' | 'server' | 'none' => {
  if (backend === 'web') return caps.web ? 'web' : 'none';
  if (backend === 'server') return caps.server ? 'server' : 'none';
  if (caps.web) return 'web';
  if (caps.server) return 'server';
  return 'none';
};

/** Which engine this browser will actually use. Exported so the
 *  presentation layer can claim the right mic channel: the server
 *  engine calls `getUserMedia` itself (mic-direct), the Web Speech
 *  engine lets Chrome own the mic (speech-api-internal). */
export const resolveSttEngineKind = (): 'web' | 'server' | 'none' => {
  const backend = parseSttBackend(
    import.meta.env.VITE_STT_BACKEND as string | undefined,
  );
  return resolveSttEngine(backend, {
    web: isWebSpeechSTTSupported(),
    server: isServerWhisperSTTSupported(),
  });
};

export const selectSttLayer = (): Layer.Layer<STTEngine, never, never> => {
  const backend = parseSttBackend(
    import.meta.env.VITE_STT_BACKEND as string | undefined,
  );
  const engine = resolveSttEngineKind();
  if (engine === 'web') {
    return backend === 'auto'
      ? fallbackSTTLayer(WebSpeechSTTLive, ServerWhisperSTTLive)
      : WebSpeechSTTLive;
  }
  return ServerWhisperSTTLive;
};