import {
  Show, createSignal, onCleanup, onMount, createEffect, createMemo, batch,
  type JSX,
} from 'solid-js';
import { Effect } from 'effect';
import { AudioEngine } from '~/domain/services';
import { AppLayer } from '~/infrastructure/composition';
import { appStore } from '../state/appStore';
import { getAnalyserNode, getDebug } from '~/infrastructure/audio/LiveAudioEngine';
import type { NoteEvent } from '~/domain/midi/encoder';
import {
  bandHue, bandLevel, channelColor, computeLayerActivity, cpsToBpm,
  defaultMidiBounds, perceptual, pickBarCount,
  radialBar, smooth, updatePeakHold,
} from './visualizerHelpers';

type Mode = 'spectrum' | 'wave' | 'radial' | 'beat';

const COMPILE_DEBOUNCE_MS = 350;
const FFT_SIZE = 1024;
const SAMPLE_RATE_FALLBACK = 44100;
const RIBBON_COLUMNS = 64;
const MAX_RIBBON_LAYERS = 6;

/**
 * VisualizerPanel — звуковая визуализация для wavecode.
 *
 * Четыре режима canvas-scope, переключаются в шапке:
 *   - spectrum: FFT-бары с glow + peak-hold точками и трёхцветным
 *     градиентом (gold → violet → cyan, по диапазонам bass/mid/treble);
 *   - wave: зеркальная осциллограмма с glow, центральной линией и
 *     лёгким "хвостом" предыдущего кадра;
 *   - radial: полярные бары (кольцо 64 сегментов), вращаются на bass;
 *   - beat: 3 концентрических кольца пульсируют на bass + тонкий
 *     спектр по краю.
 *
 * Поверх: бегущий playhead на track-overview, и band-meters
 * (bass/mid/treble) под canvas. Уровень bass одновременно
 * подмешивается в CSS var `--beat-energy` на корне панели —
 * внешний glow "дышит" в такт kick/snare.
 *
 * Beat energy / cps читаются с частотой 60 fps через RAF.
 * NoteEvent-ы для track overview — debounced compileAndQuery
 * (тот же пайплайн, что MIDI-экспорт). See math/visualizer-tab.
 */
export function VisualizerPanel(): JSX.Element {
  const [mode, setMode] = createSignal<Mode>('spectrum');
  const [events, setEvents] = createSignal<ReadonlyArray<NoteEvent>>([]);
  const [analyserReady, setAnalyserReady] = createSignal(false);
  const [playhead, setPlayhead] = createSignal(0);
  const [activeMidis, setActiveMidis] = createSignal<ReadonlySet<number>>(new Set());
  const [beatEnergy, setBeatEnergy] = createSignal(0);
  const [bandLevels, setBandLevels] = createSignal<{ bass: number; mid: number; treble: number }>({
    bass: 0, mid: 0, treble: 0,
  });
  const [cps, setCps] = createSignal(0);

  // Wait for AnalyserNode to be created by unlockAudioContext.
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

  // Debounced compileAndQuery on score change.
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
      ).then((evts) => { setEvents(evts); })
       .catch(() => { /* keep stale events on parse failure */ });
    }, COMPILE_DEBOUNCE_MS);
  });
  onCleanup(() => {
    if (compileTimer !== undefined) window.clearTimeout(compileTimer);
  });

  let rafId: number | null = null;
  let liveCanvas: HTMLCanvasElement | undefined;
  let trackHost: HTMLDivElement | undefined;
  let panelHost: HTMLDivElement | undefined;

  // Smoothed bass for the beat pulse (fast attack, slow release).
  let beatState = 0;

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

  const readActiveHaps = async (): Promise<ReadonlyArray<{ readonly midi: number }>> => {
    try {
      return await Effect.runPromise(
        Effect.gen(function* () {
          const audio = yield* AudioEngine;
          return yield* audio.getActiveHaps();
        }).pipe(Effect.provide(AppLayer)),
      );
    } catch {
      return [];
    }
  };

  const drawScope = (): void => {
    const canvas = liveCanvas;
    if (!canvas) return;
    const analyser = getAnalyserNode();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const targetW = Math.max(1, Math.floor(cssW * dpr));
    const targetH = Math.max(1, Math.floor(cssH * dpr));
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Trail effect: don't fully clear — draw a translucent black
    // rect over the previous frame. Gives wave/radial a smear
    // feel without re-drawing every bar's history explicitly.
    if (mode() === 'wave' || mode() === 'beat') {
      ctx.fillStyle = 'rgba(10, 10, 14, 0.32)';
      ctx.fillRect(0, 0, cssW, cssH);
    } else {
      ctx.clearRect(0, 0, cssW, cssH);
    }
    if (!analyser) {
      drawIdle(ctx, cssW, cssH);
      return;
    }
    const sr = analyser.context.sampleRate || SAMPLE_RATE_FALLBACK;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    const bass = bandLevel(bins, 20, 220, sr, FFT_SIZE);
    const mid = bandLevel(bins, 220, 2000, sr, FFT_SIZE);
    const treble = bandLevel(bins, 2000, 8000, sr, FFT_SIZE);
    setBandLevels({ bass, mid, treble });

    // Beat pulse: fast attack, slow release. Used to drive the
    // panel-wide glow CSS var so the whole UI "breathes" on kick/snare.
    const targetBeat = perceptual(bass, 0.55);
    if (targetBeat > beatState) {
      beatState = smooth(beatState, targetBeat, 0.45);
    } else {
      beatState = smooth(beatState, targetBeat, 0.06);
    }
    setBeatEnergy(beatState);

    switch (mode()) {
      case 'spectrum': drawSpectrum(ctx, cssW, cssH, bins); break;
      case 'wave':     drawWave(ctx, cssW, cssH, analyser); break;
      case 'radial':   drawRadial(ctx, cssW, cssH, bins, sr);   break;
      case 'beat':     drawBeat(ctx, cssW, cssH, bins, sr);     break;
    }
  };

  let lastReadMs = 0;
  const loop = (now: number): void => {
    if (now - lastReadMs > 30) {
      lastReadMs = now;
      void readProgress().then((p) => {
        const clamped = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
        batch(() => {
          setPlayhead(clamped);
          setCps(getDebug().evalCps || 0);
          if (trackHost) {
            trackHost.style.setProperty('--playhead-x', `${clamped * 100}%`);
          }
          if (panelHost) {
            panelHost.style.setProperty('--beat-energy', beatEnergy().toFixed(3));
            panelHost.style.setProperty('--beat-bpm', String(cpsToBpm(getDebug().evalCps || 0)));
          }
        });
      });
      // Poll active haps in the same tick — data only changes on
      // note onsets, so even a 30ms poll is more than enough.
      void readActiveHaps().then((haps) => {
        setActiveMidis(new Set(haps.map((h) => h.midi)));
      });
    }
    drawScope();
    rafId = requestAnimationFrame(loop);
  };

  onMount(() => {
    rafId = requestAnimationFrame(loop);
  });
  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

  return (
    <div
      class="visualizer-panel"
      data-mode={mode()}
      ref={panelHost}
      style={{ '--beat-energy': '0', '--beat-bpm': '0' }}
    >
      <header class="visualizer-header">
        <div class="visualizer-header__title">
          <span class="visualizer-header__dot" aria-hidden="true" />
          <span>Визуализация</span>
          <span class="visualizer-header__bpm" data-active={cps() > 0 ? 'true' : 'false'}>
            {cps() > 0 ? `${cpsToBpm(cps())} BPM` : '— BPM'}
          </span>
        </div>
        <div class="visualizer-header__modes" role="tablist" aria-label="Режим визуализации">
          <ModeButton id="spectrum" current={mode()} onSelect={setMode} label="EQ" />
          <ModeButton id="wave"     current={mode()} onSelect={setMode} label="Волна" />
          <ModeButton id="radial"   current={mode()} onSelect={setMode} label="Круг" />
          <ModeButton id="beat"     current={mode()} onSelect={setMode} label="Пульс" />
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
              <div class="visualizer-track__empty-pulse" aria-hidden="true" />
              нет событий — нажми ▶ Play, чтобы оценить партитуру
            </div>
          }
        >
          <TrackCanvas
            events={events()}
            activeMidis={activeMidis()}
            playhead={playhead()}
            analyserReady={analyserReady()}
            beatEnergy={beatEnergy()}
          />
        </Show>
      </section>

      <section class="visualizer-scope" aria-label="Анализ сигнала">
        <Show
          when={analyserReady()}
          fallback={
            <div class="visualizer-scope__empty">
              <div class="visualizer-scope__empty-orbit" aria-hidden="true">
                <span /><span /><span />
              </div>
              <div class="visualizer-scope__empty-label">
                нажми <kbd>▶</kbd> Play, чтобы запустить анализ
              </div>
            </div>
          }
        >
          <canvas
            class="visualizer-scope__canvas"
            ref={liveCanvas}
            data-mode={mode()}
            aria-label={MODE_LABELS[mode()]}
          />
          <div
            class="visualizer-scope__glow"
            data-energy={beatEnergy().toFixed(2)}
          />
        </Show>
      </section>

      <section class="visualizer-bands" aria-label="Уровни по диапазонам">
        <BandMeter label="bass"   level={bandLevels().bass}   color="hsl(42 95% 60%)" />
        <BandMeter label="mid"    level={bandLevels().mid}    color="hsl(252 75% 65%)" />
        <BandMeter label="treble" level={bandLevels().treble} color="hsl(174 80% 55%)" />
      </section>

      <footer class="visualizer-stats">
        <span>{events().length} событий</span>
        <span class="visualizer-stats__sep">·</span>
        <span>{mode() === 'spectrum' ? 'эквалайзер' : mode() === 'wave' ? 'осциллограмма' : mode() === 'radial' ? 'полярные бары' : 'пульс на bass'}</span>
        <Show when={analyserReady()}>
          <span class="visualizer-stats__sep">·</span>
          <span class="visualizer-stats__live" data-live="true">live</span>
        </Show>
      </footer>
    </div>
  );
}

const MODE_LABELS: Record<Mode, string> = {
  spectrum: 'Эквалайзер',
  wave: 'Осциллограмма',
  radial: 'Полярные бары',
  beat: 'Пульс на bass',
};

const ModeButton = (props: {
  id: Mode;
  current: Mode;
  onSelect: (m: Mode) => void;
  label: string;
}): JSX.Element => (
  <button
    type="button"
    role="tab"
    data-active={props.current === props.id ? 'true' : 'false'}
    aria-selected={props.current === props.id}
    onClick={() => props.onSelect(props.id)}
    class="visualizer-mode-btn"
  >
    {props.label}
  </button>
);

const BandMeter = (props: {
  label: string;
  level: number;
  color: string;
}): JSX.Element => (
  <div class="visualizer-band">
    <span class="visualizer-band__label">{props.label}</span>
    <div class="visualizer-band__track">
      <div
        class="visualizer-band__fill"
        style={{
          width: `${Math.round(Math.max(0, Math.min(1, props.level)) * 100)}%`,
          background: `linear-gradient(90deg, ${props.color}, ${props.color})`,
          'box-shadow': `0 0 8px ${props.color}`,
        }}
      />
    </div>
    <span class="visualizer-band__value">
      {Math.round(Math.max(0, Math.min(1, props.level)) * 100)}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
//  Canvas renderers
// ---------------------------------------------------------------------------

/** Per-render peak-hold buffer + decay constant — declared at module
 *  scope so the spectrum bars can keep persistent state across frames
 *  without round-tripping through the React/Solid signal machinery. */
const peaksBuf: Float32Array = new Float32Array(96);
const PEAK_DECAY_PER_FRAME = 0.012;

const drawIdle = (
  ctx: CanvasRenderingContext2D, w: number, h: number,
): void => {
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, h / 2 - 0.5, w, 1);
};

const drawSpectrum = (
  ctx: CanvasRenderingContext2D, w: number, h: number,
  bins: Uint8Array,
): void => {
  const barCount = pickBarCount(w);
  const gap = Math.max(1, Math.floor(w / barCount / 4));
  const barW = Math.max(2, (w - gap * (barCount - 1)) / barCount);
  const values = new Float32Array(barCount);
  for (let i = 0; i < barCount; i++) {
    const t0 = (i / barCount) ** 1.6;
    const t1 = ((i + 1) / barCount) ** 1.6;
    const i0 = Math.floor(t0 * bins.length);
    const i1 = Math.max(i0 + 1, Math.floor(t1 * bins.length));
    let sum = 0;
    let n = 0;
    for (let k = i0; k < i1 && k < bins.length; k++) {
      const v = bins[k] ?? 0;
      sum += v;
      n++;
    }
    values[i] = n > 0 ? (sum / n) / 255 : 0;
  }
  // Peak-hold buffer is sized to the largest expected bar count.
  // Trim to barCount for the current frame.
  const trimmedPeaks = peaksBuf.subarray(0, barCount);
  const peaksNext = updatePeakHold(trimmedPeaks, values, PEAK_DECAY_PER_FRAME);
  peaksBuf.set(peaksNext);
  for (let i = 0; i < barCount; i++) {
    const v = values[i] ?? 0;
    const t = i / Math.max(1, barCount - 1);
    const color = bandHue(t);
    const barH = Math.max(2, v * h);
    const x = i * (barW + gap);
    const y = h - barH;
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, withAlpha(color, 0.08));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);
    const peakV = peaksBuf[i] ?? 0;
    if (peakV > 0.04) {
      const peakY = h - peakV * h;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + barW / 2, peakY, Math.max(1.5, barW / 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

const drawWave = (
  ctx: CanvasRenderingContext2D, w: number, h: number, analyser: AnalyserNode,
): void => {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  const mid = h / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, mid - 0.5, w, 1);
  ctx.strokeStyle = 'hsl(252 80% 70%)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / w));
  for (let i = 0; i < w; i++) {
    const k = Math.min(data.length - 1, i * step);
    const sample = data[k] ?? 128;
    const v = (sample - 128) / 128;
    const y = mid - v * (h * 0.45);
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'hsla(252, 80%, 70%, 0.18)';
  ctx.lineWidth = 5;
  ctx.stroke();
};

const drawRadial = (
  ctx: CanvasRenderingContext2D, w: number, h: number,
  bins: Uint8Array, sr: number,
): void => {
  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.min(w, h) / 2 - 6;
  const innerR = Math.max(20, outerR * 0.22);
  const segCount = 64;
  for (let i = 0; i < segCount; i++) {
    const t0 = (i / segCount) ** 1.3;
    const t1 = ((i + 1) / segCount) ** 1.3;
    const i0 = Math.floor(t0 * bins.length);
    const i1 = Math.max(i0 + 1, Math.floor(t1 * bins.length));
    let sum = 0;
    let n = 0;
    for (let k = i0; k < i1 && k < bins.length; k++) {
      const v = bins[k] ?? 0;
      sum += v;
      n++;
    }
    const v = n > 0 ? perceptual((sum / n) / 255, 0.8) : 0;
    const seg = radialBar(i / segCount, v, cx, cy, innerR, outerR);
    const color = bandHue(i / segCount);
    ctx.strokeStyle = withAlpha(color, 0.22);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
  }
  const bass = bandLevel(bins, 20, 220, sr, FFT_SIZE);
  const pulseR = innerR * (0.7 + bass * 0.5);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
  grad.addColorStop(0, withAlpha('hsl(252 80% 70%)', 0.4 + bass * 0.4));
  grad.addColorStop(1, withAlpha('hsl(252 80% 70%)', 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
  ctx.fill();
};

const drawBeat = (
  ctx: CanvasRenderingContext2D, w: number, h: number,
  bins: Uint8Array, sr: number,
): void => {
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 6;
  const bass = bandLevel(bins, 20, 220, sr, FFT_SIZE);
  const beat = perceptual(bass, 0.6);
  const ringSpeeds: ReadonlyArray<number> = [0, 0.15, 0.3];
  for (let r = 0; r < 3; r++) {
    const phase = (beat + (ringSpeeds[r] ?? 0)) % 1;
    const radius = phase * maxR;
    if (radius < 4) continue;
    const alpha = (1 - phase) * 0.55;
    ctx.strokeStyle = `hsla(252, 80%, 70%, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  const coreR = 16 + beat * 26;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  grad.addColorStop(0, withAlpha('hsl(252 90% 75%)', 0.6 + beat * 0.3));
  grad.addColorStop(1, withAlpha('hsl(252 90% 75%)', 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
  const segCount = 64;
  for (let i = 0; i < segCount; i++) {
    const t0 = (i / segCount) ** 1.4;
    const t1 = ((i + 1) / segCount) ** 1.4;
    const i0 = Math.floor(t0 * bins.length);
    const i1 = Math.max(i0 + 1, Math.floor(t1 * bins.length));
    let sum = 0;
    let n = 0;
    for (let k = i0; k < i1 && k < bins.length; k++) {
      const v = bins[k] ?? 0;
      sum += v;
      n++;
    }
    const v = n > 0 ? (sum / n) / 255 : 0;
    const angle = -Math.PI / 2 + (i / segCount) * Math.PI * 2;
    const r1 = maxR - 8;
    const r2 = maxR - 8 - v * 18;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    ctx.strokeStyle = withAlpha(bandHue(i / segCount), 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + cosA * r2, cy + sinA * r2);
    ctx.lineTo(cx + cosA * r1, cy + sinA * r1);
    ctx.stroke();
  }
};

/** Inject alpha into an `hsl(H S% L%)` color → `hsla(H S% L% / a)`. */
const withAlpha = (hsl: string, alpha: number): string => {
  const m = hsl.match(/^hsl\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)$/);
  if (!m) return hsl;
  return `hsla(${m[1]} ${m[2]}% ${m[3]}% / ${alpha.toFixed(3)})`;
};

// ---------------------------------------------------------------------------
//  Track overview (canvas) — activity ribbons + piano roll + active glow
// ---------------------------------------------------------------------------

const RIBBON_VIEW_W = 1000;
const RIBBON_VIEW_H = 130;

type TrackProps = {
  events: ReadonlyArray<NoteEvent>;
  activeMidis: ReadonlySet<number>;
  playhead: number;
  analyserReady: boolean;
  beatEnergy: number;
};

const TrackCanvas = (props: TrackProps): JSX.Element => {
  let canvas: HTMLCanvasElement | undefined;

  // Cached: per-event projection. Recomputed only when `events` changes,
  // not every RAF tick. Drawing still happens every frame for active-note
  // glow + playhead, but the expensive pre-compute is one-shot.
  const cached = createMemo(() => {
    const events = props.events;
    const layers = computeLayerActivity(events, RIBBON_COLUMNS, MAX_RIBBON_LAYERS);
    const bounds = defaultMidiBounds(events);
    const notes: Array<{
      x: number; y: number; w: number; h: number;
      midi: number; channel: number; velocity: number;
      startCycle: number; endCycle: number;
    }> = [];
    const midiRange = Math.max(1, bounds.hi - bounds.lo);
    for (const e of events) {
      const x0 = e.startCycle * RIBBON_VIEW_W;
      const x1 = e.endCycle * RIBBON_VIEW_W;
      if (x1 < 0 || x0 > RIBBON_VIEW_W) continue;
      const slotH = 1;
      const h = Math.max(0.5, (e.velocity / 127) * slotH);
      const y = ((bounds.hi - e.midi) / midiRange) * 100;
      notes.push({
        x: x0, y, w: Math.max(1, x1 - x0), h,
        midi: e.midi, channel: e.channel, velocity: e.velocity,
        startCycle: e.startCycle, endCycle: e.endCycle,
      });
    }
    return { layers, bounds, notes };
  });

  const draw = (): void => {
    const c = canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const targetW = Math.max(1, Math.floor(cssW * dpr));
    const targetH = Math.max(1, Math.floor(cssH * dpr));
    if (c.width !== targetW) c.width = targetW;
    if (c.height !== targetH) c.height = targetH;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const scaleX = cssW / RIBBON_VIEW_W;
    const scaleY = cssH / RIBBON_VIEW_H;
    const { layers, notes } = cached();

    // 1. Layer ribbons (top zone, divided equally).
    const ribbonZone = Math.max(20, layers.length * 14);
    const ribbonH = layers.length > 0 ? ribbonZone / layers.length : 0;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      drawRibbon(ctx, layer, 0, i * ribbonH, RIBBON_VIEW_W, ribbonH, scaleX, scaleY);
    }

    // Separator between ribbons and piano roll.
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, ribbonZone * scaleY, cssW, 1);

    // 2. Piano roll (bottom zone).
    const rollTop = ribbonZone;
    const rollH = RIBBON_VIEW_H - ribbonZone;
    const rollScaleY = rollH / 100;
    const active = props.activeMidis;
    for (const n of notes) {
      const nx = n.x * scaleX;
      const ny = (rollTop + n.y) * scaleY;
      const nw = Math.max(1, n.w * scaleX);
      const nh = Math.max(1.5, n.h * scaleY * rollScaleY);
      const fill = channelColor(n.channel);
      const isActive = active.has(n.midi)
        && props.playhead >= n.startCycle
        && props.playhead < n.endCycle;
      const baseAlpha = 0.55 + (n.velocity / 127) * 0.35;
      ctx.fillStyle = withAlpha(fill, baseAlpha);
      ctx.fillRect(nx, ny, nw, nh);
      if (isActive) {
        // Brighter fill on top of base.
        ctx.fillStyle = fill;
        ctx.fillRect(nx, ny, nw, nh);
        // White outline ring.
        ctx.strokeStyle = withAlpha('#ffffff', 0.9);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(nx - 0.5, ny - 0.5, nw + 1, nh + 1);
        // Vertical light beam from the note up to the ribbon zone.
        const beamH = (rollTop * scaleY) - ny;
        if (beamH > 4) {
          const beamGrad = ctx.createLinearGradient(0, ny, 0, ny + beamH);
          beamGrad.addColorStop(0, withAlpha(fill, 0.45));
          beamGrad.addColorStop(1, withAlpha(fill, 0));
          ctx.fillStyle = beamGrad;
          ctx.fillRect(nx, ny, nw, beamH);
        }
      }
    }

    // 3. Playhead (full-height vertical line + head dot).
    const px = props.playhead * cssW;
    const alpha = props.analyserReady ? 0.9 : 0.18;
    ctx.fillStyle = withAlpha('hsl(252, 80%, 70%)', alpha * 0.25);
    ctx.fillRect(px - 3, 0, 6, cssH);
    ctx.fillStyle = withAlpha('#ffffff', alpha);
    ctx.fillRect(px - 0.5, 0, 1.5, cssH);
    ctx.fillStyle = withAlpha('hsl(252, 80%, 70%)', alpha);
    ctx.beginPath();
    ctx.arc(px, 4, 3, 0, Math.PI * 2);
    ctx.fill();
  };

  onMount(() => {
    let raf = 0;
    const loop = (): void => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <canvas
      class="visualizer-track__canvas"
      ref={canvas}
      aria-label={`Карта цикла: ${props.events.length} событий, ${cached().layers.length} слоёв`}
    />
  );
};

const drawRibbon = (
  ctx: CanvasRenderingContext2D,
  layer: { color: string; bars: ReadonlyArray<number>; layer: number },
  x: number, y: number, w: number, h: number,
  scaleX: number, scaleY: number,
): void => {
  if (layer.bars.length === 0 || w <= 0) return;
  const colW = w / layer.bars.length;
  // Filled envelope area.
  ctx.beginPath();
  for (let i = 0; i < layer.bars.length; i++) {
    const v = layer.bars[i] ?? 0;
    const cx = x + i * colW + colW / 2;
    const cy = y + h - v * h;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  if (layer.bars.length > 0) {
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y * scaleY, 0, (y + h) * scaleY);
  grad.addColorStop(0, withAlpha(layer.color, 0.85));
  grad.addColorStop(1, withAlpha(layer.color, 0.08));
  ctx.fillStyle = grad;
  ctx.fill();
  // Top outline (crisp).
  ctx.beginPath();
  for (let i = 0; i < layer.bars.length; i++) {
    const v = layer.bars[i] ?? 0;
    const cx = x + i * colW + colW / 2;
    const cy = y + h - v * h;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Layer label on the left.
  ctx.fillStyle = withAlpha(layer.color, 0.9);
  ctx.font = '500 9px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(`L${layer.layer}`, x * scaleX + 2, (y + h / 2) * scaleY);
};
