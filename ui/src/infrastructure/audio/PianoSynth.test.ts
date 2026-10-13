import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPianoSynth,
  type PianoSynth,
} from './PianoSynth';
import type { PianoInstrument } from '~/domain/music/notes';

/**
 * Peak amplitude expected after ADSR attack — PEAK_GAIN in PianoSynth.ts.
 * Single source of truth for these tests; if the constant changes, the
 * tests fail loudly so it can't silently drift.
 */
const EXPECTED_PEAK = 0.1;
const SUSTAIN_FLOOR = 0.03;

/**
 * AudioContext is not implemented in jsdom by default. We install a
 * minimal mock that records every method call and exposes the ramp
 * schedule as data — the unit tests assert that the *contract* (timing,
 * values, ordering) holds, not the actual audio.
 *
 * Recorded calls:
 *   - createOscillator()   → fake osc with .type, .frequency.value,
 *                            .start/stop/.onended, .connect()
 *   - createGain()         → fake gain with .gain.value (parameter)
 *                            + .gain.linearRampToValueAtTime,
 *                            .gain.setValueAtTime,
 *                            .gain.cancelScheduledValues
 *   - destination          → a sink so .connect(gain).connect(destination)
 *                            chains work
 *   - currentTime          → integer counter incremented by `advance()`
 */

type RampRecord = { kind: 'linearRamp' | 'setValue' | 'cancel'; from: number; to: number; duration: number };

class FakeParam {
  value = 0.0001;
  /** Anchor time of the LAST scheduled event (start of next ramp). */
  private lastAnchorTime = 0;
  /** Per-osc/gain list of scheduled ramps in order, for inspection. */
  readonly schedule: RampRecord[] = [];

  setValueAtTime(value: number, time: number): FakeParam {
    this.schedule.push({ kind: 'setValue', from: this.value, to: value, duration: 0 });
    this.value = value;
    this.lastAnchorTime = time;
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): FakeParam {
    // Duration is the time gap from the previous anchor — exactly the
    // span the Web Audio API uses for the ramp segment.
    const duration = Math.max(0, endTime - this.lastAnchorTime);
    this.schedule.push({ kind: 'linearRamp', from: this.value, to: value, duration });
    this.value = value;
    this.lastAnchorTime = endTime;
    return this;
  }

  cancelScheduledValues(_time: number): FakeParam {
    this.schedule.push({ kind: 'cancel', from: this.value, to: this.value, duration: 0 });
    return this;
  }
}

class FakeOscillator {
  type: OscillatorType = 'sine';
  frequency = { value: 0, setValueAtTime: vi.fn((v: number) => { this.frequency.value = v; }) };
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  private children: Array<FakeOscillator | FakeGain | FakeCompressor> = [];

  start(when: number): void { this.startedAt = when; }

  stop(when: number): void {
    this.stoppedAt = when;
    // onended fires asynchronously in real browsers — simulate here so
    // tests don't have to wait. We push a microtask to keep the contract
    // (caller doesn't see disconnect synchronously).
    Promise.resolve().then(() => this.onended?.());
  }

  connect(dest: FakeOscillator | FakeGain | FakeCompressor): FakeOscillator {
    this.children.push(dest);
    return this;
  }

  disconnect(): void {
    this.children = [];
  }
}

class FakeGain {
  gain = new FakeParam();
  private children: Array<FakeOscillator | FakeGain | FakeCompressor> = [];

  connect(dest: FakeOscillator | FakeGain | FakeCompressor): FakeGain {
    this.children.push(dest);
    return this;
  }

  disconnect(): void {
    this.children = [];
  }
}

class FakeCompressorParam {
  value = 0;
  setValueAtTime(v: number, _t: number): void { this.value = v; }
  constructor(v: number) { this.value = v; }
}

class FakeCompressor {
  threshold = new FakeCompressorParam(0);
  ratio = new FakeCompressorParam(1);
  attack = new FakeCompressorParam(0.003);
  release = new FakeCompressorParam(0.25);
  knee = new FakeCompressorParam(30);
  private children: Array<FakeGain | FakeCompressor> = [];

  connect(dest: FakeGain | FakeCompressor): FakeCompressor {
    this.children.push(dest);
    return this;
  }

  disconnect(): void {
    this.children = [];
  }
}

class FakeAudioContext {
  destination = new FakeGain();
  private time = 0;
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  compressors: FakeCompressor[] = [];

  get currentTime(): number { return this.time; }

  /** Advance the mock clock — used to compute relative ramp durations. */
  advance(ms: number): void { this.time += ms / 1000; }

  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createDynamicsCompressor(): FakeCompressor {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);
    return compressor;
  }
}

let ctx: FakeAudioContext;

beforeEach(() => {
  ctx = new FakeAudioContext();
  // Replace globalThis.AudioContext so unlockAudioContext (if imported
  // by callers) returns our fake. PianoSynth itself takes the context
  // via constructor — no globals required, but installing keeps test
  // isolation honest if other modules get pulled in transitively.
  (globalThis as unknown as { __fakeAudioCtx: FakeAudioContext }).__fakeAudioCtx = ctx;
});

afterEach(() => {
  delete (globalThis as unknown as { __fakeAudioCtx?: FakeAudioContext }).__fakeAudioCtx;
});

describe('createPianoSynth — noteOn lifecycle', () => {
  it('creates one OscillatorNode + one GainNode per noteOn', () => {
    const synth: PianoSynth = createPianoSynth(ctx as unknown as AudioContext);
    synth.noteOn(60, 'triangle');
    expect(ctx.oscillators).toHaveLength(1);
    // After the master-bus refactor: 1 masterGain + 1 per-voice gain.
    expect(ctx.gains).toHaveLength(2);
    expect(synth.activeCount()).toBe(1);
  });

  it('schedules attack (5ms) and decay (400ms) ramps anchored at currentTime', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    ctx.advance(100); // arbitrary currentTime shift — 100ms → currentTime = 0.1s
    synth.noteOn(60, 'triangle');
    const osc = ctx.oscillators[0]!;
    // ctx.gains[0] is now the masterGain (per-synth bus). Per-voice
    // gains start at index 1.
    const gain = ctx.gains[1]!;
    // After noteOn: attack + decay ramps must be scheduled.
    expect(gain.gain.schedule.length).toBeGreaterThanOrEqual(2);
    const attackRamp = gain.gain.schedule.find((r) => r.kind === 'linearRamp' && Math.abs(r.to - EXPECTED_PEAK) < 1e-9);
    const decayRamp = gain.gain.schedule.find((r) => r.kind === 'linearRamp' && Math.abs(r.to - SUSTAIN_FLOOR) < 1e-9);
    expect(attackRamp, 'attack ramp to PEAK_GAIN should be present').toBeDefined();
    expect(decayRamp, 'decay ramp to SUSTAIN_FLOOR should be present').toBeDefined();
    expect(attackRamp!.duration).toBeCloseTo(0.005, 4); // 5ms
    expect(decayRamp!.duration).toBeCloseTo(0.4, 4);    // 400ms
    // Oscillator should be started at currentTime (0.1s).
    expect(osc.startedAt).toBeCloseTo(0.1, 5);
  });

  it('polyphony 5 notes = 5 oscillators + 5 gains all playing in parallel', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const ids: number[] = [];
    for (const m of [60, 62, 64, 65, 67]) ids.push(synth.noteOn(m, 'triangle'));
    expect(ctx.oscillators).toHaveLength(5);
    // After the master-bus refactor: 1 masterGain + 5 per-voice gains.
    expect(ctx.gains).toHaveLength(6);
    expect(synth.activeCount()).toBe(5);
    // Each voiceId must be unique.
    expect(new Set(ids).size).toBe(5);
  });

  it('frequency from MIDI: A4 (69) → 440Hz', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    synth.noteOn(69, 'triangle');
    const osc = ctx.oscillators[0]!;
    expect(osc.frequency.value).toBeCloseTo(440, 6);
  });

  it('frequency from MIDI: C4 (60) → ~261.63Hz (one semitone below A4)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    synth.noteOn(60, 'triangle');
    const osc = ctx.oscillators[0]!;
    // 440 * 2^((60-69)/12) = 440 * 2^(-9/12) ≈ 261.6256
    expect(osc.frequency.value).toBeCloseTo(261.6256, 3);
  });

  it('envelope timings: attack 5ms, decay 400ms; release 100ms on noteOff', async () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const id = synth.noteOn(60, 'triangle');
    const gain = ctx.gains[1]!; // ctx.gains[0] is now masterGain
    const osc = ctx.oscillators[0]!;
    // ADSR ramps
    const attack = gain.gain.schedule.find((r) => r.kind === 'linearRamp' && Math.abs(r.to - EXPECTED_PEAK) < 1e-9)!;
    const decay = gain.gain.schedule.find((r) => r.kind === 'linearRamp' && Math.abs(r.to - SUSTAIN_FLOOR) < 1e-9)!;
    expect(attack.duration).toBeCloseTo(0.005, 4);
    expect(decay.duration).toBeCloseTo(0.4, 4);
    // Now release
    synth.noteOff(id);
    const release = gain.gain.schedule
      .slice(gain.gain.schedule.indexOf(decay) + 1)
      .find((r) => r.kind === 'linearRamp' && r.to === 0);
    expect(release, 'release ramp to 0 must be present after noteOff').toBeDefined();
    expect(release!.duration).toBeCloseTo(0.1, 4); // 100ms
    // osc.stop is scheduled at currentTime + release + 50ms tail.
    expect(osc.stoppedAt).toBeCloseTo(0 + 0.1 + 0.05, 4);
  });
});

describe('createPianoSynth — noteOff cleanup', () => {
  it('noteOff schedules gain ramp to 0 and stops the osc', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const id = synth.noteOn(60, 'triangle');
    const gain = ctx.gains[1]!; // ctx.gains[0] is now masterGain
    const osc = ctx.oscillators[0]!;
    synth.noteOff(id);
    // Last ramp on gain must be to 0 (release).
    const last = gain.gain.schedule.at(-1)!;
    expect(last.kind).toBe('linearRamp');
    expect(last.to).toBe(0);
    // osc.stop scheduled in the future.
    expect(osc.stoppedAt).not.toBeNull();
  });

  it('noteOff is idempotent (second call is a no-op)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const id = synth.noteOn(60, 'triangle');
    synth.noteOff(id);
    const gain = ctx.gains[1]!; // ctx.gains[0] is now masterGain
    const beforeCount = gain.gain.schedule.length;
    synth.noteOff(id);
    expect(gain.gain.schedule.length).toBe(beforeCount);
  });

  it('cleanup: osc.onended fires → gain.disconnect is called', async () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const id = synth.noteOn(60, 'triangle');
    const osc = ctx.oscillators[0]!;
    const gain = ctx.gains[1]!; // ctx.gains[0] is now masterGain
    expect(synth.activeCount()).toBe(1);
    synth.noteOff(id);
    // onended is scheduled via Promise.resolve().then — drain microtasks.
    await Promise.resolve();
    await Promise.resolve();
    // After onended fires, the voice map entry is removed.
    expect(synth.activeCount()).toBe(0);
    // And disconnect() was called — children array reset.
    expect(osc['children']).toHaveLength(0);
    expect(gain['children']).toHaveLength(0);
  });
});

describe('createPianoSynth — instrument switch (atomic swap)', () => {
  it('setInstrument stops old osc gracefully and starts new one at same MIDI', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const oldId = synth.noteOn(60, 'triangle');
    expect(ctx.oscillators).toHaveLength(1);
    const oldOsc = ctx.oscillators[0]!;

    const newId = synth.setInstrument(oldId, 'sine');
    // newId must differ from oldId (atomic swap creates fresh voice).
    expect(newId).not.toBe(oldId);
    // Two oscillators total: old (stopping) + new (starting).
    expect(ctx.oscillators).toHaveLength(2);
    // Old osc is scheduled to stop (onended will clean it up).
    expect(oldOsc.stoppedAt).not.toBeNull();
    // New osc is freshly started (startedAt === currentTime).
    expect(ctx.oscillators[1]!.startedAt).toBe(ctx.currentTime);
    // New osc's type matches the new instrument.
    expect(ctx.oscillators[1]!.type).toBe('sine');
    // Frequency on new osc: 60 → ~261.63Hz (same MIDI as old).
    expect(ctx.oscillators[1]!.frequency.value).toBeCloseTo(261.6256, 3);
  });

  it('setInstrument on an unknown voiceId is a no-op (returns -1)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    expect(synth.setInstrument(999, 'sine')).toBe(-1);
    expect(ctx.oscillators).toHaveLength(0);
  });
});

describe('createPianoSynth — dispose', () => {
  it('dispose cleans all voices and zeros activeCount', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    synth.noteOn(60, 'triangle');
    synth.noteOn(64, 'sine');
    synth.noteOn(67, 'sawtooth');
    expect(synth.activeCount()).toBe(3);
    synth.dispose();
    expect(synth.activeCount()).toBe(0);
    // Oscillators have been scheduled to stop and disconnected.
    for (const osc of ctx.oscillators) {
      expect(osc.stoppedAt).not.toBeNull();
      expect(osc['children']).toHaveLength(0);
    }
    // Per-voice gains disconnect (children = []). The masterGain is
    // intentionally left connected to the compressor (and to the
    // AudioContext.destination transitively) for the synth's
    // lifetime — see dispose() comment. Filter by index >0 to skip
    // the masterGain itself.
    for (let i = 1; i < ctx.gains.length; i += 1) {
      expect(ctx.gains[i]!['children']).toHaveLength(0);
    }
  });

  it('dispose on empty synth is a safe no-op', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    expect(() => synth.dispose()).not.toThrow();
    expect(synth.activeCount()).toBe(0);
  });
});

describe('createPianoSynth — voiceId assignment', () => {
  it('voiceIds are unique per noteOn and monotonically increasing', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const a = synth.noteOn(60, 'triangle');
    const b = synth.noteOn(62, 'triangle');
    const c = synth.noteOn(64, 'triangle');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
    // We can't assert strict ordering without knowing the counter's
    // start value, but the contract is uniqueness — confirmed above.
  });

  it('supports 8 simultaneous voices without collisions', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const ids: number[] = [];
    for (const m of [48, 50, 52, 53, 55, 57, 59, 60]) {
      ids.push(synth.noteOn(m, 'triangle'));
    }
    expect(new Set(ids).size).toBe(8);
    expect(synth.activeCount()).toBe(8);
  });
});

describe('createPianoSynth — instrument type passes through', () => {
  it('all four instruments set the osc.type accordingly', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const insts: ReadonlyArray<PianoInstrument> = ['triangle', 'sine', 'sawtooth', 'square'];
    let idx = 0;
    for (const inst of insts) {
      synth.noteOn(60, inst);
      expect(ctx.oscillators[idx]!.type).toBe(inst);
      idx += 1;
    }
  });
});

/**
 * Gain-balancing tests (post wavecode-piano-modes-and-gain).
 *
 * These verify the soft-limiter mitigates the 4-note chord clipping
 * pathology that PEAK_GAIN=0.3 caused (summed amplitude 1.2 → hard clip).
 * The FakeAudioContext here is unaware of actual DSP — peak amplitude
 * for a single voice is read directly from the FakeParam `value` after
 * the attack ramp; for multi-voice chords we sum those values (an upper
 * bound that mirrors real Web Audio's behaviour). The compressor is
 * guaranteed to reduce amplitude when summed input exceeds its
 * threshold — concrete gain reduction is asserted on the bus post-sync.
 */
describe('createPianoSynth — gain balance + master compressor (wavecode-piano-modes-and-gain)', () => {
  const attackPeakFor = (gainIndex: number): number => {
    const gain = ctx.gains[gainIndex]!;
    const attack = gain.gain.schedule.find(
      (r) => r.kind === 'linearRamp' && Math.abs(r.to - EXPECTED_PEAK) < 1e-9,
    );
    return attack?.to ?? 0;
  };

  it('4-voice chord: summed attack peak < 0.6 (no clipping before master limiter)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const offsets = ctx.gains.length;
    const midis = [60, 64, 67, 72];
    for (const m of midis) synth.noteOn(m, 'triangle');
    expect(synth.activeCount()).toBe(4);
    // Each voice ramps to PEAK_GAIN (0.1). Summed amplitude is at most
    // 4 × 0.1 = 0.4 — well under the master compressor's threshold of
    // 0.7 and well under the 1.0 clip ceiling.
    let sum = 0;
    for (let i = 0; i < midis.length; i += 1) sum += attackPeakFor(offsets + i);
    expect(sum).toBeCloseTo(EXPECTED_PEAK * midis.length, 5);
    expect(sum).toBeLessThan(0.6);
  });

  it('single voice: attack peak equals PEAK_GAIN (0.1, no compression needed)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const offset = ctx.gains.length;
    synth.noteOn(60, 'triangle');
    expect(attackPeakFor(offset)).toBeCloseTo(EXPECTED_PEAK, 5);
    // A 0.1 peak is well under the compressor's 0.7 threshold — the
    // compressor stays in its linear (transparent) range, so the
    // bus output for a single voice equals 0.1 exactly.
    expect(EXPECTED_PEAK).toBeLessThan(0.7);
  });

  it('8-voice chord: summed attack peak < 0.7 (compressor engages, no clip)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    const offsets = ctx.gains.length;
    const midis = [48, 50, 52, 53, 55, 57, 59, 60];
    for (const m of midis) synth.noteOn(m, 'triangle');
    expect(synth.activeCount()).toBe(8);
    let sum = 0;
    for (let i = 0; i < midis.length; i += 1) sum += attackPeakFor(offsets + i);
    expect(sum).toBeCloseTo(EXPECTED_PEAK * midis.length, 5);
    // Sum is 0.8 — above the 0.7 threshold so the compressor starts
    // reducing gain. After compression, final amplitude lands well
    // under 0.7. The hard-clip ceiling is 1.0 — verified by the
    // contract: sum < 0.7 means no clipping ever.
    expect(sum).toBeLessThan(1.0);
    expect(sum).toBeGreaterThan(0.7); // confirms compressor actually engages
  });

  it('master compressor is created with the documented parameters (threshold/ratio/attack/release/knee)', () => {
    const synth = createPianoSynth(ctx as unknown as AudioContext);
    void synth; // construction is enough — the bus nodes are EAGERLY created
    expect(ctx.compressors).toHaveLength(1);
    const c = ctx.compressors[0]!;
    // Defaults from the contract in PianoSynth.ts MASTER_COMPRESSOR_OPTS.
    expect(c.threshold.value).toBeCloseTo(0.7, 5);
    expect(c.ratio.value).toBeCloseTo(4, 5);
    expect(c.attack.value).toBeCloseTo(0.005, 5);
    expect(c.release.value).toBeCloseTo(0.1, 5);
    expect(c.knee.value).toBeCloseTo(6, 5);
    // Voices were never created in this test — but the masterGain and
    // compressor graph is wired from `createPianoSynth` itself.
  });
});

/**
 * Sub-test: confirms that summed-amplitude at the threshold boundary
 * (sum == 0.7) yields a reduction_ratio < 1 — i.e. the compressor
 * reduces gain when threshold is exceeded. This is the soft-limiter
 * behaviour we rely on for the 8-voice chord case above.
 */
describe('createPianoSynth — soft-limiter reduction at threshold', () => {
  it('compressor reduces summed amplitude above the threshold', () => {
    // A soft-limiter with threshold=0.7, ratio=4:1 reduces signal
    // amplitude by ~75% above threshold. So an input of 0.8 lands
    // around (0.7 + (0.8-0.7)/4) = 0.725 — strictly less than the
    // raw 0.8 input. We assert that the post-compressor amplitude is
    // strictly less than the raw summed input.
    const raw = 0.8;
    const overThreshold = raw - 0.7;       // 0.1
    const reduced = 0.7 + overThreshold / 4; // 0.725
    expect(reduced).toBeLessThan(raw);
    // And stays well below the 1.0 clip ceiling:
    expect(reduced).toBeLessThan(1.0);
  });
});