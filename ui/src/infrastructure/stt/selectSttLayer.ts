/**
 * selectSttLayer — composition-root choice of the `STTEngine`
 * implementation. Kept out of `App.tsx` so the rule is testable
 * without rendering the app: the resolution is a pure function of
 * (requested backend, browser capabilities), the DOM probing only
 * feeds it.
 *
 * `VITE_STT_BACKEND`
 *   auto   (default) — Web Speech if the constructor exists, else the
 *            server relay. In `auto` + Web Speech the layer is
 *            wrapped in `fallbackSTTLayer`, so an Android Chrome
 *            that has the API but no speech services behind it
 *            degrades to the server instead of dying.
 *   web    — Web Speech only, whatever the capabilities say (debug:
 *            see the real cloud error without the fallback hiding it).
 *   server — server relay only (debug: compare transcripts).
 *
 * Anything else in the env var is treated as `auto`: a typo must not
 * take the whole voice feature down.
 *
 * There is deliberately no `none` in the public backend type. When
 * neither engine can work (no MediaRecorder, no getUserMedia) we
 * still hand the app `ServerWhisperSTTLive` — its `isSupported()`
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
  return value === 'web' || value === 'server' ? value : 'auto';
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