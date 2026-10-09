import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DRUMS_DIR = resolve(__dirname, '../../../public/samples/drums');
const EXPECTED_FILES = [
  'bd.mp3', 'bd-sub.mp3', 'sd.mp3', 'hh.mp3', 'oh.mp3',
  'cp.mp3', 'rim.mp3', 'tom-l.mp3', 'tom-m.mp3', 'tom-h.mp3',
  'crash.mp3', 'ride.mp3', 'sh.mp3', 'cb.mp3', 'LICENSE.txt',
];

describe('drum sample pack — file inventory', () => {
  it('drums directory exists under public/samples/', () => {
    expect(existsSync(DRUMS_DIR)).toBe(true);
  });

  it('all 14 expected drum samples + LICENSE.txt are present', () => {
    const present = new Set(readdirSync(DRUMS_DIR));
    for (const f of EXPECTED_FILES) {
      expect(present.has(f), `missing file: ${f}`).toBe(true);
    }
  });

  it('every drum sample is > 1KB (no empty / placeholder files)', () => {
    for (const f of EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      const path = resolve(DRUMS_DIR, f);
      const size = statSync(path).size;
      expect(size, `${f} too small (${size} bytes)`).toBeGreaterThan(1024);
    }
  });

  it('every drum sample begins with MPEG sync marker (FF Fx)', () => {
    for (const f of EXPECTED_FILES) {
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
    for (const f of EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      // LICENSE lists each by base name (no extension), e.g. "bd.mp3"
      expect(license, `LICENSE missing ${f}`).toContain(f);
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

  it('loadAllSamples registers BOTH banks in one call', async () => {
    const { loadAllSamples } = await import('./SampleLoader');
    loadAllSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(2);
    const calls = samplesFn.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ piano: './samples/piano/' });
    expect(calls).toContainEqual({ drums: './samples/drums/' });
  });

  it('loadAllSamples is idempotent — second call does not re-register', async () => {
    const { loadAllSamples } = await import('./SampleLoader');
    loadAllSamples();
    loadAllSamples();
    loadAllSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(2);
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

  it('loadPianoSamples back-compat re-export still works', async () => {
    const { loadPianoSamples } = await import('./SampleLoader');
    loadPianoSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledWith({ piano: './samples/piano/' });
  });

  it('areAllSamplesLoaded reflects registration state', async () => {
    const { loadAllSamples, areAllSamplesLoaded } = await import('./SampleLoader');
    expect(areAllSamplesLoaded()).toBe(false);
    loadAllSamples();
    expect(areAllSamplesLoaded()).toBe(true);
  });
});
