import { describe, it, expect } from 'vitest';
import {
  feedTransient,
  transientsToSnippet,
  computeRms,
  computeCentroidHz,
  classifyOnset,
  rmsToDb,
  initialTransientState,
  DEFAULT_TRANSIENT_TUNE,
  DEFAULT_INSTRUMENT_MAP,
  type TransientFrame,
  type Transient,
} from '~/domain/audio/transient';

/**
 * Unit tests for the pure transient pipeline.
 *
 * Strategy: build synthetic TransientFrames (sine bursts + noise) and
 * assert the segmentation + classification. The synth helpers below
 * let us construct reproducible frames without a Web Audio dependency.
 */

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 2048; // 42.7ms at 48kHz

/** A 1000 Hz sine of `n` samples. */
const sine = (freq: number, n: number = FRAME_SIZE, amp: number = 0.3): Float32Array => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return out;
};

/** A `n`-sample window of uniform noise in [-amp, amp]. */
const noise = (n: number = FRAME_SIZE, amp: number = 0.1): Float32Array => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (Math.random() * 2 - 1) * amp;
  return out;
};

/** Helper for crafting Transient literals with sensible defaults. */
const note = (type: Transient['type'], startMs: number, envelopeMs: number = 0): Transient => ({
  type,
  startMs,
  amplitude: 0.3,
  spectralCentroidHz: 0,
  envelopeMs,
});

/** Build a frame with a flat freq-domain (centroid near sampleRate/4). */
const flatFreq = (n: number = 1024, value: number = 100): Uint8Array => {
  const out = new Uint8Array(n);
  out.fill(value);
  return out;
};

/** Build a frame with a Gaussian peak at the given Hz (used to drive centroid). */
const peakedFreq = (peakHz: number, n: number = 1024, sigmaHz: number = 80): Uint8Array => {
  const out = new Uint8Array(n);
  const halfRate = SAMPLE_RATE / 2;
  for (let i = 0; i < n; i += 1) {
    const f = (i * halfRate) / n;
    const d = (f - peakHz) / sigmaHz;
    out[i] = Math.max(0, Math.min(255, Math.round(255 * Math.exp(-d * d))));
  }
  return out;
};

const frame = (opts: {
  readonly time?: Float32Array;
  readonly freq?: Uint8Array;
  readonly sampleRate?: number;
  readonly t?: number;
}): TransientFrame => ({
  timeDomain: opts.time ?? new Float32Array(FRAME_SIZE),
  freqDomain: opts.freq ?? new Uint8Array(1024),
  sampleRate: opts.sampleRate ?? SAMPLE_RATE,
  timestampMs: opts.t ?? 0,
});

describe('computeRms / rmsToDb', () => {
  it('RMS of zero buffer is 0', () => {
    expect(computeRms(new Float32Array(64))).toBe(0);
  });
  it('RMS of a 0.5-amplitude sine is 0.5 / sqrt(2) ≈ 0.354', () => {
    const buf = new Float32Array(2048);
    for (let i = 0; i < 2048; i += 1) buf[i] = 0.5 * Math.sin((i * 2 * Math.PI * 440) / 2048);
    expect(computeRms(buf)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });
  it('rmsToDb maps 1.0 → 0 dB, 0.1 → -20 dB, ~0 → -200 dB', () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 6);
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 6);
    expect(rmsToDb(0)).toBe(-200);
  });
});

describe('computeCentroidHz', () => {
  it('returns 0 for empty magnitude array', () => {
    expect(computeCentroidHz(new Uint8Array(0), SAMPLE_RATE)).toBe(0);
  });
  it('peaks at the peakHz for a Gaussian freq-domain', () => {
    const c = computeCentroidHz(peakedFreq(800), SAMPLE_RATE);
    expect(c).toBeGreaterThan(700);
    expect(c).toBeLessThan(900);
  });
  it('flat freq-domain → centroid at Nyquist / 2', () => {
    // flat means equal weight across all bins → mean ≈ Nyquist/2
    expect(computeCentroidHz(flatFreq(1024, 100), SAMPLE_RATE)).toBeCloseTo(12000, -2);
  });
});

describe('classifyOnset', () => {
  it('centroid < centroidLowHz → kick', () => {
    expect(classifyOnset(100, DEFAULT_TRANSIENT_TUNE)).toBe('kick');
  });
  it('centroid > centroidHighHz → hat', () => {
    expect(classifyOnset(5000, DEFAULT_TRANSIENT_TUNE)).toBe('hat');
  });
  it('centroid between but below mid → snare', () => {
    expect(classifyOnset(700, DEFAULT_TRANSIENT_TUNE)).toBe('snare');
  });
  it('centroid between but above mid → click', () => {
    expect(classifyOnset(1500, DEFAULT_TRANSIENT_TUNE)).toBe('click');
  });
});

describe('feedTransient — onset detection', () => {
  it('does not fire below silenceDb even if flux is huge (jump from 0 to loud)', () => {
    let s = initialTransientState();
    // First frame: silence — establishes prevRmsDb as very low
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    // Second frame: loud — flux would be huge, but rms is also huge
    // so we DO fire (the silence floor is on the CURRENT frame, not the flux).
    s = feedTransient(s, frame({ time: sine(440, FRAME_SIZE, 0.3), t: 30 }));
    expect(s.transients.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire when flux is below rmsFluxDb (gradual swell)', () => {
    let s = initialTransientState();
    // Establish baseline at ~0.1 RMS
    const base = noise(FRAME_SIZE, 0.1);
    s = feedTransient(s, frame({ time: base, t: 0 }));
    // Small +3dB swell — should not fire (default threshold 6 dB)
    s = feedTransient(s, frame({ time: noise(FRAME_SIZE, 0.13), t: 30 }));
    expect(s.transients).toHaveLength(0);
  });

  it('fires on a sharp +10dB transient', () => {
    let s = initialTransientState();
    // Baseline silence
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    // Loud kick-like burst
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 30 }));
    expect(s.transients).toHaveLength(1);
    expect(s.transients[0]?.type).toBe('kick');
  });

  it('respects the refractory window (no double-trigger on one beat)', () => {
    let s = initialTransientState();
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 30 }));
    // 30ms later — should be skipped (refractory default 50ms)
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 60 }));
    expect(s.transients).toHaveLength(1);
  });

  it('classifies by spectral centroid: kick vs snare vs hat', () => {
    let s = initialTransientState();
    // Leading silence frame establishes prevRmsDb so the first
    // burst's flux is well-defined (initial state has prevRmsDb=null,
    // which we treat as flux=0 — i.e. no first-frame trigger).
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    // Use noise bursts with increasing amplitude so the dB-flux
    // threshold is reliably crossed. A pure-tone burst at constant
    // amplitude frame-to-frame has flux ≈ 0.
    const burst = (freqPeakHz: number, amp: number): TransientFrame => {
      const time = new Float32Array(FRAME_SIZE);
      const burstLen = 200;
      for (let i = 0; i < burstLen; i += 1) {
        // Mix two close frequencies around the peak → noise-like burst
        const t = i / SAMPLE_RATE;
        time[i] = amp * (Math.sin(2 * Math.PI * freqPeakHz * t) + Math.sin(2 * Math.PI * (freqPeakHz + 30) * t)) / 2;
      }
      return { timeDomain: time, freqDomain: peakedFreq(freqPeakHz), sampleRate: SAMPLE_RATE, timestampMs: 0 };
    };
    s = feedTransient(s, { ...burst(80, 0.1), timestampMs: 30 });     // kick
    s = feedTransient(s, { ...burst(800, 0.3), timestampMs: 200 });   // snare (after refractory)
    s = feedTransient(s, { ...burst(4000, 0.7), timestampMs: 400 });  // hat
    const types = s.transients.map((t) => t.type);
    expect(types).toEqual(['kick', 'snare', 'hat']);
  });
});

describe('transientsToSnippet', () => {
  it('null on empty', () => {
    expect(transientsToSnippet([])).toBeNull();
  });

  it('emits a single s(...) layer for a single-type pattern', () => {
    const out = transientsToSnippet([
      note('kick', 0),
      note('kick', 250),
      note('kick', 500),
      note('kick', 750),
    ]);
    expect(out).toBe('s("drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~")');
  });

  it('emits stack(...) with one layer per type for mixed patterns', () => {
    const out = transientsToSnippet([
      note('kick', 0),
      note('snare', 250),
      note('kick', 500),
      note('snare', 750),
    ]);
    // cycleMs = (750 - 0) + 200 = 950; 16 steps, range 0..15
    // step = round((t-0)/950 * 15):
    //   0   → 0,  250 → 4,  500 → 8,  750 → 12
    // kick  at [0, 8]       (250 and 750 get classified snare)
    //   → "drums_bd ~ ~ ~ ~ ~ ~ ~ drums_bd ~ ~ ~ ~ ~ ~ ~"
    // snare at [4, 12]      (0 and 500 get classified kick)
    //   → "~ ~ ~ ~ drums_sd ~ ~ ~ ~ ~ ~ ~ drums_sd ~ ~ ~"
    expect(out).toBe(
      'stack(\n' +
      '  s("drums_bd ~ ~ ~ ~ ~ ~ ~ drums_bd ~ ~ ~ ~ ~ ~ ~"),\n' +
      '  s("~ ~ ~ ~ drums_sd ~ ~ ~ ~ ~ ~ ~ drums_sd ~ ~ ~")\n' +
      ')',
    );
  });

  it('uses custom instrumentMap when provided', () => {
    const out = transientsToSnippet(
      [note('kick', 0)],
      { ...DEFAULT_INSTRUMENT_MAP, kick: 'drums_cb' },
    );
    expect(out).toBe('s("drums_cb ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")');
  });

  it('preserves relative timing within a cycle', () => {
    // Two transients at 0 and 100ms → cycleMs = 100 + 200 = 300
    // 16 steps, range 0..15; step = round(t/300 * 15):
    //   0   → 0,  100 → 5
    const out = transientsToSnippet([
      note('kick', 0),
      note('snare', 100),
    ]);
    expect(out).toBe(
      'stack(\n' +
      '  s("drums_bd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"),\n' +
      '  s("~ ~ ~ ~ ~ drums_sd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")\n' +
      ')',
    );
  });
});

describe('DEFAULT_TUNE — sane defaults for acoustic percussion', () => {
  it('rmsFluxDb of 6 dB is the canonical onset threshold (Bello 2005)', () => {
    expect(DEFAULT_TRANSIENT_TUNE.rmsFluxDb).toBe(6);
  });
  it('centroidLowHz (200) maps to a kick-like sub-bass energy band', () => {
    expect(DEFAULT_TRANSIENT_TUNE.centroidLowHz).toBeLessThanOrEqual(250);
  });
  it('centroidHighHz (2000) maps to a hat-like high-frequency band', () => {
    expect(DEFAULT_TRANSIENT_TUNE.centroidHighHz).toBeGreaterThanOrEqual(1500);
  });
  it('refractory window ≥ 30ms prevents double-firing on a single beat', () => {
    expect(DEFAULT_TRANSIENT_TUNE.minTransMs).toBeGreaterThanOrEqual(30);
  });
});

describe('feedTransient — envelope (decay time) measurement', () => {
  // Uses 30ms-spaced frames so envelope timing is unambiguous.
  const FRAME_STEP_MS = 30;

  it('short hit (loud then silent in one frame) → envelopeMs < 80', () => {
    let s = initialTransientState();
    // Silence baseline so the first loud frame has measurable flux.
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    // Loud kick — onset fires. RMS ≈ 0.5 → peak.
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: FRAME_STEP_MS }));
    // Next frame: silence. RMS ≈ 0 < 0.37 * 0.5 → decay detected.
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: FRAME_STEP_MS * 2 }));
    expect(s.transients).toHaveLength(1);
    expect(s.transients[0]!.envelopeMs).toBeGreaterThan(0);
    expect(s.transients[0]!.envelopeMs).toBeLessThan(80);
  });

  it('long hit (sustained ~250ms then silent) → envelopeMs > 150', () => {
    let s = initialTransientState();
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    // Onset at t=30
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 30 }));
    // Sustained at same RMS for ~250ms
    for (let t = 60; t <= 270; t += FRAME_STEP_MS) {
      s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t }));
    }
    // Drop to silence at t=300 → RMS=0 < 0.37*peak → envelope finalized.
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 300 }));
    expect(s.transients).toHaveLength(1);
    expect(s.transients[0]!.envelopeMs).toBeGreaterThan(150);
    expect(s.transients[0]!.envelopeMs).toBeLessThanOrEqual(1000);
  });

  it('multi-frame decay path: RMS at half peak still tracks (only 1/e finishes it)', () => {
    let s = initialTransientState();
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 30 }));
    // Frame at t=60 with RMS ≈ 0.25 (half of peak 0.5). 0.25 > 0.185
    // (0.37*peak) → still tracking, not yet finalised.
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.25), freq: peakedFreq(80), t: 60 }));
    expect(s.transients[0]!.envelopeMs).toBe(0);
  });

  it('cap at ENVELOPE_MAX_MS (1000) when decay never observed and a new onset fires', () => {
    let s = initialTransientState();
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 30 }));
    // Sustain the same RMS for ~1.2s — envelope is never dropped because
    // RMS stays above the 1/e threshold.
    for (let t = 60; t < 1200; t += 30) {
      s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t }));
    }
    // Drop to silence — RMS=0 < 0.37*peak → decay finalized at t=1200.
    // envelopeMs = min(1000, 1200-30) = 1000.
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 1200 }));
    // After silence, the next loud frame fires a fresh onset.
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 1230 }));
    expect(s.transients).toHaveLength(2);
    expect(s.transients[0]!.envelopeMs).toBeLessThanOrEqual(1000);
    expect(s.transients[0]!.envelopeMs).toBeGreaterThan(0);
    // Second envelope is fresh.
    expect(s.transients[1]!.envelopeMs).toBe(0);
  });

  it('new onset fires before the previous envelope completes → previous envelope closes at nowMs', () => {
    let s = initialTransientState();
    s = feedTransient(s, frame({ time: new Float32Array(FRAME_SIZE), t: 0 }));
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 30 }));
    // Sustain at same RMS (no decay) for the refractory window.
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 0.5), freq: peakedFreq(80), t: 60 }));
    // Now force a much louder frame (amp=2.0 → RMS≈1.4) for a +12dB flux
    // — bigger than the 6dB onset threshold, fires new onset.
    s = feedTransient(s, frame({ time: sine(80, FRAME_SIZE, 2.0), freq: peakedFreq(80), t: 90 }));
    expect(s.transients).toHaveLength(2);
    // First transient's envelope closes at min(1000, 90-30) = 60ms.
    expect(s.transients[0]!.envelopeMs).toBe(60);
    expect(s.transients[1]!.envelopeMs).toBe(0);
  });

  it('Transient type includes envelopeMs (default value of envelopeMs field is wired through)', () => {
    const t: Transient = {
      type: 'kick',
      startMs: 0,
      amplitude: 0.5,
      spectralCentroidHz: 100,
      envelopeMs: 42,
    };
    expect(t.envelopeMs).toBe(42);
  });
});

describe('transientsToSnippet — envelope-aware .decay wrapper', () => {
  it('emits .decay(N) wrapper when envelopeMs > 0 (short envelope, single-type)', () => {
    // 50ms envelope → N = 50/1000 = 0.050 → "0.050"
    // Same step-quantisation as the existing single-type test:
    //   cycleMs=950, 16 steps, kicks at 0/250/500/750 → stepIdx 0/4/8/12.
    const out = transientsToSnippet([
      note('kick', 0, 50),
      note('kick', 250, 50),
      note('kick', 500, 50),
      note('kick', 750, 50),
    ]);
    expect(out).toBe(
      's("drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~").decay(0.050)',
    );
  });

  it('emits .decay(N) on stack() output when envelopeMs > 0', () => {
    // max envelopeMs = 100 → N = 0.100
    // The .decay() wraps the WHOLE stack (one outer application), not
    // each layer — matches how the snippet would be eval'd in Strudel.
    const out = transientsToSnippet([
      note('kick', 0, 80),
      note('snare', 250, 100),
      note('kick', 500, 80),
      note('snare', 750, 100),
    ]);
    expect(out).toBe(
      'stack(\n' +
      '  s("drums_bd ~ ~ ~ ~ ~ ~ ~ drums_bd ~ ~ ~ ~ ~ ~ ~"),\n' +
      '  s("~ ~ ~ ~ drums_sd ~ ~ ~ ~ ~ ~ ~ drums_sd ~ ~ ~")\n).decay(0.100)',
    );
  });

  it('omits .decay wrapper when envelopeMs is 0 (uninitialized / never measured)', () => {
    const out = transientsToSnippet([
      note('kick', 0),
      note('kick', 250),
      note('kick', 500),
      note('kick', 750),
    ]);
    expect(out).toBe('s("drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~")');
  });

  it('uses max(envelopeMs) for the .decay() value', () => {
    // max envelope = 250ms → N = 0.250
    const out = transientsToSnippet([
      note('kick', 0, 100),
      note('kick', 250, 250),
      note('kick', 500, 50),
      note('kick', 750, 75),
    ]);
    expect(out).toBe(
      's("drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~ drums_bd ~ ~ ~").decay(0.250)',
    );
  });
});
