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
 * Strudel API contract — `samples()` and `soundMap` are re-exported from
 * @strudel/webaudio (which does `export * from "superdough"`). We mock
 * the surface so we can verify per-bank registration, idempotency,
 * and bare-name alias generation.
 */
describe('SampleLoader — Strudel API contract (samples, soundMap, static import)', () => {
  let samplesMock: ReturnType<typeof vi.fn>;
  let loadBufferMock: ReturnType<typeof vi.fn>;
  let soundMapStore: Record<string, { onTrigger: unknown; data: unknown }>;
  let subscribers: Array<() => void>;

  beforeEach(async () => {
    vi.resetModules();
    soundMapStore = {};
    subscribers = [];
    samplesMock = vi.fn().mockImplementation(async (input: string | Record<string, unknown>) => {
      if (typeof input !== 'string') return;
      // Simulate strudel.json fetch + processSampleMap: keys land in
      // soundMap with `bank_sound` style. Hyphens inside the sound name
      // (`bass-c2`, `tom-l`) are preserved as-is.
      const map: Record<string, string[]> = {
        '/samples/piano/strudel.json': {
          piano_a1: ['A1.mp3'], piano_a2: ['A2.mp3'], piano_a3: ['A3.mp3'], piano_a4: ['A4.mp3'],
          piano_c2: ['C2.mp3'], piano_c3: ['C3.mp3'], piano_c4: ['C4.mp3'],
          piano_c5: ['C5.mp3'], piano_c6: ['C6.mp3'], piano_c7: ['C7.mp3'],
        },
        '/samples/drums/strudel.json': {
          drums_bd: ['bd.mp3'], drums_bd_sub: ['bd-sub.mp3'], drums_sd: ['sd.mp3'],
          drums_rim: ['rim.mp3'], drums_hh: ['hh.mp3'], drums_oh: ['oh.mp3'],
          drums_cp: ['cp.mp3'], drums_cb: ['cb.mp3'], drums_sh: ['sh.mp3'],
          drums_tom_l: ['tom-l.mp3'], drums_tom_m: ['tom-m.mp3'], drums_tom_h: ['tom-h.mp3'],
          drums_crash: ['crash.mp3'], drums_ride: ['ride.mp3'],
        },
        '/samples/synth/strudel.json': {
          'synth_bass-c1': ['bass-c1.mp3'], 'synth_bass-c2': ['bass-c2.mp3'],
          'synth_bass-e1': ['bass-e1.mp3'], 'synth_bass-a1': ['bass-a1.mp3'],
          'synth_pad-c3': ['pad-c3.mp3'], 'synth_pad-e3': ['pad-e3.mp3'],
          'synth_pad-g3': ['pad-g3.mp3'], 'synth_pad-a3': ['pad-a3.mp3'],
          'synth_lead-e4': ['lead-e4.mp3'], 'synth_lead-g4': ['lead-g4.mp3'],
          'synth_strings-c4': ['strings-c4.mp3'], 'synth_brass-c3': ['brass-c3.mp3'],
        },
      }[input] ?? {};
      for (const [k, v] of Object.entries(map)) {
        soundMapStore[k] = { onTrigger: vi.fn(), data: { type: 'sample', samples: v } };
      }
    });
    // loadBufferMock: simulates superdough's preload (fetch+decode).
    // Returns a fake AudioBuffer-ish object — we only care that loadBuffer
    // was CALLED for each sample URL with the right bank label.
    loadBufferMock = vi.fn().mockResolvedValue({} as AudioBuffer);
    vi.doMock('@strudel/webaudio', () => ({
      samples: samplesMock,
      soundMap: {
        get: () => soundMapStore,
        set: (v: Record<string, { onTrigger: unknown; data: unknown }>) => {
          soundMapStore = v;
          for (const s of subscribers) s();
        },
      },
      loadBuffer: loadBufferMock,
      getAudioContext: () => ({
        // Pretend to be an AudioContext for the type system; tests don't
        // actually decode anything.
        decodeAudioData: vi.fn(),
      } as unknown as AudioContext),
    }));
  });

  const loadSampleLoader = async () => {
    const mod = await import('./SampleLoader');
    return {
      loadPianoSamples: mod.loadPianoSamples,
      loadDrumSamples: mod.loadDrumSamples,
      loadSynthSamples: mod.loadSynthSamples,
      loadAllSamples: mod.loadAllSamples,
      areAllSamplesLoaded: mod.areAllSamplesLoaded,
      getSampleLoadProgress: mod.getSampleLoadProgress,
      isSampleCached: mod.isSampleCached,
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

  it('registers bare-name aliases (bd, sd, hh) alongside bank_sound keys', async () => {
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    // soundMap has both forms
    expect(soundMapStore['drums_bd']).toBeDefined();
    expect(soundMapStore['bd']).toBeDefined();
    // alias points to the same data as the prefixed key
    expect(soundMapStore['bd']).toBe(soundMapStore['drums_bd']);
    expect(soundMapStore['sd']).toBe(soundMapStore['drums_sd']);
    expect(soundMapStore['hh']).toBe(soundMapStore['drums_hh']);
    expect(soundMapStore['oh']).toBe(soundMapStore['drums_oh']);
    expect(soundMapStore['rim']).toBe(soundMapStore['drums_rim']);
    expect(soundMapStore['sh']).toBe(soundMapStore['drums_sh']);
    expect(soundMapStore['cp']).toBe(soundMapStore['drums_cp']);
    expect(soundMapStore['cb']).toBe(soundMapStore['drums_cb']);
    expect(soundMapStore['crash']).toBe(soundMapStore['drums_crash']);
    expect(soundMapStore['ride']).toBe(soundMapStore['drums_ride']);
  });

  it('synth bank produces bare aliases with hyphen preserved (bass-c2, pad-c3, lead-e4)', async () => {
    const { loadSynthSamples } = await loadSampleLoader();
    await loadSynthSamples();
    // synth_bass-c1 → alias bass-c1 (hyphen preserved)
    expect(soundMapStore['synth_bass-c1']).toBeDefined();
    expect(soundMapStore['bass-c1']).toBe(soundMapStore['synth_bass-c1']);
    expect(soundMapStore['synth_pad-c3']).toBeDefined();
    expect(soundMapStore['pad-c3']).toBe(soundMapStore['synth_pad-c3']);
    expect(soundMapStore['synth_lead-e4']).toBeDefined();
    expect(soundMapStore['lead-e4']).toBe(soundMapStore['synth_lead-e4']);
    expect(soundMapStore['synth_strings-c4']).toBeDefined();
    expect(soundMapStore['strings-c4']).toBe(soundMapStore['synth_strings-c4']);
    expect(soundMapStore['synth_brass-c3']).toBeDefined();
    expect(soundMapStore['brass-c3']).toBe(soundMapStore['synth_brass-c3']);
  });

  it('piano bank produces bare aliases (a4, c4, c5)', async () => {
    const { loadPianoSamples } = await loadSampleLoader();
    await loadPianoSamples();
    expect(soundMapStore['piano_a4']).toBeDefined();
    expect(soundMapStore['a4']).toBe(soundMapStore['piano_a4']);
    expect(soundMapStore['c4']).toBe(soundMapStore['piano_c4']);
    expect(soundMapStore['c5']).toBe(soundMapStore['piano_c5']);
  });

  it('does not overwrite pre-existing bare names (e.g. triangle from synth registration)', async () => {
    // Synth registration happens via superdough.registerSynthSounds() and
    // populates soundMap with triangle/sawtooth/sine/etc. — verify that
    // a subsequent bank load does not clobber them.
    soundMapStore['triangle'] = { onTrigger: 'synth', data: { type: 'synth' } };
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    expect(soundMapStore['triangle']).toEqual({ onTrigger: 'synth', data: { type: 'synth' } });
  });

  it('eagerly preloads all sample URLs after samples() registers the bank', async () => {
    // Regression test for the audio-context-race silence: without preload,
    // the very first hap of a preset drops with "[sampler] loading sound
    // 'bd:0' took too long" because fetch+decode (80–160 ms) outpaces
    // the audio scheduler. We populate superdough's internal `tt[url]`
    // cache via loadBuffer() so the first haps hit warm cache.
    //
    // New behavior: `preloadAllBuffers` returns Promise<void> and is
    // awaited in `registerBank`. So once `loadDrumSamples()` resolves,
    // every URL has been dispatched to `loadBuffer`. The 10ms wait
    // from the previous version (fire-and-forget) is no longer needed.
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    // Expect loadBuffer to have been called for every drums sample URL
    // (14 samples in the drums bank — see strudel.json).
    const drumFilenames = [
      'bd.mp3', 'bd-sub.mp3', 'sd.mp3', 'rim.mp3', 'hh.mp3', 'oh.mp3',
      'cp.mp3', 'cb.mp3', 'sh.mp3', 'tom-l.mp3', 'tom-m.mp3', 'tom-h.mp3',
      'crash.mp3', 'ride.mp3',
    ];
    const calledUrls = loadBufferMock.mock.calls.map((c) => c[0]);
    for (const fname of drumFilenames) {
      // Mocked samples() returns bare filenames (no _base prefix);
      // superdough's real loadBuffer would receive full URLs via getBaseURL.
      expect(calledUrls).toContain(fname);
    }
  });

  it('preloadAllBuffers limits concurrency to 4 in flight (loadBuffer called max 4 at a time)', async () => {
    // Make each loadBuffer call take 5ms so we can observe overlap.
    // Track the peak in-flight count via a closure.
    let inFlight = 0;
    let peakInFlight = 0;
    loadBufferMock.mockImplementation(
      () => new Promise<AudioBuffer>((r) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          r({} as AudioBuffer);
        }, 5);
      }),
    );
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    // Sanity: more than 1 in flight (otherwise the test is meaningless —
    // every URL completed before the next started, no concurrency).
    expect(peakInFlight).toBeGreaterThan(1);
    // Hard cap: 24 drum URLs at limit 4 → peak should be exactly 4.
    // (14 originals + 10 bare aliases: bd, sd, rim, hh, oh, cp, cb, sh,
    // crash, ride. The aliases bd_sub, tom_l, tom_m, tom_h are skipped
    // because their alias contains an underscore.)
    expect(peakInFlight).toBeLessThanOrEqual(4);
    // All 24 URLs were dispatched eventually.
    expect(loadBufferMock).toHaveBeenCalledTimes(24);
  });

  it('onProgress fires for each buffer loaded (loaded/total counts up monotonically)', async () => {
    const events: Array<{ loaded: number; total: number }> = [];
    // Make each loadBuffer call take a tiny bit of time so onProgress
    // events are spread out enough to observe each one.
    loadBufferMock.mockImplementation(
      () => new Promise<AudioBuffer>((r) => setTimeout(() => r({} as AudioBuffer), 1)),
    );
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples({ onProgress: (loaded, total) => { events.push({ loaded, total }); } });
    // First event is the (0, total) prelude.
    expect(events[0]?.loaded).toBe(0);
    // 14 original drum URLs + 10 bare aliases (bd, sd, rim, hh, oh, cp,
    // cb, sh, crash, ride) = 24 total.
    expect(events[0]?.total).toBe(24);
    // Last event is (total, total).
    const last = events[events.length - 1];
    expect(last?.loaded).toBe(24);
    expect(last?.total).toBe(24);
    // Loaded is monotonically non-decreasing.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.loaded).toBeGreaterThanOrEqual(events[i - 1]!.loaded);
    }
    // No duplicates in (loaded, total) for the "complete" set — every
    // call must have produced a unique loaded count.
    const loadeds = events.map((e) => e.loaded);
    expect(new Set(loadeds).size).toBe(loadeds.length);
  });

  it('getSampleLoadProgress reflects actual state after a load', async () => {
    const { loadDrumSamples, getSampleLoadProgress, areAllSamplesLoaded } = await loadSampleLoader();
    // Initially: nothing loaded.
    const before = getSampleLoadProgress();
    expect(before.loaded).toBe(0);
    expect(before.total).toBe(0);
    expect(before.perBank.drums).toEqual({ loaded: 0, total: 0 });
    expect(areAllSamplesLoaded()).toBe(false);
    await loadDrumSamples();
    const after = getSampleLoadProgress();
    // 14 drum originals + 10 bare aliases = 24 URLs.
    expect(after.perBank.drums).toEqual({ loaded: 24, total: 24 });
    expect(after.perBank.piano).toEqual({ loaded: 0, total: 0 });
    expect(after.perBank.synth).toEqual({ loaded: 0, total: 0 });
    expect(after.loaded).toBe(24);
    expect(after.total).toBe(24);
    // Drums alone is not "all loaded" — piano + synth are still idle.
    expect(areAllSamplesLoaded()).toBe(false);
  });

  it('backward-compat: loadPianoSamples with no args still returns a Promise<void>', async () => {
    // The new signature is `loadPianoSamples(opts?: LoadOptions)`. Old
    // call sites (App.tsx, useAppBootstrap.ts, PianoSampleLoader shim)
    // pass no arguments and ignore the return value — they still work.
    const { loadPianoSamples } = await loadSampleLoader();
    const p = loadPianoSamples();
    expect(p).toBeInstanceOf(Promise);
    await p;
  });

  /**
   * SW-cache pre-check + `isSampleCached` contract.
   *
   * `isSampleCached(url)` is a deduped wrapper around
   * `swCache.isInServiceWorkerCache(url)`. The contract under test:
   *   - returns true when SW cache has the URL
   *   - returns false when SW cache is empty
   *   - dedupes concurrent calls for the same URL (one roundtrip)
   *   - preloadAllBuffers skips loadBuffer() for cached URLs but still
   *     counts them in loaded/total
   *
   * We mock the global `caches` API via `Object.defineProperty`. Each
   * test rebuilds the mock to keep cases isolated. `loadSampleLoader()`
   * is reused from the suite above (same Strudel mock) so the drums
   * bank produces 24 distinct URLs we can sprinkle across cache hits.
   */
  type CachesApi = {
    keys: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };

  const installCaches = (api: CachesApi | undefined): void => {
    Object.defineProperty(globalThis, 'caches', {
      value: api,
      configurable: true,
      writable: true,
    });
  };

  const fakeResp = (): Response => new Response(new ArrayBuffer(0));

  it('isSampleCached returns true when SW cache has the URL', async () => {
    installCaches({
      keys: vi.fn().mockResolvedValue(['precache-v1']),
      open: vi.fn(async () => ({ match: vi.fn().mockResolvedValue(fakeResp()) })),
    });
    const { isSampleCached } = await loadSampleLoader();
    expect(await isSampleCached('bd.mp3')).toBe(true);
  });

  it('isSampleCached returns false when SW cache is empty', async () => {
    installCaches({
      keys: vi.fn().mockResolvedValue(['precache-v1']),
      open: vi.fn(async () => ({ match: vi.fn().mockResolvedValue(undefined) })),
    });
    const { isSampleCached } = await loadSampleLoader();
    expect(await isSampleCached('bd.mp3')).toBe(false);
  });

  it('isSampleCached returns false when Cache API is undefined', async () => {
    installCaches(undefined);
    const { isSampleCached } = await loadSampleLoader();
    expect(await isSampleCached('bd.mp3')).toBe(false);
  });

  it('isSampleCached dedupes concurrent calls for the same URL (one roundtrip)', async () => {
    let matchCalls = 0;
    installCaches({
      keys: vi.fn().mockResolvedValue(['precache-v1']),
      open: vi.fn(async () => ({
        match: vi.fn().mockImplementation(async () => {
          matchCalls += 1;
          // Force a microtask gap so concurrent callers all attach
          // to the same in-flight promise.
          await new Promise<void>((r) => setTimeout(r, 5));
          return fakeResp();
        }),
      })),
    });
    const { isSampleCached } = await loadSampleLoader();
    const url = 'bd.mp3';
    const [a, b, c, d] = await Promise.all([
      isSampleCached(url),
      isSampleCached(url),
      isSampleCached(url),
      isSampleCached(url),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
    expect(d).toBe(true);
    // 4 callers but only one underlying match() call — the dedupe map
    // collapses the in-flight promises into a single Promise<boolean>.
    expect(matchCalls).toBe(1);
  });

  it('preloadAllBuffers skips loadBuffer for SW-cached URLs but still counts them', async () => {
    // Mock caches to mark ONE URL as cached and the rest as not cached.
    // Expected call counts: every cached URL → 0 loadBuffer calls;
    // every non-cached URL → 1 loadBuffer call. The TOTAL count of
    // loadBuffer calls = total URLs - cached URL occurrences.
    //
    // Note: bd.mp3 appears TWICE in the URL list — once for drums_bd
    // (original) and once for `bd` (bare-name alias). Same file, two
    // soundMap entries. Caching the URL skips BOTH calls. So with
    // bd.mp3 cached, loadBuffer is called 24 - 2 = 22 times.
    const cachedUrl = 'bd.mp3';
    installCaches({
      keys: vi.fn().mockResolvedValue(['precache-v1']),
      open: vi.fn(async () => ({
        match: vi.fn().mockImplementation(async (url: string) => {
          if (url === cachedUrl) return fakeResp();
          return undefined;
        }),
      })),
    });
    const { loadDrumSamples, getSampleLoadProgress } = await loadSampleLoader();
    await loadDrumSamples();
    // bd.mp3 cached → 2 occurrences skipped; the other 22 URLs hit loadBuffer.
    const calledUrls = loadBufferMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls).not.toContain(cachedUrl);
    expect(loadBufferMock).toHaveBeenCalledTimes(22);
    // getSampleLoadProgress still reflects 24/24 (cached URLs are
    // counted toward loaded/total — see SWCacheShortCircuit in
    // preloadAllBuffers).
    const progress = getSampleLoadProgress();
    expect(progress.perBank.drums.total).toBe(24);
    expect(progress.perBank.drums.loaded).toBe(24);
  });
});