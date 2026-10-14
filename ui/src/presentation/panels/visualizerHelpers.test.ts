import { describe, it, expect } from 'vitest';
import {
  channelColor, clampBin, defaultMidiBounds, freqBinForBar, layerColor,
  lerpColor, projectNote,
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
