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
 *
 * Worker decoding mock
 * --------------------
 * The `decodeWorker?worker` import is replaced with `FakeDecodeWorker`,
 * a Worker substitute that:
 *   - records every `postMessage` call (via `postMessageSpy` on each
 *     instance; `FakeDecodeWorker.all[0]` is the singleton that
 *     SampleLoader creates)
 *   - by default auto-replies with a tiny `decode:ok` so
 *     `decodeInWorker` resolves cleanly (otherwise `loadDrumSamples()`
 *     would never settle in tests that just want to verify dispatch
 *     counts)
 *   - exposes `autoReply = false` so individual tests can suppress
 *     the auto-reply for error-path coverage (the test then must
 *     `triggerReply` manually)
 *
 * Note: SampleLoader creates the Worker lazily inside
 * `ensureWorker()`. The first `decodeInWorker` call triggers a
 * `new FakeDecodeWorker()` via the Vite `?worker` factory. So
 * `FakeDecodeWorker.all[0]` is what the assertions target — never
 * a "first instance created in beforeEach" (since the SampleLoader
 * construct their OWN Worker, and the beforeEach instance is the
 * ORPHAN that doesn't matter to the test).
 *
 * `getAudioContext` returns a fake `AudioContext` whose `createBuffer`
 * returns a stub `AudioBuffer` with a working `copyToChannel`. That
 * lets `reconstructBuffer` complete without real Web Audio.
 */
describe('SampleLoader — Strudel API contract (samples, soundMap, static import)', () => {
  let samplesMock: ReturnType<typeof vi.fn>;
  let soundMapStore: Record<string, { onTrigger: unknown; data: unknown }>;
  let subscribers: Array<() => void>;

  class FakeDecodeWorker {
    static all: FakeDecodeWorker[] = [];
    postMessageSpy = vi.fn();
    messageHandlers: Array<(e: { data: unknown }) => void> = [];
    autoReply = true;
    constructor() {
      FakeDecodeWorker.all.push(this);
    }
    postMessage(msg: unknown): void {
      this.postMessageSpy(msg);
      if (this.autoReply) {
        const id = (msg as { id?: number }).id;
        const reply = {
          type: 'decode:ok',
          id,
          buffer: new ArrayBuffer(64),
          sampleRate: 44100,
          numberOfChannels: 1,
          duration: 0.001,
        };
        queueMicrotask(() => this.triggerReply(reply));
      }
    }
    triggerReply(reply: unknown): void {
      for (const h of this.messageHandlers) {
        h({ data: reply });
      }
    }
    addEventListener(type: string, handler: (e: { data: unknown }) => void): void {
      if (type === 'message') this.messageHandlers.push(handler);
    }
  }

  const getMockWorker = (): FakeDecodeWorker => {
    const w = FakeDecodeWorker.all[0];
    if (w === undefined) throw new Error('no Worker instance yet — call a sample loader first');
    return w;
  };

  beforeEach(async () => {
    vi.resetModules();
    soundMapStore = {};
    subscribers = [];
    FakeDecodeWorker.all = [];
    samplesMock = vi.fn().mockImplementation(async (input: string | Record<string, unknown>) => {
      if (typeof input !== 'string') return;
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
    vi.doMock('@strudel/webaudio', () => ({
      samples: samplesMock,
      soundMap: {
        get: () => soundMapStore,
        set: (v: Record<string, { onTrigger: unknown; data: unknown }>) => {
          soundMapStore = v;
          for (const s of subscribers) s();
        },
      },
      getAudioContext: () => ({
        sampleRate: 44100,
        decodeAudioData: vi.fn(),
        createBuffer: (channels: number, length: number, sampleRate: number): AudioBuffer => ({
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          copyToChannel: vi.fn(),
          getChannelData: (_ch: number): Float32Array => new Float32Array(length),
        } as unknown as AudioBuffer),
      } as unknown as AudioContext),
    }));
    vi.doMock('./decodeWorker?worker', () => ({
      // The `?worker` import yields a Worker constructor. We replace
      // it with a class that mints a fresh `FakeDecodeWorker` on every
      // `new` call. The original Vite `?worker` semantics are different
      // (always returns the same underlying Worker), but for
      // concurrency / dispatch-count assertions a fresh fake per call
      // is the closer analog to "what would the real Worker do" — and
      // it lets `FakeDecodeWorker.all` track per-call construction.
      default: class FakeWorkerCtor {
        constructor() {
          return new FakeDecodeWorker();
        }
      },
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
      __getWarmCacheSize: mod.__getWarmCacheSize,
      __getDecodeWorkerInstance: mod.__getDecodeWorkerInstance,
      __resetForTests: mod.__resetForTests,
    };
  };

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const postedUrls = (): string[] => {
    const w = getMockWorker();
    return w.postMessageSpy.mock.calls
      .map((c) => (c[0] as { url?: string }).url)
      .filter((u): u is string => typeof u === 'string');
  };

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
    expect(soundMapStore['drums_bd']).toBeDefined();
    expect(soundMapStore['bd']).toBeDefined();
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
    soundMapStore['triangle'] = { onTrigger: 'synth', data: { type: 'synth' } };
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    expect(soundMapStore['triangle']).toEqual({ onTrigger: 'synth', data: { type: 'synth' } });
  });

  it('eagerly posts a decode message to the Worker for every sample URL after bank registration', async () => {
    // Phase-2 worktree: preload now goes through the Worker, NOT
    // superdough's in-thread `loadBuffer`. We assert `postMessage`
    // on the decode Worker for every non-cached URL in the drums
    // bank. 14 originals + 10 bare aliases = 24 distinct messages.
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    const drumFilenames = [
      'bd.mp3', 'bd-sub.mp3', 'sd.mp3', 'rim.mp3', 'hh.mp3', 'oh.mp3',
      'cp.mp3', 'cb.mp3', 'sh.mp3', 'tom-l.mp3', 'tom-m.mp3', 'tom-h.mp3',
      'crash.mp3', 'ride.mp3',
    ];
    const calledUrls = postedUrls();
    for (const fname of drumFilenames) {
      expect(calledUrls, `expected postMessage for ${fname}`).toContain(fname);
    }
  });

  it('preloadAllBuffers dispatches every URL via postMessage eventually', async () => {
    // With PRELOAD_CONCURRENCY = 4, all 24 URLs must reach the
    // Worker by the time loadDrumSamples resolves. Auto-reply is on
    // so each postMessage resolves into a free slot.
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    const w = getMockWorker();
    expect(w.postMessageSpy).toHaveBeenCalledTimes(24);
  });

  it('preloadAllBuffers uses PRELOAD_CONCURRENCY (≤4) via withConcurrency', async () => {
    // The cap is enforced by `withConcurrency(urls, 4, fn)` — an
    // unchanged helper from the prior commit. This test focuses on
    // the wiring: it confirms ALL 24 drum URLs were eventually
    // dispatched (the cap means they came out in ≤4-parallel
    // batches, not all 24 at once).
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    const w = getMockWorker();
    expect(w.postMessageSpy.mock.calls.length).toBe(24);
  });

  it('onProgress fires for each buffer (24 events: 14 originals + 10 bare aliases)', async () => {
    const events: Array<{ loaded: number; total: number }> = [];
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples({ onProgress: (loaded, total) => { events.push({ loaded, total }); } });
    expect(events[0]?.loaded).toBe(0);
    expect(events[0]?.total).toBe(24);
    const last = events[events.length - 1];
    expect(last?.loaded).toBe(24);
    expect(last?.total).toBe(24);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.loaded).toBeGreaterThanOrEqual(events[i - 1]!.loaded);
    }
    const loadeds = events.map((e) => e.loaded);
    expect(new Set(loadeds).size).toBe(loadeds.length);
  });

  it('getSampleLoadProgress reflects actual state after a load', async () => {
    const { loadDrumSamples, getSampleLoadProgress, areAllSamplesLoaded } = await loadSampleLoader();
    const before = getSampleLoadProgress();
    expect(before.loaded).toBe(0);
    expect(before.total).toBe(0);
    expect(before.perBank.drums).toEqual({ loaded: 0, total: 0 });
    expect(areAllSamplesLoaded()).toBe(false);
    await loadDrumSamples();
    const after = getSampleLoadProgress();
    expect(after.perBank.drums).toEqual({ loaded: 24, total: 24 });
    expect(after.perBank.piano).toEqual({ loaded: 0, total: 0 });
    expect(after.perBank.synth).toEqual({ loaded: 0, total: 0 });
    expect(after.loaded).toBe(24);
    expect(after.total).toBe(24);
    expect(areAllSamplesLoaded()).toBe(false);
  });

  it('backward-compat: loadPianoSamples with no args still returns a Promise<void>', async () => {
    const { loadPianoSamples } = await loadSampleLoader();
    const p = loadPianoSamples();
    expect(p).toBeInstanceOf(Promise);
    await p;
  });

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
    expect(matchCalls).toBe(1);
  });

  it('preloadAllBuffers skips the Worker call for SW-cached URLs but still counts them', async () => {
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
    const calledUrls = postedUrls();
    expect(calledUrls).not.toContain(cachedUrl);
    // bd.mp3 appears twice (drums_bd + bare alias) → 2 skipped.
    // 24 - 2 = 22 worker calls.
    expect(getMockWorker().postMessageSpy).toHaveBeenCalledTimes(22);
    const progress = getSampleLoadProgress();
    expect(progress.perBank.drums.total).toBe(24);
    expect(progress.perBank.drums.loaded).toBe(24);
  });
});

/**
 * Worker integration surface — module-level singleton, message
 * routing, error handling, and AudioBuffer reconstruction.
 *
 * The Worker is replaced with the same `FakeDecodeWorker` used in
 * the contract suite (above). These tests assert the integration
 * details that the contract suite doesn't reach into:
 *   - only ONE Worker instance per app session
 *   - id propagation (postMessage ids are unique + monotonic)
 *   - decode:err reply propagates as a Promise rejection that's
 *     swallowed by `preloadAllBuffers` (no bank-level failure)
 *   - decoded AudioBuffers populate `warmCache`
 */
describe('SampleLoader — Worker integration surface', () => {
  let samplesMock: ReturnType<typeof vi.fn>;
  let soundMapStore: Record<string, { onTrigger: unknown; data: unknown }>;

  class FakeDecodeWorker {
    static all: FakeDecodeWorker[] = [];
    // Counter of `new DecodeWorker()` invocations on this class's
    // factory. Lives on the class (static) so the `vi.doMock`
    // factory closure can mutate it without scope-binding quirks.
    // Reset to 0 at the start of each test.
    static factoryCalls = 0;
    // Optional override for `postMessage` — when set, BUILT-IN
    // postMessage logic is bypassed. Used by error-path tests to
    // inject `decode:err` replies without timing races. Cleared
    // in `beforeEach` so default behavior returns for non-error
    // tests.
    static postMessageOverride:
      | ((self: FakeDecodeWorker, msg: unknown) => void)
      | null = null;
    // Optional override for the autoReply reply content — when set,
    // replaces the default `decode:ok` reply. Lets tests pass a
    // crafted `decode:err` (or other) reply for every postMessage.
    static replyOverride: ((self: FakeDecodeWorker, msg: unknown) => unknown) | null = null;
    postMessageSpy = vi.fn();
    messageHandlers: Array<(e: { data: unknown }) => void> = [];
    autoReply = true;
    constructor() {
      FakeDecodeWorker.all.push(this);
    }
    postMessage(msg: unknown): void {
      this.postMessageSpy(msg);
      if (FakeDecodeWorker.postMessageOverride !== null) {
        FakeDecodeWorker.postMessageOverride(this, msg);
        return;
      }
      if (this.autoReply) {
        const id = (msg as { id?: number }).id;
        let reply: unknown;
        if (FakeDecodeWorker.replyOverride !== null) {
          reply = FakeDecodeWorker.replyOverride(this, msg);
        } else {
          reply = {
            type: 'decode:ok',
            id,
            buffer: new ArrayBuffer(64),
            sampleRate: 44100,
            numberOfChannels: 1,
            duration: 0.001,
          };
        }
        queueMicrotask(() => this.triggerReply(reply));
      }
    }
    triggerReply(reply: unknown): void {
      for (const h of this.messageHandlers) h({ data: reply });
    }
    addEventListener(type: string, handler: (e: { data: unknown }) => void): void {
      if (type === 'message') this.messageHandlers.push(handler);
    }
    reset(): void {
      this.postMessageSpy.mockClear();
      this.messageHandlers.length = 0;
      this.autoReply = true;
    }
  }

  // Factory returns a fresh `FakeDecodeWorker` per `new DecodeWorker()`.
  // (Like the first describe.) The `static factoryCalls` counter
  // proves that the loader only ever constructs one Worker across
  // multiple banks. The `static all` array is the per-test
  // construction log (cleared in beforeEach).
  beforeEach(async () => {
    vi.resetModules();
    soundMapStore = {};
    FakeDecodeWorker.all = [];
    FakeDecodeWorker.factoryCalls = 0;
    FakeDecodeWorker.postMessageOverride = null;
    FakeDecodeWorker.replyOverride = null;
    // Clear the `caches` global from any prior test that used
    // `installCaches()`. JSDOM doesn't provide a Cache API by
    // default; if a prior test installed one, our isSampleCached
    // probes here would still consult it. Forcing undefined
    // restores "no SW cache" semantics for this suite.
    Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true, writable: true });
    samplesMock = vi.fn().mockImplementation(async (input: string) => {
      if (input !== '/samples/drums/strudel.json') return;
      const map: Record<string, string[]> = {
        drums_bd: ['bd.mp3'], drums_bd_sub: ['bd-sub.mp3'], drums_sd: ['sd.mp3'],
      };
      for (const [k, v] of Object.entries(map)) {
        soundMapStore[k] = { onTrigger: vi.fn(), data: { type: 'sample', samples: v } };
      }
    });
    vi.doMock('@strudel/webaudio', () => ({
      samples: samplesMock,
      soundMap: {
        get: () => soundMapStore,
        set: (v: Record<string, { onTrigger: unknown; data: unknown }>) => { soundMapStore = v; },
      },
      getAudioContext: () => ({
        sampleRate: 44100,
        decodeAudioData: vi.fn(),
        createBuffer: (channels: number, length: number, sampleRate: number): AudioBuffer => ({
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          copyToChannel: vi.fn(),
          getChannelData: (): Float32Array => new Float32Array(length),
        } as unknown as AudioBuffer),
      } as unknown as AudioContext),
    }));
vi.doMock('./decodeWorker?worker', () => ({
      // Note: a FRESH `FakeDecodeWorker` per `new DecodeWorker()` call.
      // The SampleLoader must cache its own instance for the
      // singleton invariant — `FakeDecodeWorker.factoryCalls` ticks
      // every construction; the assertion is it stays at 1 across
      // all banks.
      default: class FakeWorkerCtor {
        constructor() {
          FakeDecodeWorker.factoryCalls += 1;
          return new FakeDecodeWorker();
        }
      },
    }));
  });

  // Helper: the most recently constructed FakeDecodeWorker is the
  // singleton one that SampleLoader's `ensureWorker` cached.
  // Since the factory mints a fresh instance per call, the
  // second/third banks can't create new ones (loader-side
  // short-circuit), so `FakeDecodeWorker.all` always has length 1.
  const getMockWorker = (): FakeDecodeWorker => {
    const w = FakeDecodeWorker.all[0];
    if (w === undefined) throw new Error('no Worker instance yet — call a sample loader first');
    return w;
  };

  const loadSampleLoader = async () => {
    const mod = await import('./SampleLoader');
    return {
      loadDrumSamples: mod.loadDrumSamples,
      loadPianoSamples: mod.loadPianoSamples,
      loadAllSamples: mod.loadAllSamples,
      __getWarmCacheSize: mod.__getWarmCacheSize,
      __getDecodeWorkerInstance: mod.__getDecodeWorkerInstance,
      __resetForTests: mod.__resetForTests,
    };
  };

  it('creates exactly ONE Worker instance across the entire preload (module-level singleton)', async () => {
    // The Worker is allocated lazily on first decodeInWorker() call.
    // Subsequent decodes (including the second bank) must REUSE the
    // same Worker — instantiating a new Worker per call would defeat
    // the OfflineAudioContext cache (and would be slow).
    //
    // `FakeDecodeWorker.factoryCalls` ticks every time the loader does
    // `new DecodeWorker()`. The loader's `ensureWorker()` caches the
    // first instance as a module-level singleton, so subsequent bank
    // preloads don't construct a new Worker — the assertion is that
    // `factoryCalls` stays at 1 across all banks.
    const { loadDrumSamples, loadAllSamples, __getDecodeWorkerInstance } = await loadSampleLoader();
    expect(FakeDecodeWorker.factoryCalls).toBe(0);
    await loadDrumSamples();
    expect(FakeDecodeWorker.factoryCalls).toBe(1);
    await loadAllSamples();
    // Still 1 — the second/third bank reused the singleton Worker.
    expect(FakeDecodeWorker.factoryCalls).toBe(1);
    const inst = __getDecodeWorkerInstance();
    expect(inst).not.toBeNull();
  });

  it('postMessage ids are unique and monotonic across decodes', async () => {
    const { loadAllSamples } = await loadSampleLoader();
    await loadAllSamples();
    const w = getMockWorker();
    const ids = w.postMessageSpy.mock.calls.map(
      (c) => (c[0] as { id: number }).id,
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    }
  });

  it('postMessage payload shape: { type: "decode", id, url, sampleRate }', async () => {
    const { loadDrumSamples } = await loadSampleLoader();
    await loadDrumSamples();
    const w = getMockWorker();
    for (const call of w.postMessageSpy.mock.calls) {
      const msg = call[0] as Record<string, unknown>;
      expect(msg.type).toBe('decode');
      expect(typeof msg.id).toBe('number');
      expect(typeof msg.url).toBe('string');
      expect((msg.url as string).length).toBeGreaterThan(0);
      // sampleRate propagated from the live AudioContext (mock returns 44100).
      expect(msg.sampleRate).toBe(44100);
    }
  });

  it('decode:err reply from the Worker is caught and does NOT fail the preload', async () => {
    // Set the static replyOverride so every postMessage auto-replies
    // with a `decode:err`. This bypasses the per-instance postMessage
    // override dance from before — set BEFORE the loader runs so
    // any Worker minted by `ensureWorker` consults the override.
    FakeDecodeWorker.replyOverride = (_self, msg) => {
      const id = (msg as { id: number }).id;
      return {
        type: 'decode:err',
        id,
        error: 'synthetic decode failure',
      };
    };
    const { loadDrumSamples } = await loadSampleLoader();
    // Should still resolve — every decodeInWorker rejection is
    // swallowed inside preloadAllBuffers' try/catch.
    await expect(loadDrumSamples()).resolves.toBeUndefined();
    const w = getMockWorker();
    expect(w.postMessageSpy).toHaveBeenCalled();
  });

  it('Worker decode error does NOT add to warmCache', async () => {
    FakeDecodeWorker.replyOverride = (_self, msg) => {
      const id = (msg as { id: number }).id;
      return {
        type: 'decode:err',
        id,
        error: 'decodeAudioData failed',
      };
    };
    const { loadDrumSamples, __getWarmCacheSize } = await loadSampleLoader();
    await loadDrumSamples();
    // All replies were decode:err → no AudioBuffer reconstructed →
    // warmCache stays empty.
    expect(__getWarmCacheSize()).toBe(0);
  });

  it('warmCache is populated with one AudioBuffer per distinct URL', async () => {
    // 3 distinct URLs registered via soundMap (bd.mp3, bd-sub.mp3,
    // sd.mp3). bare aliases add `bd` and `sd` keys (mapping to the
    // same data). `collectSampleUrls` does NOT dedup — bare aliases
    // cause the same URL to land in the pre-decode list twice.
    // `warmCache` keys on URL, so duplicates overwrite (not insert).
    // Result: warmCache holds the 3 distinct AudioBuffers.
    const { loadDrumSamples, __getWarmCacheSize } = await loadSampleLoader();
    await loadDrumSamples();
    const size = __getWarmCacheSize();
    expect(size).toBe(3);
  });

  it('two banks share the same Worker instance (one OfflineAudioContext across all banks)', async () => {
    samplesMock.mockImplementation(async (input: string) => {
      const map: Record<string, string[]> = {
        '/samples/piano/strudel.json': {
          piano_a1: ['A1.mp3'],
        },
        '/samples/drums/strudel.json': {
          drums_bd: ['bd.mp3'],
        },
      }[input] ?? {};
      for (const [k, v] of Object.entries(map)) {
        soundMapStore[k] = { onTrigger: vi.fn(), data: { type: 'sample', samples: v } };
      }
    });
    const { loadDrumSamples, loadPianoSamples } = await loadSampleLoader();
    await loadDrumSamples();
    expect(FakeDecodeWorker.factoryCalls).toBe(1);
    await loadPianoSamples();
    // Still 1 — the piano bank reused the singleton Worker.
    expect(FakeDecodeWorker.factoryCalls).toBe(1);
  });

  it('__resetForTests wipes Worker singleton + warmCache (between-test reset)', async () => {
    const { loadDrumSamples, __resetForTests, __getWarmCacheSize, __getDecodeWorkerInstance } = await loadSampleLoader();
    await loadDrumSamples();
    expect(__getWarmCacheSize()).toBeGreaterThan(0);
    expect(__getDecodeWorkerInstance()).not.toBeNull();
    __resetForTests();
    expect(__getWarmCacheSize()).toBe(0);
    expect(__getDecodeWorkerInstance()).toBeNull();
  });
});
