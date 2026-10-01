import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS } from './presets';

describe('BUILTIN_PRESETS', () => {
  it('has 8 entries', () => {
    expect(BUILTIN_PRESETS).toHaveLength(8);
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
});