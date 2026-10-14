/**
 * Pure helpers for the VisualizerPanel — extracted so we can unit-test
 * them without a DOM, AnalyserNode, or AudioContext. No imports from
 * infrastructure or presentation layers.
 */

import type { NoteEvent } from '~/domain/midi/encoder';

/**
 * Per-layer palette: deterministic HSL → CSS color, indexed by the
 * top-level stack layer number (0..7). The visualizer uses the same
 * palette as the StepGrid chips so a user can correlate "this note
 * came from layer 2" across panels.
 *
 * Hue: evenly spaced 0..360 by layer index. Saturation/lightness fixed
 * for legibility on both dark and light backgrounds.
 */
export const layerColor = (layerIndex: number): string => {
  if (!Number.isFinite(layerIndex) || layerIndex < 0) {
    return 'hsl(0 0% 60%)';
  }
  const hue = Math.round((layerIndex * 47) % 360);
  return `hsl(${hue} 70% 62%)`;
};

/** Channel-based fallback (1..16) when the layer index is unknown.
 *  Uses MIDI-channel-style ordering so different channels look distinct. */
export const channelColor = (channel: number): string => {
  const ch = Math.max(1, Math.min(16, channel | 0));
  // Channels 10 (drums) is intentionally gray in MIDI — keep neutral.
  if (ch === 10) return 'hsl(220 8% 70%)';
  return layerColor(ch - 1);
};

/** Vivid palette for layer ribbons in the track overview. The previous
 *  `channelColor` (hue per MIDI channel) doesn't help when a Strudel
 *  pattern uses the default channel=1 for everything — every ribbon
 *  ends up the same red. This palette cycles distinct hues by ribbon
 *  INDEX (sorted by layer number) so 1-2-3-4 layers get 1-2-3-4
 *  different colors regardless of the underlying channel data. */
export const RIBBON_PALETTE: ReadonlyArray<string> = [
  'hsl(42 95% 60%)',   // gold       — first layer (usually bass)
  'hsl(174 80% 55%)',  // cyan       — second layer
  'hsl(330 85% 65%)',  // magenta    — third layer
  'hsl(96 75% 60%)',   // lime       — fourth layer
  'hsl(15 90% 60%)',   // orange     — fifth layer
  'hsl(220 75% 65%)',  // sky        — sixth layer
  'hsl(60 90% 60%)',   // yellow
  'hsl(290 70% 65%)',  // purple
];

/** Neutral grey for the overflow pseudo-layer (when > maxLayers). */
export const RIBBON_OVERFLOW_COLOR = 'hsl(220 8% 70%)';

/** Pick a ribbon color by its index in the sorted layer list. The
 *  overflow layer (negative `layer` value) gets a neutral grey. */
export const ribbonColor = (ribbonIndex: number, isOverflow: boolean): string => {
  if (isOverflow) return RIBBON_OVERFLOW_COLOR;
  if (!Number.isFinite(ribbonIndex) || ribbonIndex < 0) return RIBBON_PALETTE[0]!;
  return RIBBON_PALETTE[ribbonIndex % RIBBON_PALETTE.length] ?? RIBBON_PALETTE[0]!;
};

/** Clamp a frequency-bin index into the visible spectrum range. */
export const clampBin = (bin: number, fftSize: number): number => {
  const max = Math.max(0, Math.floor(fftSize / 2) - 1);
  if (!Number.isFinite(bin)) return 0;
  if (bin < 0) return 0;
  if (bin > max) return max;
  return bin;
};

/**
 * Map a normalized [0..1] position on the spectrum bar to a frequency
 * bin index, with a perceptual (square-root) scale so the low end gets
 * more horizontal space. Returns 0 for invalid input.
 */
export const freqBinForBar = (
  barIdx: number,
  barCount: number,
  fftSize: number,
): number => {
  if (barCount <= 0 || fftSize <= 0) return 0;
  const t = Math.max(0, Math.min(1, barIdx / Math.max(1, barCount - 1)));
  const max = Math.floor(fftSize / 2);
  return clampBin(Math.floor(t * t * max), fftSize);
};

/** LERP for the HSL channel-bar gradient (low → high). */
export const lerpColor = (t: number, low: string, high: string): string => {
  const x = Math.max(0, Math.min(1, t));
  // Parse "hsl(H S% L%)" → three numbers; produce "hsl(H' S' L%)" with
  // a hue rotation low→high. We do not parse to/from RGB to keep deps
  // minimal and to be lossless on the chromatic dimension.
  const re = /hsl\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)/;
  const lo = low.match(re);
  const hi = high.match(re);
  if (!lo || !hi) return low;
  const lH = Number(lo[1]);
  const lS = Number(lo[2]);
  const lL = Number(lo[3]);
  const hH = Number(hi[1]);
  const hS = Number(hi[2]);
  const hL = Number(hi[3]);
  // Hue lerp on the shortest arc
  let dH = hH - lH;
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;
  const H = (lH + dH * x + 360) % 360;
  const S = lS + (hS - lS) * x;
  const L = lL + (hL - lL) * x;
  return `hsl(${H.toFixed(0)} ${S.toFixed(0)}% ${L.toFixed(0)}%)`;
};

/**
 * Project a single NoteEvent onto the track-overview viewport. Returns
 * null if the event is out of view. Pure function — used by the
 * visualization renderer so it can be unit-tested against fixtures.
 */
export type ProjectedNote = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
  readonly midi: number;
  readonly channel: number;
};

export const projectNote = (
  event: NoteEvent,
  opts: {
    readonly viewportW: number;
    readonly viewportH: number;
    readonly midiLo: number;
    readonly midiHi: number;
    readonly cycleStart: number;
    readonly cycleEnd: number;
  },
): ProjectedNote | null => {
  const { viewportW, viewportH, midiLo, midiHi, cycleStart, cycleEnd } = opts;
  if (cycleEnd <= cycleStart) return null;
  if (midiHi <= midiLo) return null;
  const cycleDur = cycleEnd - cycleStart;
  const x0 = ((event.startCycle - cycleStart) / cycleDur) * viewportW;
  const x1 = ((event.endCycle - cycleStart) / cycleDur) * viewportW;
  const w = Math.max(1, x1 - x0);
  if (x1 < 0 || x0 > viewportW) return null;
  const midiRange = midiHi - midiLo;
  // Higher midi = higher pitch → top of viewport; flip so y grows down.
  const y = ((midiHi - event.midi) / midiRange) * viewportH;
  const h = Math.max(1, viewportH / midiRange - 0.5);
  return {
    x: x0,
    y,
    w,
    h,
    fill: channelColor(event.channel),
    midi: event.midi,
    channel: event.channel,
  };
};

/** Compute the Y axis bounds for the track overview. Default C1..C6. */
export const defaultMidiBounds = (events: ReadonlyArray<NoteEvent>): {
  lo: number;
  hi: number;
} => {
  if (events.length === 0) return { lo: 24, hi: 96 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of events) {
    if (!Number.isFinite(e.midi)) continue;
    if (e.midi < lo) lo = e.midi;
    if (e.midi > hi) hi = e.midi;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 24, hi: 96 };
  // Pad ±2 semitones so blocks don't kiss the edges.
  lo = Math.max(0, Math.floor(lo) - 2);
  hi = Math.min(127, Math.ceil(hi) + 2);
  if (hi - lo < 12) hi = lo + 12; // ensure at least one octave of spread
  return { lo, hi };
};

// =========================================================================
//  Audio-band analysis — bass / mid / treble from a Uint8Array of FFT bins.
//  Used by the band meters, the bass-pulse, and the radial-mode "tail".
// =========================================================================

/** Convert a frequency in Hz to the corresponding FFT-bin index.
 *  sampleRate is the AudioContext.sampleRate; fftSize the AnalyserNode.fftSize. */
export const hzToBin = (hz: number, sampleRate: number, fftSize: number): number => {
  if (sampleRate <= 0 || fftSize <= 0) return 0;
  return Math.floor((hz * fftSize) / sampleRate);
};

/** Average magnitude in [0..1] of FFT bins in the [loHz..hiHz] range. */
export const bandLevel = (
  bins: Uint8Array,
  loHz: number,
  hiHz: number,
  sampleRate: number,
  fftSize: number,
): number => {
  if (bins.length === 0) return 0;
  const lo = Math.max(0, hzToBin(loHz, sampleRate, fftSize));
  const hi = Math.min(bins.length - 1, hzToBin(hiHz, sampleRate, fftSize));
  if (hi <= lo) return 0;
  let sum = 0;
  let n = 0;
  for (let i = lo; i <= hi; i++) {
    const v = bins[i];
    if (v === undefined) continue;
    sum += v;
    n++;
  }
  return n > 0 ? (sum / n) / 255 : 0;
};

/** Peak-hold decay: existing peaks fall toward the new value, but never
 *  below it (instant attack, slow decay). Returns the updated peaks array. */
export const updatePeakHold = (
  peaks: Float32Array,
  values: Float32Array,
  decayPerFrame: number,
): Float32Array => {
  const n = Math.min(peaks.length, values.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cur = values[i] ?? 0;
    const prev = peaks[i] ?? 0;
    out[i] = Math.max(cur, prev - decayPerFrame);
  }
  return out;
};

/** A small audio-level smoother (one-pole lowpass). 0 < alpha <= 1; higher
 *  values follow the input faster, lower values smoother. */
export const smooth = (prev: number, next: number, alpha: number): number => {
  if (!Number.isFinite(prev)) return next;
  if (!Number.isFinite(next)) return prev;
  return prev + (next - prev) * Math.max(0, Math.min(1, alpha));
};

/** Map a normalized [0..1] position on a bar to the polar-coord endpoint
 *  of a bar in the radial visualizer. Returns x/y in viewport pixels and
 *  the inner radius (start of the bar) and outer (end). */
export const radialBar = (
  t: number,
  level: number,
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
): { x0: number; y0: number; x1: number; y1: number } => {
  // 0..1 maps to angle. We start at -π/2 (top) and go clockwise.
  const angle = -Math.PI / 2 + t * Math.PI * 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const r1 = innerR;
  const r2 = innerR + Math.max(0, Math.min(1, level)) * (outerR - innerR);
  return {
    x0: cx + cosA * r1, y0: cy + sinA * r1,
    x1: cx + cosA * r2, y1: cy + sinA * r2,
  };
};

/** Square a level in [0..1] for perceptual emphasis (small signals feel
 *  louder to the eye when raised to a power < 1, feel tighter when > 1). */
export const perceptual = (level: number, gamma: number): number => {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const c = Math.max(0, Math.min(1, level));
  return c ** Math.max(0.01, gamma);
};

/** Per-bar color along a low→high frequency gradient. Returns an HSL
 *  string. t = bar position 0..1. Used for the spectrum/radial bars. */
export const bandHue = (t: number): string => {
  // Three-stop gradient: gold (low) → violet (mid) → cyan (high),
  // matching the wavecode Chroma Indigo palette tokens.
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.5) {
    return lerpColor(x * 2, 'hsl(42 95% 60%)', 'hsl(252 75% 65%)');
  }
  return lerpColor((x - 0.5) * 2, 'hsl(252 75% 65%)', 'hsl(174 80% 55%)');
};

/** Bar count recommendations per viewport width — gives ~3px per bar on
 *  desktop, 5px on mobile. Pure, deterministic. */
export const pickBarCount = (viewportWidth: number): number => {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 48;
  // Target 4-5px per bar incl. gap.
  const n = Math.floor((viewportWidth - 8) / 5);
  return Math.max(24, Math.min(96, n));
};

/** Compute cps (cycles per second) from BPM. 1 cycle = 1 quarter note,
 *  so cps = BPM / 60. Mirrors `formatBpm` in TransportPanel. */
export const cpsToBpm = (cps: number): number => {
  if (!Number.isFinite(cps) || cps <= 0) return 0;
  return Math.round(cps * 60);
};

/**
 * Per-layer activity envelope across one cycle. Used by the redesigned
 * track overview to draw a ribbon per layer — a bar chart of where each
 * layer is busy across time. The user sees the *shape* of the music
 * (where the kick lands, where the arp builds, where the bass drops)
 * at a glance, instead of the previous "pile of small rects".
 *
 * Each bar value is the sum of `velocity/127` for notes in that layer
 * that start in this column's `[start, start+columnWidth)` cycle window.
 * Values are normalised per-layer so the ribbon uses the full vertical
 * range regardless of how many notes the layer has.
 *
 * Layers are returned in insertion order (first note's layer first).
 * If there are more than `maxLayers` distinct layers, extras are
 * merged into a single "overflow" pseudo-layer at the end so the UI
 * doesn't grow unbounded for chaotic patterns.
 */
export type LayerActivity = {
  readonly layer: number;
  readonly isOverflow: boolean;
  readonly color: string;
  readonly bars: ReadonlyArray<number>;
};

export const computeLayerActivity = (
  events: ReadonlyArray<NoteEvent>,
  columns: number,
  maxLayers: number,
): ReadonlyArray<LayerActivity> => {
  if (columns <= 0) return [];
  // Group events by layer (channel = layer index in the audio engine).
  const byLayer = new Map<number, NoteEvent[]>();
  for (const e of events) {
    const ch = Math.max(1, Math.min(16, e.channel | 0));
    let arr = byLayer.get(ch);
    if (!arr) {
      arr = [];
      byLayer.set(ch, arr);
    }
    arr.push(e);
  }
  // Stable order: by channel number ascending, then cap at maxLayers.
  const sorted = Array.from(byLayer.entries()).sort((a, b) => a[0] - b[0]);
  const truncated = sorted.length > maxLayers
    ? [...sorted.slice(0, maxLayers - 1),
       ['overflow' as unknown as number,
        sorted.slice(maxLayers - 1).flatMap(([, evts]) => evts)] as [number, NoteEvent[]]]
    : sorted;
  return truncated.map(([layer, evts]) => {
    const sums = new Array<number>(columns).fill(0);
    for (const e of evts) {
      const colF = e.startCycle * columns;
      const col = Math.max(0, Math.min(columns - 1, Math.floor(colF)));
      sums[col] = (sums[col] ?? 0) + (Math.max(0, Math.min(1, e.velocity / 127)));
    }
    let max = 0;
    for (const v of sums) if (v > max) max = v;
    const bars = max > 0
      ? sums.map((v) => v / max)
      : sums.map(() => 0);
    return {
      layer,
      isOverflow: layer === ('overflow' as unknown as number),
      color: layer === ('overflow' as unknown as number)
        ? RIBBON_OVERFLOW_COLOR
        : ribbonColor(truncated.findIndex(([l]) => l === layer), false),
      bars,
    };
  });
};
