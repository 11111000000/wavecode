import { describe, it, expect } from 'vitest';
import type { NoteEvent } from '~/domain/midi/encoder';
import {
  bandHue, bandLevel, channelColor, clampBin, computeLayerActivity, cpsToBpm,
  defaultMidiBounds, freqBinForBar, hzToBin, layerColor, lerpColor,
  perceptual, pickBarCount, projectNote, radialBar, smooth, updatePeakHold,
} from './visualizerHelpers';

describe('visualizerHelpers.layerColor', () => {
  it('returns a deterministic HSL color for layer index', () => {
    expect(layerColor(0)).toBe('hsl(0 70% 62%)');
    expect(layerColor(1)).toBe('hsl(47 70% 62%)');
    // Step = 47° per layer, so layer 7 = 329° (wraps within 360).
    expect(layerColor(7)).toBe('hsl(329 70% 62%)');
  });

  it('wraps hue beyond 360', () => {
    const a = layerColor(0);
    const b = layerColor(8); // (8*47) % 360 = 16
    expect(a).not.toBe(b);
    expect(b).toMatch(/^hsl\(\d+ 70% 62%\)$/);
  });

  it('falls back to neutral for non-finite or negative indices', () => {
    expect(layerColor(-1)).toBe('hsl(0 0% 60%)');
    expect(layerColor(Number.NaN)).toBe('hsl(0 0% 60%)');
  });
});

describe('visualizerHelpers.channelColor', () => {
  it('uses layer palette for channels 1..9 and 11..16', () => {
    expect(channelColor(1)).toBe(layerColor(0));
    expect(channelColor(11)).toBe(layerColor(10));
  });

  it('returns neutral grey for MIDI channel 10 (drums)', () => {
    expect(channelColor(10)).toBe('hsl(220 8% 70%)');
  });

  it('clamps channels outside 1..16', () => {
    expect(channelColor(0)).toBe(channelColor(1));
    expect(channelColor(20)).toBe(channelColor(16));
  });
});

describe('visualizerHelpers.clampBin', () => {
  it('clamps below 0', () => {
    expect(clampBin(-5, 1024)).toBe(0);
  });

  it('clamps above half the FFT size', () => {
    expect(clampBin(9999, 1024)).toBe(511);
  });

  it('passes through valid bins', () => {
    expect(clampBin(42, 1024)).toBe(42);
  });

  it('returns 0 for non-finite input', () => {
    expect(clampBin(Number.NaN, 1024)).toBe(0);
  });
});

describe('visualizerHelpers.freqBinForBar', () => {
  it('maps the first bar to bin 0', () => {
    expect(freqBinForBar(0, 48, 1024)).toBe(0);
  });

  it('maps the last bar to (nearly) the top of the spectrum', () => {
    const bin = freqBinForBar(47, 48, 1024);
    // Perceptual sqrt scale → last bar lands at the very top, not 511/511.
    expect(bin).toBe(511);
  });

  it('uses perceptual (sqrt) scale so the first few bars cover more FFT bins each', () => {
    // 1/3 of bars span only (1/3)^1.6 = ~0.21 of the spectrum,
    // so bin for bar 16 of 48 should be ~108, NOT 170 (linear).
    const bin = freqBinForBar(16, 48, 1024);
    expect(bin).toBeLessThan(170);
    expect(bin).toBeGreaterThan(50);
  });

  it('returns 0 for zero-sized inputs', () => {
    expect(freqBinForBar(0, 0, 0)).toBe(0);
    expect(freqBinForBar(0, 48, 0)).toBe(0);
  });
});

describe('visualizerHelpers.lerpColor', () => {
  it('returns the low color at t=0', () => {
    const out = lerpColor(0, 'hsl(0 50% 50%)', 'hsl(120 80% 70%)');
    expect(out).toBe('hsl(0 50% 50%)');
  });

  it('returns the high color at t=1', () => {
    const out = lerpColor(1, 'hsl(0 50% 50%)', 'hsl(120 80% 70%)');
    expect(out).toBe('hsl(120 80% 70%)');
  });

  it('interpolates the shortest hue arc', () => {
    // 350 → 10: shortest arc is 20° forward (not 340°).
    const out = lerpColor(0.5, 'hsl(350 50% 50%)', 'hsl(10 50% 50%)');
    const match = out.match(/hsl\((\d+) /);
    expect(match).not.toBeNull();
    const hue = Number(match?.[1]);
    // Either 0 (== 360) or 360 is OK; both lie on the shortest arc.
    expect(hue === 0 || hue === 360).toBe(true);
  });

  it('falls back to low color for non-HSL inputs', () => {
    expect(lerpColor(0.5, 'not-a-color', 'hsl(10 50% 50%)')).toBe('not-a-color');
  });

  it('clamps t outside [0..1]', () => {
    const lo = lerpColor(-1, 'hsl(10 50% 50%)', 'hsl(20 50% 50%)');
    const hi = lerpColor(2, 'hsl(10 50% 50%)', 'hsl(20 50% 50%)');
    expect(lo).toBe('hsl(10 50% 50%)');
    expect(hi).toBe('hsl(20 50% 50%)');
  });
});

describe('visualizerHelpers.projectNote', () => {
  const baseOpts = {
    viewportW: 1000,
    viewportH: 100,
    midiLo: 60,
    midiHi: 72,
    cycleStart: 0,
    cycleEnd: 1,
  };

  it('maps a 1-cycle-long note to a viewport-spanning block', () => {
    const p = projectNote(
      { midi: 60, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
      baseOpts,
    );
    expect(p).not.toBeNull();
    expect(p!.w).toBe(1000);
    expect(p!.x).toBe(0);
    // midi 60 is the LOW end of the range (60..72) → it sits at the
    // bottom of the viewport (y=100). Implementation: high-midi = top.
    expect(p!.y).toBeCloseTo(100, 5);
  });

  it('places the highest midi at the top of the viewport', () => {
    const p = projectNote(
      { midi: 72, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 1 },
      baseOpts,
    );
    expect(p!.y).toBe(0);
  });

  it('returns null for events outside the viewport', () => {
    expect(projectNote(
      { midi: 60, startCycle: -0.5, endCycle: -0.1, velocity: 100, channel: 1 },
      baseOpts,
    )).toBeNull();
    expect(projectNote(
      { midi: 60, startCycle: 1.1, endCycle: 1.5, velocity: 100, channel: 1 },
      baseOpts,
    )).toBeNull();
  });

  it('uses channel-based fill color', () => {
    const p = projectNote(
      { midi: 60, startCycle: 0, endCycle: 0.5, velocity: 100, channel: 10 },
      baseOpts,
    );
    expect(p!.fill).toBe('hsl(220 8% 70%)');
  });

  it('produces minimum-width blocks for tiny notes', () => {
    const p = projectNote(
      { midi: 60, startCycle: 0.5, endCycle: 0.5001, velocity: 100, channel: 1 },
      baseOpts,
    );
    expect(p!.w).toBe(1);
  });
});

describe('visualizerHelpers.defaultMidiBounds', () => {
  it('returns default C1..C6 for empty input', () => {
    expect(defaultMidiBounds([])).toEqual({ lo: 24, hi: 96 });
  });

  it('expands to the observed range + 2-semitone padding', () => {
    const events = [
      { midi: 60, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
      { midi: 64, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
    ];
    const { lo, hi } = defaultMidiBounds(events);
    expect(lo).toBe(58); // 60 - 2
    // observed range is 60..64 (4 semitones); +4 padding = 8, less than
    // the 12-semitone minimum → hi bumps to lo+12 = 70.
    expect(hi).toBe(70);
  });

  it('enforces at least one octave of vertical spread', () => {
    const events = [
      { midi: 60, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
      { midi: 62, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
    ];
    const { lo, hi } = defaultMidiBounds(events);
    expect(hi - lo).toBeGreaterThanOrEqual(12);
  });

  it('ignores NaN midis', () => {
    const events = [
      { midi: Number.NaN, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
      { midi: 60, startCycle: 0, endCycle: 1, velocity: 100, channel: 1 },
    ];
    // observed range 60..60 + 4 padding = 4, bumped to lo+12 = 70.
    expect(defaultMidiBounds(events)).toEqual({ lo: 58, hi: 70 });
  });
});

describe('visualizerHelpers.hzToBin', () => {
  it('maps 0 Hz to bin 0', () => {
    expect(hzToBin(0, 44100, 1024)).toBe(0);
  });

  it('maps Nyquist (sampleRate/2) to the top bin', () => {
    // sampleRate/2 = 22050, fftSize = 1024, bin = (22050 * 1024) / 44100 = 512
    expect(hzToBin(22050, 44100, 1024)).toBe(512);
  });

  it('returns 0 for invalid sample rates / FFT sizes', () => {
    expect(hzToBin(440, 0, 1024)).toBe(0);
    expect(hzToBin(440, 44100, 0)).toBe(0);
  });
});

describe('visualizerHelpers.bandLevel', () => {
  it('averages the bins in [loHz..hiHz] and normalises to 0..1', () => {
    // 44100 Hz sample rate, 1024 fftSize → 1 bin = 43.07 Hz.
    // 250..500 Hz → bins 5..11 (approx). Fill with 128 (silence at 0.5).
    const bins = new Uint8Array(512);
    for (let i = 0; i < 512; i++) bins[i] = i < 5 ? 0 : i > 11 ? 0 : 200;
    const lvl = bandLevel(bins, 250, 500, 44100, 1024);
    expect(lvl).toBeGreaterThan(0.7);
    expect(lvl).toBeLessThanOrEqual(1);
  });

  it('returns 0 for empty bins', () => {
    expect(bandLevel(new Uint8Array(0), 100, 1000, 44100, 1024)).toBe(0);
  });

  it('returns 0 when the band falls outside the FFT range', () => {
    const bins = new Uint8Array(512).fill(255);
    expect(bandLevel(bins, 100000, 200000, 44100, 1024)).toBe(0);
  });
});

describe('visualizerHelpers.updatePeakHold', () => {
  it('instantly follows a rising signal (attack)', () => {
    const peaks = new Float32Array([0, 0, 0]);
    const values = new Float32Array([0.8, 0.2, 0.5]);
    const next = updatePeakHold(peaks, values, 0.01);
    expect(next[0]).toBeCloseTo(0.8, 5);
    expect(next[1]).toBeCloseTo(0.2, 5);
    expect(next[2]).toBeCloseTo(0.5, 5);
  });

  it('slowly decays when the signal falls (release)', () => {
    const peaks = new Float32Array([0.8, 0.2, 0.5]);
    const values = new Float32Array([0.0, 0.0, 0.0]);
    const next = updatePeakHold(peaks, values, 0.05);
    expect(next[0]).toBeCloseTo(0.75, 5);
    expect(next[1]).toBeCloseTo(0.15, 5);
    expect(next[2]).toBeCloseTo(0.45, 5);
  });

  it('never goes below the new value', () => {
    const peaks = new Float32Array([0.3]);
    const values = new Float32Array([0.9]);
    const next = updatePeakHold(peaks, values, 0.5);
    // Float32 storage → ~6 sig figs; use closeTo instead of toBe.
    expect(next[0]).toBeCloseTo(0.9, 5);
  });

  it('handles length mismatches by taking the shorter side', () => {
    const peaks = new Float32Array([0.1, 0.2, 0.3]);
    const values = new Float32Array([0.5]);
    const next = updatePeakHold(peaks, values, 0.0);
    expect(next.length).toBe(1);
    expect(next[0]).toBe(0.5);
  });
});

describe('visualizerHelpers.smooth', () => {
  it('returns the next value when prev is NaN', () => {
    expect(smooth(Number.NaN, 0.5, 0.3)).toBe(0.5);
  });

  it('returns prev when next is NaN', () => {
    expect(smooth(0.5, Number.NaN, 0.3)).toBe(0.5);
  });

  it('lerps by alpha', () => {
    expect(smooth(0, 1, 0.25)).toBeCloseTo(0.25, 5);
    expect(smooth(1, 0, 0.25)).toBeCloseTo(0.75, 5);
  });

  it('clamps alpha to [0..1]', () => {
    expect(smooth(0, 1, 2)).toBe(1);
    expect(smooth(0, 1, -1)).toBe(0);
  });
});

describe('visualizerHelpers.radialBar', () => {
  it('places t=0 at the top of the circle', () => {
    const { x0, y0, x1, y1 } = radialBar(0, 1, 100, 100, 20, 50);
    // angle = -π/2 → (cos, sin) = (0, -1) → y0 = 100 - 20 = 80, y1 = 100 - 50 = 50
    expect(x0).toBeCloseTo(100, 5);
    expect(y0).toBeCloseTo(80, 5);
    expect(x1).toBeCloseTo(100, 5);
    expect(y1).toBeCloseTo(50, 5);
  });

  it('places t=0.25 at the right of the circle', () => {
    const { x1, y1 } = radialBar(0.25, 1, 100, 100, 20, 50);
    // angle = 0 → (1, 0) → x1 = 150, y1 = 100
    expect(x1).toBeCloseTo(150, 5);
    expect(y1).toBeCloseTo(100, 5);
  });

  it('level=0 collapses the bar to the inner radius', () => {
    const a = radialBar(0.5, 0, 100, 100, 20, 50);
    const b = radialBar(0.5, 1, 100, 100, 20, 50);
    expect(a.x1).toBeCloseTo(b.x0, 5);
    expect(a.y1).toBeCloseTo(b.y0, 5);
  });

  it('clamps level to [0..1]', () => {
    const a = radialBar(0.1, -0.5, 100, 100, 20, 50);
    const b = radialBar(0.1, 0, 100, 100, 20, 50);
    expect(a.x1).toBeCloseTo(b.x1, 5);
    expect(a.y1).toBeCloseTo(b.y1, 5);
  });
});

describe('visualizerHelpers.perceptual', () => {
  it('returns 0 for non-positive input', () => {
    expect(perceptual(0, 0.5)).toBe(0);
    expect(perceptual(-0.5, 0.5)).toBe(0);
    expect(perceptual(Number.NaN, 0.5)).toBe(0);
  });

  it('raises to the given gamma', () => {
    expect(perceptual(0.5, 2)).toBeCloseTo(0.25, 5);
    expect(perceptual(0.5, 0.5)).toBeCloseTo(Math.sqrt(0.5), 5);
  });

  it('clamps input to [0..1]', () => {
    expect(perceptual(1.5, 1)).toBe(1);
  });
});

describe('visualizerHelpers.bandHue', () => {
  it('produces a valid hsl() at every t in [0..1]', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const c = bandHue(t);
      expect(c).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    }
  });

  it('low end is warm (gold), high end is cool (cyan)', () => {
    const lo = bandHue(0);
    const hi = bandHue(1);
    // Hue 42 (gold) and 174 (cyan) are far apart.
    const loHue = Number(lo.match(/hsl\((\d+)/)?.[1]);
    const hiHue = Number(hi.match(/hsl\((\d+)/)?.[1]);
    expect(loHue).toBeLessThan(60);
    expect(hiHue).toBeGreaterThan(150);
  });
});

describe('visualizerHelpers.pickBarCount', () => {
  it('returns a value within [24..96]', () => {
    expect(pickBarCount(360)).toBeGreaterThanOrEqual(24);
    expect(pickBarCount(360)).toBeLessThanOrEqual(96);
    expect(pickBarCount(1920)).toBeLessThanOrEqual(96);
  });

  it('returns 48 (the default) for invalid inputs', () => {
    expect(pickBarCount(0)).toBe(48);
    expect(pickBarCount(-1)).toBe(48);
    expect(pickBarCount(Number.NaN)).toBe(48);
  });

  it('gives more bars on wider viewports', () => {
    expect(pickBarCount(1920)).toBeGreaterThan(pickBarCount(360));
  });
});

describe('visualizerHelpers.cpsToBpm', () => {
  it('multiplies cps by 60 and rounds to nearest integer', () => {
    expect(cpsToBpm(0.5)).toBe(30);
    expect(cpsToBpm(2)).toBe(120);
    expect(cpsToBpm(0.7)).toBe(42);
  });

  it('returns 0 for non-positive or non-finite input', () => {
    expect(cpsToBpm(0)).toBe(0);
    expect(cpsToBpm(-1)).toBe(0);
    expect(cpsToBpm(Number.NaN)).toBe(0);
  });
});

describe('visualizerHelpers.computeLayerActivity', () => {
  const ev = (
    midi: number, startCycle: number, endCycle: number,
    velocity: number, channel: number,
  ): NoteEvent => ({ midi, startCycle, endCycle, velocity, channel });

  it('returns [] for no events or zero columns', () => {
    expect(computeLayerActivity([], 64, 4)).toEqual([]);
    expect(computeLayerActivity([ev(60, 0, 0.5, 100, 1)], 0, 4)).toEqual([]);
  });

  it('groups events by channel and returns one entry per layer', () => {
    const events = [
      ev(60, 0, 0.5, 100, 1),
      ev(62, 0.5, 1, 100, 1),
      ev(48, 0, 1, 80, 2),
    ];
    const result = computeLayerActivity(events, 4, 4);
    expect(result).toHaveLength(2);
    expect(result[0]?.layer).toBe(1);
    expect(result[1]?.layer).toBe(2);
  });

  it('produces normalised bars (max value = 1.0) for a single layer', () => {
    const events = [
      ev(60, 0,    0.1, 127, 1),
      ev(60, 0.25, 0.1, 127, 1),
      ev(60, 0.5,  0.1, 127, 1),
      ev(60, 0.75, 0.1, 127, 1),
    ];
    const result = computeLayerActivity(events, 4, 4);
    const bars = result[0]?.bars ?? [];
    expect(bars.length).toBe(4);
    for (const v of bars) {
      expect(v).toBeCloseTo(1.0, 5);
    }
  });

  it('concentrates density in the column the note starts in', () => {
    const result = computeLayerActivity([ev(60, 0, 0.1, 127, 1)], 4, 4);
    const bars = result[0]?.bars ?? [];
    expect(bars[0]).toBeCloseTo(1.0, 5);
    expect(bars[1]).toBe(0);
    expect(bars[2]).toBe(0);
    expect(bars[3]).toBe(0);
  });

  it('clamps the column index to [0, columns-1]', () => {
    const result = computeLayerActivity([ev(60, 1, 1, 100, 1)], 4, 4);
    const bars = result[0]?.bars ?? [];
    expect(bars[3]).toBe(1.0);
  });

  it('truncates layers above maxLayers and merges them into one', () => {
    const events = [
      ev(60, 0, 0.1, 100, 1),
      ev(60, 0, 0.1, 100, 2),
      ev(60, 0, 0.1, 100, 3),
      ev(60, 0, 0.1, 100, 4),
      ev(60, 0, 0.1, 100, 5),
    ];
    const result = computeLayerActivity(events, 4, 3);
    expect(result).toHaveLength(3);
    expect(result[0]?.layer).toBe(1);
    expect(result[1]?.layer).toBe(2);
    expect(result[2]?.bars[0]).toBe(1.0);
  });

  it('uses layerColor palette (not neutral grey) for non-drum channels', () => {
    const result = computeLayerActivity([ev(60, 0, 0.1, 100, 1)], 4, 4);
    expect(result[0]?.color).toBe(layerColor(0));
  });

  it('returns neutral grey for the MIDI drum channel (10)', () => {
    const result = computeLayerActivity([ev(60, 0, 0.1, 100, 10)], 4, 4);
    expect(result[0]?.color).toBe('hsl(220 8% 70%)');
  });

  it('returns all-zero bars when the only notes are zero-velocity', () => {
    const result = computeLayerActivity([ev(60, 0, 0.1, 0, 1)], 4, 4);
    for (const v of result[0]?.bars ?? []) expect(v).toBe(0);
  });
});
