import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DRUMS_DIR = resolve(__dirname, '../../../public/samples/drums');
const DRUMS_EXPECTED_FILES = [
  'bd.mp3', 'bd-sub.mp3', 'sd.mp3', 'hh.mp3', 'oh.mp3',
  'cp.mp3', 'rim.mp3', 'tom-l.mp3', 'tom-m.mp3', 'tom-h.mp3',
  'crash.mp3', 'ride.mp3', 'sh.mp3', 'cb.mp3', 'LICENSE.txt',
];

const SYNTH_DIR = resolve(__dirname, '../../../public/samples/synth');
const SYNTH_EXPECTED_FILES = [
  'bass-c1.mp3', 'bass-c2.mp3', 'bass-e1.mp3', 'bass-a1.mp3',
  'pad-c3.mp3', 'pad-e3.mp3', 'pad-g3.mp3', 'pad-a3.mp3',
  'lead-e4.mp3', 'lead-g4.mp3',
  'strings-c4.mp3', 'brass-c3.mp3',
  'LICENSE.txt',
];

describe('drum sample pack — file inventory', () => {
  it('drums directory exists under public/samples/', () => {
    expect(existsSync(DRUMS_DIR)).toBe(true);
  });

  it('all 14 expected drum samples + LICENSE.txt are present', () => {
    const present = new Set(readdirSync(DRUMS_DIR));
    for (const f of DRUMS_EXPECTED_FILES) {
      expect(present.has(f), `missing file: ${f}`).toBe(true);
    }
  });

  it('every drum sample is > 1KB (no empty / placeholder files)', () => {
    for (const f of DRUMS_EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      const path = resolve(DRUMS_DIR, f);
      const size = statSync(path).size;
      expect(size, `${f} too small (${size} bytes)`).toBeGreaterThan(1024);
    }
  });

  it('every drum sample begins with MPEG sync marker (FF Fx)', () => {
    for (const f of DRUMS_EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      const buf = readFileSync(resolve(DRUMS_DIR, f));
      // MPEG audio frame sync: first 11 bits all 1 → first byte 0xFF, second byte 0xE0+ (binary 111xxxxx).
      expect(buf[0], `${f} first byte is 0x${buf[0]?.toString(16)}`).toBe(0xff);
      expect(buf[1]! & 0xe0, `${f} second byte is 0x${buf[1]?.toString(16)}`).toBe(0xe0);
    }
  });

  it('LICENSE.txt exists and is non-empty', () => {
    const license = readFileSync(resolve(DRUMS_DIR, 'LICENSE.txt'), 'utf8');
    expect(license.length).toBeGreaterThan(50);
    expect(license).toMatch(/CC0|Creative Commons/);
  });

  it('LICENSE.txt contains attribution for all 14 samples', () => {
    const license = readFileSync(resolve(DRUMS_DIR, 'LICENSE.txt'), 'utf8');
    // 14 drum files => 14 attribution lines (one per file).
    for (const f of DRUMS_EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      // LICENSE lists each by base name (no extension), e.g. "bd.mp3"
      expect(license, `LICENSE missing ${f}`).toContain(f);
    }
  });
});

describe('synth sample pack — file inventory (CC0 analog bass + pad + lead + brass + strings)', () => {
  it('synth directory exists under public/samples/', () => {
    expect(existsSync(SYNTH_DIR)).toBe(true);
  });

  it('all 12 expected synth samples + LICENSE.txt are present', () => {
    const present = new Set(readdirSync(SYNTH_DIR));
    for (const f of SYNTH_EXPECTED_FILES) {
      expect(present.has(f), `missing file: ${f}`).toBe(true);
    }
  });

  it('every synth sample is > 5KB (real audio, not stub)', () => {
    for (const f of SYNTH_EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      const path = resolve(SYNTH_DIR, f);
      const size = statSync(path).size;
      expect(size, `${f} too small (${size} bytes)`).toBeGreaterThan(5 * 1024);
    }
  });

  it('every synth sample begins with MPEG sync marker (FF Fx)', () => {
    for (const f of SYNTH_EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      const buf = readFileSync(resolve(SYNTH_DIR, f));
      expect(buf[0], `${f} first byte is 0x${buf[0]?.toString(16)}`).toBe(0xff);
      expect(buf[1]! & 0xf0, `${f} second byte is 0x${buf[1]?.toString(16)}`).toBe(0xf0);
    }
  });

  it('LICENSE.txt mentions CC0 and lists all 12 sample sources', () => {
    const txt = readFileSync(resolve(SYNTH_DIR, 'LICENSE.txt'), 'utf8');
    expect(txt).toMatch(/CC0/);
    expect(txt).toMatch(/Creative Commons CC0/);
    for (const s of SYNTH_EXPECTED_FILES) {
      if (s === 'LICENSE.txt') continue;
      expect(txt, `LICENSE.txt missing ${s}`).toContain(s);
    }
  });

  it('LICENSE.txt attributes every sample to a Freesound user', () => {
    const txt = readFileSync(resolve(SYNTH_DIR, 'LICENSE.txt'), 'utf8');
    const expectedUsers = ['Vanyamba', 'menegass', 'Garzul', 'CAT-FOX_ALEX', 'brotherandroid'];
    for (const u of expectedUsers) {
      expect(txt, `LICENSE.txt missing attribution to ${u}`).toContain(u);
    }
  });
});

describe('SampleLoader (uses globalThis.samples from Strudel evalScope)', () => {
  let originalSamples: unknown;

  beforeEach(async () => {
    vi.resetModules();
    originalSamples = (globalThis as Record<string, unknown>).samples;
    (globalThis as Record<string, unknown>).samples = vi.fn();
  });

  afterEach(() => {
    if (originalSamples === undefined) {
      delete (globalThis as Record<string, unknown>).samples;
    } else {
      (globalThis as Record<string, unknown>).samples = originalSamples;
    }
  });

  it('loadDrumSamples registers the drums bank on first call', async () => {
    const { loadDrumSamples } = await import('./SampleLoader');
    loadDrumSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
    expect(samplesFn).toHaveBeenCalledWith({ drums: './samples/drums/' });
  });

  it('loadDrumSamples is idempotent (single registration per session)', async () => {
    const { loadDrumSamples } = await import('./SampleLoader');
    loadDrumSamples();
    loadDrumSamples();
    loadDrumSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
  });

  it('loadSynthSamples registers the synth bank on first call', async () => {
    const { loadSynthSamples } = await import('./SampleLoader');
    loadSynthSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
    expect(samplesFn).toHaveBeenCalledWith({ synth: './samples/synth/' });
  });

  it('loadSynthSamples is idempotent (single registration per session)', async () => {
    const { loadSynthSamples } = await import('./SampleLoader');
    loadSynthSamples();
    loadSynthSamples();
    loadSynthSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
  });

  it('loadAllSamples registers ALL THREE banks (piano + drums + synth) in one call', async () => {
    const { loadAllSamples } = await import('./SampleLoader');
    loadAllSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(3);
    const calls = samplesFn.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ piano: './samples/piano/' });
    expect(calls).toContainEqual({ drums: './samples/drums/' });
    expect(calls).toContainEqual({ synth: './samples/synth/' });
  });

  it('loadAllSamples is idempotent — second call does not re-register', async () => {
    const { loadAllSamples } = await import('./SampleLoader');
    loadAllSamples();
    loadAllSamples();
    loadAllSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(3);
  });

  it('loadDrumSamples defers silently if globalThis.samples is undefined', async () => {
    delete (globalThis as Record<string, unknown>).samples;
    const { loadDrumSamples } = await import('./SampleLoader');
    expect(() => loadDrumSamples()).not.toThrow();
    (globalThis as Record<string, unknown>).samples = vi.fn();
    loadDrumSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
  });

  it('loadSynthSamples defers silently if globalThis.samples is undefined', async () => {
    delete (globalThis as Record<string, unknown>).samples;
    const { loadSynthSamples } = await import('./SampleLoader');
    expect(() => loadSynthSamples()).not.toThrow();
    (globalThis as Record<string, unknown>).samples = vi.fn();
    loadSynthSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
  });

  it('loadPianoSamples back-compat re-export still works', async () => {
    const { loadPianoSamples } = await import('./SampleLoader');
    loadPianoSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledWith({ piano: './samples/piano/' });
  });

  it('areAllSamplesLoaded reflects registration state for all three banks', async () => {
    const { loadAllSamples, areAllSamplesLoaded } = await import('./SampleLoader');
    expect(areAllSamplesLoaded()).toBe(false);
    loadAllSamples();
    expect(areAllSamplesLoaded()).toBe(true);
  });
});
