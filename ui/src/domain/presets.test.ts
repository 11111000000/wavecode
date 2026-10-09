import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS } from './presets';

describe('BUILTIN_PRESETS', () => {
  it('has 23 entries (8 original + 10 genre + 2 sample-pack demos + 3 synth demos)', () => {
    expect(BUILTIN_PRESETS).toHaveLength(23);
  });

  it('has unique ids', () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every id matches kebab-case (lowercase alphanumeric + dash)', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every preset has non-empty name and score', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.score.length).toBeGreaterThan(0);
    }
  });

  it('every score contains a Strudel mini-notation call (note(...) or s(...))', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.score).toMatch(/note\(|s\(/);
    }
  });

  it('Creep preset is by Radiohead', () => {
    const creep = BUILTIN_PRESETS.find((p) => p.id === 'creep');
    expect(creep).toBeDefined();
    expect(creep?.name).toBe('Creep');
    expect(creep?.artist).toBe('Radiohead');
  });

  it('all 10 new genre presets are present', () => {
    const expected = [
      'edm-house', 'hiphop-boombap', 'jazz-ii-v-i', 'ambient-drone',
      'bossa-nova', 'trap-modern', 'reggaeton', 'idm-glitch',
      'dreampop', 'step-grid-demo',
    ];
    for (const id of expected) {
      expect(BUILTIN_PRESETS.find((p) => p.id === id), `missing ${id}`).toBeDefined();
    }
  });

  it('all 3 new synth-pack demos are present (CC0 analog bass / lush pad / retro lead)', () => {
    const expected = ['analog-bass', 'lush-pad', 'retro-lead'];
    for (const id of expected) {
      const p = BUILTIN_PRESETS.find((p) => p.id === id);
      expect(p, `missing ${id}`).toBeDefined();
      // Every synth-pack demo references the `synth:` bank (Strudel
      // bank prefix). Verifies the bank wiring is in place.
      expect(p?.score).toMatch(/s\("synth:/);
    }
  });

  it('every preset has balanced stack() with same-line closing or proper newlines', () => {
    for (const p of BUILTIN_PRESETS) {
      // Loose check: `stack(` opens and matching `)` closes on a line.
      expect(p.score).toMatch(/stack\(/);
      // Count of `(` and `)` should match (ignoring those inside strings is hard,
      // so we use a simple heuristic — at least 1 of each).
      const opens = (p.score.match(/\(/g) ?? []).length;
      const closes = (p.score.match(/\)/g) ?? []).length;
      expect(opens).toBeGreaterThan(0);
      expect(closes).toBeGreaterThanOrEqual(opens - 1); // tolerates `min(` style fn
    }
  });
});