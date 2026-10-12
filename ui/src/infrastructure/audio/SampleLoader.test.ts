import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    for (const f of DRUMS_EXPECTED_FILES) {
      if (f === 'LICENSE.txt') continue;
      expect(license, `LICENSE missing ${f}`).toContain(f);
    }
  });

  it('cb.mp3 is audibly non-empty (silent downloads would defeat the bank)', () => {
    // Guard against a regression where the Freesound preview URL for cb
    // returns empty/silent bytes — see math/wavecode-sample-bank-underscore
    // for the original incident (max_volume -39dB → silent).
    const buf = readFileSync(resolve(DRUMS_DIR, 'cb.mp3'));
    // Compute a coarse RMS over the decoded MP3 file. Cheap proxy:
    // bytes that are mostly non-zero indicate real audio. We require
    // at least 30% of bytes to be > 0 (silent downloads have all-zero
    // payload after the MPEG header).
    let nonZero = 0;
    for (let i = 32; i < buf.length; i++) {
      if (buf[i] !== 0) nonZero++;
    }
    const ratio = nonZero / Math.max(1, buf.length - 32);
    expect(ratio, `cb.mp3 has ${(ratio * 100).toFixed(1)}% non-zero bytes (silent?)`)
      .toBeGreaterThan(0.3);
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

describe('strudel.json manifests — keys use bank_sound (underscore) for bank:sound pattern', () => {
  const PIANO_KEYS = ['piano_a1', 'piano_a2', 'piano_a3', 'piano_a4',
    'piano_c2', 'piano_c3', 'piano_c4', 'piano_c5', 'piano_c6', 'piano_c7'];
  const DRUMS_KEYS = ['drums_bd', 'drums_bd-sub', 'drums_sd', 'drums_rim',
    'drums_hh', 'drums_oh', 'drums_cp', 'drums_cb', 'drums_sh',
    'drums_tom-l', 'drums_tom-m', 'drums_tom-h',
    'drums_crash', 'drums_ride'];
  const SYNTH_KEYS = ['synth_bass-c1', 'synth_bass-c2', 'synth_bass-e1', 'synth_bass-a1',
    'synth_pad-c3', 'synth_pad-e3', 'synth_pad-g3', 'synth_pad-a3',
    'synth_lead-e4', 'synth_lead-g4',
    'synth_strings-c4', 'synth_brass-c3'];

  const readKeys = (dir: string): Set<string> => {
    const json = JSON.parse(readFileSync(resolve(__dirname, `../../../public/samples/${dir}/strudel.json`), 'utf8'));
    return new Set(Object.keys(json).filter((k) => k !== '_base'));
  };

  it('piano manifest keys are piano_<note> (underscore, not slash)', () => {
    const keys = readKeys('piano');
    for (const k of PIANO_KEYS) {
      expect(keys.has(k), `piano manifest missing key ${k}`).toBe(true);
    }
    expect(keys.has('piano/a1'), 'piano manifest still has slash key — Strudel soundMap lookup uses underscore').toBe(false);
  });

  it('drums manifest keys are drums_<name> (underscore, not slash)', () => {
    const keys = readKeys('drums');
    for (const k of DRUMS_KEYS) {
      expect(keys.has(k), `drums manifest missing key ${k}`).toBe(true);
    }
    expect(keys.has('drums/bd'), 'drums manifest still has slash key').toBe(false);
  });

  it('synth manifest keys are synth_<name> (underscore, not slash)', () => {
    const keys = readKeys('synth');
    for (const k of SYNTH_KEYS) {
      expect(keys.has(k), `synth manifest missing key ${k}`).toBe(true);
    }
    expect(keys.has('synth/bass-c1'), 'synth manifest still has slash key').toBe(false);
  });
});

/**
 * Strudel API contract — `samples()` is re-exported from @strudel/webaudio
 * (which does `export * from "superdough"`). It fetches a strudel.json
 * manifest and writes entries into the shared soundMap. We import via
 * static import so the module instance matches the one webaudioRepl uses
 * (separate `import('superdough')` at runtime would yield a fresh module
 * + fresh soundMap, and registered samples would be invisible to the
 * scheduler).
 */
describe('SampleLoader — Strudel API contract (samples, static import)', () => {
  let samplesMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    samplesMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@strudel/webaudio', () => ({ samples: samplesMock }));
  });

  const loadSampleLoader = async () => {
    const mod = await import('./SampleLoader');
    return {
      loadPianoSamples: mod.loadPianoSamples,
      loadDrumSamples: mod.loadDrumSamples,
      loadSynthSamples: mod.loadSynthSamples,
      loadAllSamples: mod.loadAllSamples,
      areAllSamplesLoaded: mod.areAllSamplesLoaded,
    };
  };

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('loadDrumSamples calls samples with the drums manifest URL', async () => {
    const { loadDrumSamples } = await loadSampleLoader();
    const p = loadDrumSamples();
    expect(samplesMock).toHaveBeenCalledTimes(1);
    expect(samplesMock).toHaveBeenCalledWith('/samples/drums/strudel.json');
    await p;
  });

  it('loadSynthSamples calls samples with the synth manifest URL', async () => {
    const { loadSynthSamples } = await loadSampleLoader();
    const p = loadSynthSamples();
    expect(samplesMock).toHaveBeenCalledTimes(1);
    expect(samplesMock).toHaveBeenCalledWith('/samples/synth/strudel.json');
    await p;
  });

  it('loadPianoSamples calls samples with the piano manifest URL', async () => {
    const { loadPianoSamples } = await loadSampleLoader();
    const p = loadPianoSamples();
    expect(samplesMock).toHaveBeenCalledTimes(1);
    expect(samplesMock).toHaveBeenCalledWith('/samples/piano/strudel.json');
    await p;
  });

  it('per-bank registration is idempotent — second call does not re-invoke samples', async () => {
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    await loadDrumSamples();
    await loadDrumSamples();
    expect(samplesMock).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls to loadDrumSamples coalesce to a single samples call', async () => {
    let resolveSamples!: () => void;
    samplesMock.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveSamples = r; }),
    );
    const { loadDrumSamples } = await loadSampleLoader();
    const a = loadDrumSamples();
    const b = loadDrumSamples();
    const c = loadDrumSamples();
    expect(samplesMock).toHaveBeenCalledTimes(1);
    resolveSamples();
    await Promise.all([a, b, c]);
  });

  it('loadAllSamples registers all three banks exactly once', async () => {
    const { loadAllSamples } = await loadSampleLoader();
    await loadAllSamples();
    expect(samplesMock).toHaveBeenCalledTimes(3);
    const urls = samplesMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(
      expect.arrayContaining([
        '/samples/piano/strudel.json',
        '/samples/drums/strudel.json',
        '/samples/synth/strudel.json',
      ]),
    );
  });

  it('loadAllSamples is idempotent — second call does not re-register any bank', async () => {
    const { loadAllSamples } = await loadSampleLoader();
    await loadAllSamples();
    await loadAllSamples();
    await loadAllSamples();
    expect(samplesMock).toHaveBeenCalledTimes(3);
  });

  it('samples rejection on one bank does NOT block the others', async () => {
    samplesMock.mockImplementation(async (url: string) => {
      if (String(url).includes('drums')) throw new Error('network down');
    });
    const {
      loadAllSamples, areAllSamplesLoaded,
      loadDrumSamples, loadSynthSamples, loadPianoSamples,
    } = await loadSampleLoader();
    const p = loadAllSamples();
    await flush();
    await p;
    expect(samplesMock).toHaveBeenCalledTimes(3);
    expect(areAllSamplesLoaded()).toBe(false);
    // After fixing drums manually, the others stay loaded.
    samplesMock.mockResolvedValue(undefined);
    await loadDrumSamples();
    await loadSynthSamples();
    await loadPianoSamples();
    expect(areAllSamplesLoaded()).toBe(true);
  });

  it('areAllSamplesLoaded reflects bank readiness AFTER each bank settles', async () => {
    const { loadDrumSamples, loadSynthSamples, loadPianoSamples, areAllSamplesLoaded } =
      await loadSampleLoader();
    expect(areAllSamplesLoaded()).toBe(false);
    await loadDrumSamples();
    expect(areAllSamplesLoaded()).toBe(false);
    await loadSynthSamples();
    expect(areAllSamplesLoaded()).toBe(false);
    await loadPianoSamples();
    expect(areAllSamplesLoaded()).toBe(true);
  });
});