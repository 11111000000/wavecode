import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registerSynthSounds, soundMap } from 'superdough';
import {
  OSCILLATOR_SOUNDS,
  SAMPLE_SOUNDS,
  DRUM_SOUNDS,
  MELODIC_SOUNDS,
  ALL_SOUNDS,
  soundLabel,
  soundGlyph,
  isMelodicSound,
} from './sounds';

/**
 * The catalogue must describe the sounds that ACTUALLY exist.
 *
 * Two sources of truth are checked here:
 *
 *   1. superdough's `registerSynthSounds()` — the oscillator sounds
 *      are registered by the library at boot, so the catalogue may
 *      only promise names the library really registers.
 *   2. the `strudel.json` manifests under `public/samples/` + the MP3
 *      files next to them — the sample sounds are registered from
 *      these manifests, and a manifest that names a file nobody
 *      shipped is a lie (the lookup succeeds, the fetch 404s, the
 *      layer is silent).
 *
 * The second check is the one that catches drift: add a sound to the
 * catalogue without shipping it and this test fails, instead of the
 * user hearing silence.
 */

const SAMPLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/samples',
);

type Manifest = Record<string, unknown>;

const readManifest = (bank: string): Manifest =>
  JSON.parse(readFileSync(join(SAMPLES_DIR, bank, 'strudel.json'), 'utf8')) as Manifest;

/** The base URL a manifest resolves its files against. */
const manifestBase = (manifest: Manifest): string =>
  typeof manifest['_base'] === 'string' ? (manifest['_base'] as string) : '/';

type ManifestSound = {
  readonly id: string;
  readonly files: ReadonlyArray<string>;
  /** The notes of a note-keyed bank; empty for a one-shot. */
  readonly notes: ReadonlyArray<string>;
};

const manifestSounds = (manifest: Manifest): ReadonlyArray<ManifestSound> => {
  const out: Array<ManifestSound> = [];
  for (const [key, value] of Object.entries(manifest)) {
    if (key === '_base') continue;
    if (Array.isArray(value)) {
      out.push({ id: key, files: value.filter((v): v is string => typeof v === 'string'), notes: [] });
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>);
      out.push({
        id: key,
        files: entries.flatMap(([, files]) =>
          Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [],
        ),
        notes: entries.map(([note]) => note),
      });
      continue;
    }
    throw new Error(`unexpected manifest entry ${key} in the sample bank`);
  }
  return out;
};

describe('sounds — the oscillator sounds are really registered', () => {
  it('every oscillator in the catalogue is in superdough\'s soundMap', () => {
    registerSynthSounds();
    const registered = new Set(Object.keys(soundMap.get()));
    for (const s of OSCILLATOR_SOUNDS) {
      expect(registered.has(s.id)).toBe(true);
    }
  });

  it('the catalogue does not promise a "piano" oscillator (it is a sample)', () => {
    // The trap that made the whistle silent: `piano` looks like a
    // synth sound, but only the SAMPLE bank can provide it.
    registerSynthSounds();
    const registered = new Set(Object.keys(soundMap.get()));
    expect(registered.has('piano')).toBe(false);
    expect(SAMPLE_SOUNDS.some((s) => s.id === 'piano')).toBe(true);
  });
});

describe('sounds — the catalogue matches the shipped sample banks', () => {
  const banks = ['piano', 'drums', 'synth'] as const;

  it('every sample sound in the catalogue exists in a manifest', () => {
    const shipped = banks.flatMap((b) => manifestSounds(readManifest(b)));
    const shippedIds = new Set(shipped.map((s) => s.id));
    for (const s of [...SAMPLE_SOUNDS, ...DRUM_SOUNDS]) {
      expect(shippedIds.has(s.id)).toBe(true);
    }
  });

  it('every manifest sound is in the catalogue (no unlisted sound)', () => {
    const shipped = banks.flatMap((b) => manifestSounds(readManifest(b)));
    const catalogueIds = new Set([...SAMPLE_SOUNDS, ...DRUM_SOUNDS].map((s) => s.id));
    for (const s of shipped) {
      expect(catalogueIds.has(s.id)).toBe(true);
    }
  });

  it('the notes of every sample sound match the manifest keys', () => {
    const shipped = new Map(
      banks.flatMap((b) => manifestSounds(readManifest(b))).map((s) => [s.id, s]),
    );
    for (const s of [...SAMPLE_SOUNDS, ...DRUM_SOUNDS]) {
      const entry = shipped.get(s.id);
      expect(entry).toBeDefined();
      expect([...(s.notes ?? [])].sort()).toEqual([...entry!.notes].sort());
    }
  });

  it('every file the manifests name is actually shipped', () => {
    for (const bank of banks) {
      const manifest = readManifest(bank);
      const base = manifestBase(manifest);
      for (const sound of manifestSounds(manifest)) {
        for (const file of sound.files) {
          const url = `${base}${file}`;
          const onDisk = resolve(SAMPLES_DIR, bank, file);
          expect(existsSync(onDisk)).toBe(true);
          // The URL the browser will fetch must be the one that is on
          // disk: base + file, relative to /samples/<bank>/.
          expect(url).toBe(`/samples/${bank}/${file}`);
        }
      }
    }
  });
});

describe('sounds — the helpers', () => {
  it('soundLabel falls back to the id for an unknown sound', () => {
    expect(soundLabel('piano')).toBe('Пианино');
    expect(soundLabel('nope')).toBe('nope');
  });

  it('soundGlyph falls back for an unknown sound', () => {
    expect(soundGlyph('drums_bd')).toBe('🥁');
    expect(soundGlyph('nope')).toBe('♪');
  });

  it('isMelodicSound is true for the note-carrying sounds only', () => {
    expect(isMelodicSound('piano')).toBe(true);
    expect(isMelodicSound('sawtooth')).toBe(true);
    expect(isMelodicSound('drums_hh')).toBe(false);
  });

  it('the ids are unique across the whole catalogue', () => {
    const ids = ALL_SOUNDS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the melodic catalogue is the oscillators plus the sample sounds', () => {
    expect(MELODIC_SOUNDS.length).toBe(OSCILLATOR_SOUNDS.length + SAMPLE_SOUNDS.length);
  });
});
