import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import type { LayerMix } from '~/domain/types';
import { injectMix } from '~/application/useCases/injectMix';
import { evalWithTransport } from '~/application/useCases/evalWithTransport';
import { getPreset } from './presetsStore';
import {
  unlockAudioContext,
  testBeep,
} from '~/infrastructure/audio/LiveAudioEngine';

/**
 * Аудио-действия — общие для всех компонентов (header кнопки, etc).
 * Используют Effect + AppLayer напрямую, без передачи пропсов.
 */

/**
 * Debounce window for live mixer hot-swaps. Tuned against DAW-typical
 * feedback latency (ProTools HW controller ~30ms, Ableton Push ~60ms).
 * Smaller = snappier slider feel, more parse cycles under fast drag.
 * Larger = less CPU but audible lag between drag and sound change.
 *
 * See `math/wavecode-mixer-live-update` packet — empirically tune on
 * iPhone SE if 50ms proves too aggressive.
 */
export const MIX_DEBOUNCE_MS = 50;

let mixTimer: ReturnType<typeof setTimeout> | null = null;
let mixPending: ReadonlyArray<LayerMix> | null = null;

/**
 * Debounce window for grid edit-mode hot-swap. Same value as
 * `MIX_DEBOUNCE_MS` — both are fast UI feedback paths and
 * benefit from the same coalescing window. Smaller = snappier
 * tap feel, more parse cycles during fast taps. Larger = less
 * CPU but audible lag between tap and scheduler update.
 *
 * See `math/wavecode-mixer-live-update` and
 * `math/wavecode-step-grid-modes` packets for trade-off.
 */
export const GRID_EDIT_DEBOUNCE_MS = 50;

let gridEditTimer: ReturnType<typeof setTimeout> | null = null;
let gridEditPendingScore: string | null = null;
let gridEditPendingLayerMix: ReadonlyArray<LayerMix> | null = null;

/**
 * Schedule a debounced grid edit-mode hot-swap. Coalesces fast
 * cell taps in StepGrid edit-mode into a single
 * `AudioEngine.setScore` call after 50ms of silence. Always
 * pushes the LATEST snapshot — taps mid-debounce overwrite
 * earlier captures.
 *
 * Mirrors `scheduleMixLive` exactly. Used by `<StepGrid />` edit
 * mode per-tap.
 */
export const scheduleGridEdit = (
  score: string,
  layerMix: ReadonlyArray<LayerMix>,
): void => {
  gridEditPendingScore = score;
  gridEditPendingLayerMix = layerMix;
  if (gridEditTimer !== null) clearTimeout(gridEditTimer);
  gridEditTimer = setTimeout(() => {
    gridEditTimer = null;
    const pendingScore = gridEditPendingScore;
    const pendingLayerMix = gridEditPendingLayerMix;
    gridEditPendingScore = null;
    gridEditPendingLayerMix = null;
    if (pendingScore === null || pendingLayerMix === null) return;
    void Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.setScore(pendingScore, pendingLayerMix);
      }).pipe(Effect.provide(AppLayer)),
    );
  }, GRID_EDIT_DEBOUNCE_MS);
};

/**
 * Schedule a debounced live mix push. Coalesces fast slider/mute/solo
 * edits into a single `AudioEngine.setLayerMix` call after 50ms of
 * silence. Always pushes the LATEST snapshot — layers mutated mid-debounce
 * overwrite earlier captures (closest to user intent).
 *
 * Companion of `setCps` debounce in `useTransportAudioSync.ts:35`.
 */
export const scheduleMixLive = (
  layerMix: ReadonlyArray<LayerMix>,
): void => {
  mixPending = layerMix;
  if (mixTimer !== null) clearTimeout(mixTimer);
  mixTimer = setTimeout(() => {
    mixTimer = null;
    const snapshot = mixPending;
    mixPending = null;
    if (snapshot === null) return;
    void Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.setLayerMix(snapshot);
      }).pipe(Effect.provide(AppLayer)),
    );
  }, MIX_DEBOUNCE_MS);
};

export const evalScore = async (overrideScore?: string): Promise<void> => {
  const score = overrideScore ?? appStore.score;
  if (!score.trim()) {
    dispatch({ type: 'audioStatusChange', status: 'error', error: 'score is empty' });
    return;
  }
  unlockAudioContext();
  dispatch({ type: 'audioStatusChange', status: 'playing' });
  try {
    await runWrapAndEval(score, appStore.transportState, appStore.layerMix);
  } catch (err) {
    dispatch({
      type: 'audioStatusChange',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Re-evaluate the current score with the *current* mixer + transport wrap,
 * без запуска AudioContext и без dispatch status: playing.
 *
 * Используется из `useTransportAudioSync` при изменении swing-слайдера
 * во время воспроизведения: пользователь уже нажал Play через
 * `evalScore()`, audio engine работает, мы лишь подменяем паттерн.
 * Если swing изменился, а audio context ещё не running — выходит
 * no-op (re-eval не должен будить звук), вызывающий код это обрабатывает.
 *
 * Ошибки не флипают audio status — пользователь не нажимал Play,
 * показывать баннер ошибки здесь неуместно. Логируем и тихо выходим.
 */
export const reEvalScoreWithTransport = async (): Promise<void> => {
  const score = appStore.score;
  if (!score.trim()) return;
  try {
    await runWrapAndEval(score, appStore.transportState, appStore.layerMix);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[wavecode/audioActions.reEvalScoreWithTransport]', msg, err);
  }
};

const runWrapAndEval = async (
  score: string,
  transport: typeof appStore.transportState,
  layerMix: typeof appStore.layerMix,
): Promise<void> => {
  // Mixer side-state: gain/mute/solo — applied at eval time only,
  // never mutates the persisted score.
  const mixed = injectMix(score, layerMix);
  // Transport-side-effects (swing) применяются в обёртке — score
  // остаётся чистым, swing виден только на лету.
  const wrapped = evalWithTransport(mixed, transport);
  await Effect.runPromise(
    Effect.gen(function* () {
      const audio = yield* AudioEngine;
      yield* audio.eval(wrapped);
    }).pipe(Effect.provide(AppLayer)),
  );
};

export const stopAudio = async (): Promise<void> => {
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.stop();
      }).pipe(Effect.provide(AppLayer)),
    );
    dispatch({ type: 'audioStatusChange', status: 'stopped' });
  } catch (err) {
    dispatch({
      type: 'audioStatusChange',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Landing-page preset preview duration. Built-in presets are 1–4 cycles
 * (~2–8 sec at cps=0.5 per `domain/presets.ts:22`), so 8 sec covers the
 * shortest loop with margin and is short enough to keep the landing
 * page snappy. The user can also tap the play button again to stop
 * early; see `stopPreview` / `previewPreset`.
 */
export const PREVIEW_DURATION_MS = 8000;

let previewTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Stop any in-flight preset preview (either auto-stop timer pending
 * or audio actually playing). Safe to call when nothing is playing.
 * No-op for `appStore` audio-status dispatch — preview state is owned
 * by the landing component via the `playingPreviewId` signal.
 */
export const stopPreview = (): void => {
  if (previewTimer !== null) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  // Fire-and-forget — caller's signal flips to null on the next tick
  // and the audio engine will already be muted. `stopAudio` would
  // also flip the global audioStatus to 'stopped', which the editor
  // (if mounted in another tab) might observe — we want preview to
  // NOT touch that store state.
  void Effect.runPromise(
    Effect.gen(function* () {
      const audio = yield* AudioEngine;
      yield* audio.stop();
    }).pipe(Effect.provide(AppLayer)),
  ).catch(() => undefined);
};

/**
 * Evaluate the given preset's score in the live audio engine as a
 * short preview, stopping any preview already in flight first.
 *
 * Unlike `evalScore`, `previewPreset` does NOT write to `appStore`
 * or dispatch `audioStatusChange` — the landing-page UI owns its own
 * `playingPreviewId` signal and the editor must not see its score
 * mutated by an off-route preview. See
 * `decisions/wavecode-landing-preset-preview` for the full rationale.
 *
 * Auto-stops after `PREVIEW_DURATION_MS` so a forgotten tap does not
 * keep playing in the background; the user can also tap the same
 * button again (or another card's button) to stop earlier.
 */
export const previewPreset = async (presetId: string): Promise<void> => {
  const preset = getPreset(presetId);
  if (!preset) {
    console.warn('[wavecode/landing] previewPreset: unknown preset', presetId);
    return;
  }
  // Stop any prior preview so two cards cannot play simultaneously.
  // Note: we call stopPreview BEFORE the new eval — if eval fails the
  // user gets silence rather than the old preview continuing.
  stopPreview();
  // AudioContext must be unlocked inside the user-gesture handler;
  // run it synchronously before any await.
  unlockAudioContext();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.eval(preset.score);
      }).pipe(Effect.provide(AppLayer)),
    );
    // Schedule the auto-stop AFTER a successful eval. If eval throws,
    // no timer is armed and stopPreview() above has already cleared
    // any leftover timer from a previous preview.
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      void Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          yield* audio.stop();
        }).pipe(Effect.provide(AppLayer)),
      ).catch(() => undefined);
    }, PREVIEW_DURATION_MS);
  } catch (err) {
    // Silent: console only — landing-page UI shows its own error via
    // the play/stop button not flipping to "playing".
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[wavecode/landing.previewPreset] eval failed:', msg);
  }
};

export const beep = (hz: number): void => testBeep(hz);

/**
 * Per-sample synthesis recipe for one-shot drum previews.
 *
 * `frequencyHz` is the base pitch: kick is a low thump, snare sits
 * mid-range, hihat lives near Nyquist (square wave → noise-like
 * cymbal), clap is bright sawtooth that aliases into a clap-ish
 * transient.
 *
 * `peakGain` and `wave` are tuned to keep each sample monophonic and
 * short (≤500ms envelope). ADSR is applied as 4 linear ramps:
 *   attack 5ms → 1.0; decay 400ms → 0.1 (sustain floor);
 *   release 100ms → ~0; total ≈ 500ms.
 */
const SAMPLE_RECIPES: Record<
  'bd' | 'sd' | 'hh' | 'cp',
  { frequencyHz: number; wave: OscillatorType; peakGain: number }
> = {
  bd: { frequencyHz: 60, wave: 'triangle', peakGain: 0.85 },
  sd: { frequencyHz: 200, wave: 'sine', peakGain: 0.5 },
  hh: { frequencyHz: 8000, wave: 'square', peakGain: 0.18 },
  cp: { frequencyHz: 1200, wave: 'sawtooth', peakGain: 0.25 },
};

const ATTACK_S = 0.005;
const DECAY_S = 0.4;
const SUSTAIN_LEVEL = 0.1;
const RELEASE_S = 0.1;
const TAIL_PAD_S = 0.02;

/**
 * One-shot drum preview. Plays <500ms of `OscillatorNode + GainNode`
 * directly on the shared `AudioContext` (`__wavecodeAudioCtx`), bypasses
 * `audio.eval` entirely so the loaded Strudel pattern keeps playing
 * unchanged. Used by `<StepGrid />` cell taps — see packet
 * `wavecode-step-append-sync` synthesis (a).
 */
export const previewSample = (sample: 'bd' | 'sd' | 'hh' | 'cp'): void => {
  const audioCtx = unlockAudioContext();
  const recipe = SAMPLE_RECIPES[sample];
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = recipe.wave;
  osc.frequency.setValueAtTime(recipe.frequencyHz, t0);
  // ADSR via linearRampToValueAtTime (per packet): strict ramps, cheap.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(recipe.peakGain, t0 + ATTACK_S);
  gain.gain.linearRampToValueAtTime(recipe.peakGain * SUSTAIN_LEVEL, t0 + ATTACK_S + DECAY_S);
  gain.gain.linearRampToValueAtTime(0.0001, t0 + ATTACK_S + DECAY_S + RELEASE_S);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + ATTACK_S + DECAY_S + RELEASE_S + TAIL_PAD_S);
  osc.onended = (): void => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      /* already disconnected — defensive, jsdom onended can re-fire */
    }
  };
};
