import {
  For, Show, createSignal, onCleanup, onMount, createEffect, batch,
  type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import { appStore } from '../state/appStore';
import { getAnalyserNode } from '~/infrastructure/audio/LiveAudioEngine';
import type { NoteEvent } from '~/domain/midi/encoder';
import {
  defaultMidiBounds, layerColor, lerpColor, projectNote,
} from './visualizerHelpers';

type Mode = 'spectrum' | 'waveform';

const SPECTRUM_BARS = 48;
const COMPILE_DEBOUNCE_MS = 350;

/**
 * VisualizerPanel — звуковая визуализация для wavecode.
 *
 * Две секции:
 *   1. Track overview (SVG, 100% ширина, ~150px) — статичная карта
 *      всего цикла: каждый NoteEvent = цветной блок
 *      (x = startCycle, y = midi, w = duration, fill = channel/layer).
 *      Сверху бежит playhead, синхронизированный с audio clock.
 *   2. Live scope (canvas, ~140px) — реальный FFT-эквалайзер или
 *      time-domain waveform, читаемый из AnalyserNode
 *      (`__wavecodeAnalyser`), установленного в LiveAudioEngine.
 *
 * NoteEvent-ы получаются через `AudioEngine.compileAndQuery` (тот же
 * пайплайн, что использует MIDI-экспорт) — debounced 350ms от score.
 * Это НЕ отдельный preview, это тот же Pattern.parse → queryArc.
 *
 * Playhead: RAF-цикл опрашивает `getCycleProgress` каждые ~30ms (не
 * каждый кадр, чтобы не заспамить Effect-ы) и обновляет CSS
 * transform на .playhead. Эффект переиспользует ту же логику, что
 * TransportPanel, так что позиция playhead идентична с индикатором
 * в Transport.
 *
 * Design packet: `math/visualizer-tab`.
 */
export function VisualizerPanel(): JSX.Element {
  const [mode, setMode] = createSignal<Mode>('spectrum');
  const [events, setEvents] = createSignal<ReadonlyArray<NoteEvent>>([]);
  const [analyserReady, setAnalyserReady] = createSignal(false);
  const [playhead, setPlayhead] = createSignal(0);

  // Wait for AnalyserNode to be created by unlockAudioContext.
  // First load: analyser is created on the first play() press; until
  // then we render a helpful empty state.
  onMount(() => {
    const probe = (): void => {
      if (getAnalyserNode()) {
        setAnalyserReady(true);
        return;
      }
      window.setTimeout(probe, 200);
    };
    probe();
  });

  // Debounced compileAndQuery on score change. Resets to [] on empty
  // score so the empty state renders without flicker.
  let compileTimer: number | undefined;
  createEffect(() => {
    const score = appStore.score;
    if (compileTimer !== undefined) window.clearTimeout(compileTimer);
    if (!score.trim()) {
      setEvents([]);
      return;
    }
    compileTimer = window.setTimeout(() => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* AudioEngine;
          return yield* engine.compileAndQuery(score, 1);
        }).pipe(Effect.provide(AppLayer)),
      ).then((evts) => {
        setEvents(evts);
      }).catch(() => {
        // parse failures land here — keep the previous track overview
        // on screen rather than wipe it (matches `eval` UX in
        // ScorePanel which also shows stale text on eval error).
      });
    }, COMPILE_DEBOUNCE_MS);
  });
  onCleanup(() => {
    if (compileTimer !== undefined) window.clearTimeout(compileTimer);
  });

  // RAF loop: poll cycle progress, drive live-scope canvas. Shared
  // because the same RAF also updates the playhead CSS — saves a
  // second timer.
  let rafId: number | null = null;
  let liveCanvas: HTMLCanvasElement | undefined;
  let trackHost: HTMLDivElement | undefined;
  let lastWrite = 0;

  const readProgress = async (): Promise<number> => {
    try {
      return await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          return yield* audio.getCycleProgress();
        }).pipe(Effect.provide(AppLayer)),
      );
    } catch {
      return 0;
    }
  };

  const drawScope = (now: number): void => {
    const canvas = liveCanvas;
    if (!canvas) return;
    const analyser = getAnalyserNode();
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const targetW = Math.max(1, Math.floor(cssW * dpr));
    const targetH = Math.max(1, Math.floor(cssH * dpr));
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!analyser) {
      drawIdleScope(ctx, cssW, cssH);
      return;
    }
    if (mode() === 'spectrum') {
      drawSpectrum(ctx, cssW, cssH, analyser);
    } else {
      drawWaveform(ctx, cssW, cssH, analyser);
    }
    // FPS readout (every ~30 frames, micro-budget)
    if (now - lastWrite > 250) {
      lastWrite = now;
      // no-op — the FPS HUD is drawn from the playhead effect for cheaper
      // React-less updates. The current "now" is consumed to keep timing.
    }
  };

  const loop = (now: number): void => {
    // Throttle: read progress at most every ~30ms; canvas draws every frame.
    if (now - lastReadMs > 30) {
      lastReadMs = now;
      void readProgress().then((p) => {
        const clamped = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
        batch(() => {
          setPlayhead(clamped);
          if (trackHost) {
            trackHost.style.setProperty('--playhead-x', `${clamped * 100}%`);
          }
        });
      });
    }
    drawScope(now);
    rafId = requestAnimationFrame(loop);
  };
  let lastReadMs = 0;

  onMount(() => {
    rafId = requestAnimationFrame(loop);
  });
  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

  return (
    <div class="visualizer-panel" data-mode={mode()}>
      <header class="visualizer-header">
        <div class="visualizer-header__title">
          <span class="visualizer-header__dot" aria-hidden="true" />
          <span>Визуализация</span>
        </div>
        <div class="visualizer-header__modes" role="tablist" aria-label="Режим эквалайзера">
          <button
            type="button"
            role="tab"
            data-active={mode() === 'spectrum'}
            aria-selected={mode() === 'spectrum'}
            onClick={() => setMode('spectrum')}
            class="visualizer-mode-btn"
          >
            Эквалайзер
          </button>
          <button
            type="button"
            role="tab"
            data-active={mode() === 'waveform'}
            aria-selected={mode() === 'waveform'}
            onClick={() => setMode('waveform')}
            class="visualizer-mode-btn"
          >
            Волна
          </button>
        </div>
      </header>

      <section
        class="visualizer-track"
        ref={trackHost}
        aria-label="Карта цикла"
      >
        <div class="visualizer-track__grid" aria-hidden="true">
          <span data-pos="0" />
          <span data-pos="0.25" />
          <span data-pos="0.5" />
          <span data-pos="0.75" />
          <span data-pos="1" />
        </div>
        <Show
          when={events().length > 0}
          fallback={
            <div class="visualizer-track__empty">
              нет событий — нажми ▶, чтобы оценить партитуру
            </div>
          }
        >
          <TrackSvg events={events()} />
        </Show>
        <div
          class="visualizer-track__playhead"
          data-active={analyserReady() ? 'true' : 'false'}
          style={{ '--playhead-x': `${playhead() * 100}%` }}
        />
      </section>

      <section class="visualizer-scope" aria-label="Анализ сигнала">
        <Show
          when={analyserReady()}
          fallback={
            <div class="visualizer-scope__empty">
              запусти воспроизведение, чтобы видеть анализ
            </div>
          }
        >
          <canvas
            class="visualizer-scope__canvas"
            ref={liveCanvas}
            data-mode={mode()}
            aria-label={mode() === 'spectrum' ? 'Эквалайзер' : 'Осциллограмма'}
          />
        </Show>
      </section>
    </div>
  );
}

const drawIdleScope = (
  ctx: CanvasRenderingContext2D, w: number, h: number,
): void => {
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, h / 2 - 0.5, w, 1);
};

const drawSpectrum = (
  ctx: CanvasRenderingContext2D, w: number, h: number, analyser: AnalyserNode,
): void => {
  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const barCount = Math.min(SPECTRUM_BARS, bins.length);
  if (barCount <= 0) return;
  const gap = 2;
  const barW = Math.max(2, (w - gap * (barCount - 1)) / barCount);
  const lowColor = 'hsl(252 75% 60%)';
  const highColor = 'hsl(174 80% 55%)';
  for (let i = 0; i < barCount; i++) {
    // Average the FFT bins covered by this bar to smooth vertical
    // jitter without losing peaks. Perceptual (sqrt) scale on the
    // bin index puts more bars on the bass end where the ear is
    // most sensitive.
    const t0 = (i / barCount) ** 1.6;
    const t1 = ((i + 1) / barCount) ** 1.6;
    const i0 = Math.floor(t0 * bins.length);
    const i1 = Math.max(i0 + 1, Math.floor(t1 * bins.length));
    let sum = 0;
    let n = 0;
    for (let k = i0; k < i1 && k < bins.length; k++) {
      const v = bins[k];
      if (v === undefined) continue;
      sum += v;
      n++;
    }
    const v = n > 0 ? sum / n / 255 : 0;
    const barH = Math.max(2, v * h);
    const x = i * (barW + gap);
    const y = h - barH;
    const color = lerpColor(i / Math.max(1, barCount - 1), lowColor, highColor);
    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);
  }
};

const drawWaveform = (
  ctx: CanvasRenderingContext2D, w: number, h: number, analyser: AnalyserNode,
): void => {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  const mid = h / 2;
  // Centerline
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, mid - 0.5, w, 1);
  // Mirror waveform: byte 128 = silence, 0..127 below, 129..255 above.
  ctx.strokeStyle = 'hsl(252 80% 70%)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / w));
  for (let i = 0; i < w; i++) {
    const k = Math.min(data.length - 1, i * step);
    const sample = data[k] ?? 128;
    const v = (sample - 128) / 128; // -1..1
    const y = mid - v * (h * 0.45);
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
  // Soft glow underlay (re-stroke with low alpha, wider line)
  ctx.strokeStyle = 'hsla(252, 80%, 70%, 0.18)';
  ctx.lineWidth = 4;
  ctx.stroke();
};

const TrackSvg = (props: { events: ReadonlyArray<NoteEvent> }): JSX.Element => {
  const bounds = (): { lo: number; hi: number } => defaultMidiBounds(props.events);
  const projected = (): ReadonlyArray<NonNullable<ReturnType<typeof projectNote>>> => {
    const { lo, hi } = bounds();
    const out: Array<NonNullable<ReturnType<typeof projectNote>>> = [];
    for (const e of props.events) {
      const p = projectNote(e, {
        viewportW: 1000,
        viewportH: 100,
        midiLo: lo,
        midiHi: hi,
        cycleStart: 0,
        cycleEnd: 1,
      });
      if (p) out.push(p);
    }
    return out;
  };
  return (
    <svg
      class="visualizer-track__svg"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={`События цикла: ${props.events.length}`}
    >
      <For each={projected()}>
        {(p) => (
          <rect
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            rx={1.2}
            ry={1.2}
            fill={p.fill}
            opacity={0.92}
          >
            <title>
              midi {p.midi} · ch {p.channel}
            </title>
          </rect>
        )}
      </For>
    </svg>
  );
};

// Re-export layerColor so the styles can be derived from JS if needed.
export { layerColor };
