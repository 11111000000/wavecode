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
