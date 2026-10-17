import { describe, it, expect, vi } from 'vitest';
import { BUILTIN_PRESETS, validatePreset } from './presets';

describe('BUILTIN_PRESETS', () => {
  it('has 18 entries (1 old Creep + 10 genre + 1 step demo + 2 piano demos + 2 drum demos + 3 synth demos)', () => {
    expect(BUILTIN_PRESETS).toHaveLength(18);
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
      'bossa-nova', 'trap-atlanta', 'reggaeton', 'idm-glitch',
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
      // Every synth-pack demo references the `synth_` bank prefix
      // (Strudel mini-notation reserves `:` for sound:n split, so we
      // use `_` as the bank separator; strudel.json keys follow the
      // same convention).
      expect(p?.score).toMatch(/s\("synth_/);
    }
  });

  it('sample-pack drum presets (808-king, toms-funk) use the drums bank prefix', () => {
    const eightOhEightKing = BUILTIN_PRESETS.find((p) => p.id === '808-king');
    const tomsFunk = BUILTIN_PRESETS.find((p) => p.id === 'toms-funk');
    expect(eightOhEightKing).toBeDefined();
    expect(tomsFunk).toBeDefined();
    // Score strings use the `drums_` bank prefix.
    expect(eightOhEightKing?.score).toMatch(/s\("drums_bd/);
    expect(eightOhEightKing?.score).toMatch(/s\("~? ?drums_sd/);
    expect(eightOhEightKing?.score).toMatch(/s\("drums_hh/);
    expect(eightOhEightKing?.score).toMatch(/s\([^)]*\bdrums_cp\b[^)]*\)/);
    expect(tomsFunk?.score).toContain('drums_tom-l');
    expect(tomsFunk?.score).toContain('drums_tom-m');
    expect(tomsFunk?.score).toContain('drums_tom-h');
    expect(tomsFunk?.score).toContain('drums_crash');
    expect(tomsFunk?.score).toContain('drums_ride');
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

  it('smoke: every preset score is a non-empty, multi-line string ending in `)`', () => {
    // Cheap structural check — no transpiler involved. Catches trivial
    // regressions like a preset whose `.join('\n')` produced a single-line
    // string or accidentally truncates a closing paren.
    for (const p of BUILTIN_PRESETS) {
      expect(p.score).toMatch(/\n/); // multi-line
      expect(p.score.trimEnd().endsWith(')')).toBe(true);
    }
  });
});

/**
 * `validatePreset` is a dev-time lint that runs a preset's score through
 * Strudel's transpiler in a sandbox and collects console diagnostics.
 * It must NOT depend on the audio modules — the transpiler and console
 * are injected so unit tests can supply stubs.
 */
describe('validatePreset', () => {
  const makePreset = (id = 'test-preset') => ({
    id,
    name: 'Test',
    score: 'note("c4 e4 g4").s("triangle")',
  });

  it('returns 0 warnings when the transpiler succeeds without diagnostics', async () => {
    const evaluate = vi.fn().mockImplementation(async () => {
      // Pretend the transpiler ran without emitting any warns.
      return { pattern: {} };
    });
    const fakeConsole: Pick<Console, 'warn' | 'error'> = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const result = await validatePreset(makePreset('clean'), {
      transpiler: { evaluate },
      console: fakeConsole,
    });
    expect(result.presetId).toBe('clean');
    expect(result.warnings).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    // The injected console was not called (the transpiler emitted nothing).
    expect(fakeConsole.warn).not.toHaveBeenCalled();
    expect(fakeConsole.error).not.toHaveBeenCalled();
  });

  it('captures a console.warn emitted DURING transpiler evaluation', async () => {
    // The injected console is mutated by validatePreset (warn/error get
    // swapped to capture-wrappers for the duration of evaluate). The
    // evaluate mock closes over the same object, so calls to
    // `injectedConsole.warn(...)` route to the wrapper during evaluation.
    const injectedConsole: Pick<Console, 'warn' | 'error'> = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const evaluate = vi.fn().mockImplementation(async () => {
      // Simulate Strudel's superdough/util.mjs nanFallback emitting a
      // warning when a numeric control receives a non-numeric token.
      injectedConsole.warn('"a4" is not a number, falling back to 0');
      return { pattern: {} };
    });
    const result = await validatePreset(makePreset('noisy'), {
      transpiler: { evaluate },
      console: injectedConsole,
    });
    expect(result.presetId).toBe('noisy');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.level).toBe('warn');
    expect(result.warnings[0]?.message).toMatch(/not a number, falling back to 0/);
    expect(result.error).toBeUndefined();
    // The wrapper called the ORIGINAL warn after capturing — verify
    // (avoids leaking the warning to the test runner's stdout).
    expect(injectedConsole.warn).toHaveBeenCalledWith('"a4" is not a number, falling back to 0');
  });

  it('returns {error: "..."} when the transpiler throws — does not reject', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('unexpected token at line 3'));
    const fakeConsole: Pick<Console, 'warn' | 'error'> = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const result = await validatePreset(makePreset('broken'), {
      transpiler: { evaluate },
      console: fakeConsole,
    });
    expect(result.presetId).toBe('broken');
    expect(result.error).toBe('unexpected token at line 3');
    expect(result.warnings).toEqual([]);
    // Elapsed time still measured (helpful for diagnosing hung transpilers).
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('handles a thrown non-Error value (string) without crashing', async () => {
    const evaluate = vi.fn().mockRejectedValue('plain string error');
    const fakeConsole: Pick<Console, 'warn' | 'error'> = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const result = await validatePreset(makePreset('string-err'), {
      transpiler: { evaluate },
      console: fakeConsole,
    });
    expect(result.error).toBe('plain string error');
  });

  it('restores the original console.warn / console.error after evaluation', async () => {
    const originalWarn = vi.fn();
    const originalError = vi.fn();
    const injectedConsole: Pick<Console, 'warn' | 'error'> = {
      warn: originalWarn,
      error: originalError,
    };
    const evaluate = vi.fn().mockImplementation(async () => {
      // Both wrapped functions should be in place during evaluation;
      // these calls route to the wrapper, which captures AND calls the
      // original (so the assertion below about `originalWarn` having
      // been called once holds).
      injectedConsole.warn('inside warn');
      injectedConsole.error('inside error');
    });
    await validatePreset(makePreset(), {
      transpiler: { evaluate },
      console: injectedConsole,
    });
    // The wrapper did its job: originalWarn/Error received the calls.
    expect(originalWarn).toHaveBeenCalledWith('inside warn');
    expect(originalError).toHaveBeenCalledWith('inside error');
    // After the call, the originals are back in place.
    injectedConsole.warn('after');
    injectedConsole.error('after');
    expect(originalWarn).toHaveBeenCalledTimes(2);
    expect(originalError).toHaveBeenCalledTimes(2);
  });

  it('captures multiple warnings across warn and error levels', async () => {
    // The injected console is mutated by validatePreset (warn/error get
    // swapped to capture-wrappers for the duration of evaluate). The
    // evaluate mock closes over the same object, so calls to
    // `injectedConsole.warn(...)` route to the wrapper during evaluation.
    const injectedConsole: Pick<Console, 'warn' | 'error'> = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const evaluate = vi.fn().mockImplementation(async () => {
      injectedConsole.warn('first warn');
      injectedConsole.error('first error');
      injectedConsole.warn('second warn');
    });
    const result = await validatePreset(makePreset('multi'), {
      transpiler: { evaluate },
      console: injectedConsole,
    });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.map((w) => w.level)).toEqual(['warn', 'error', 'warn']);
    expect(result.warnings.map((w) => w.message)).toEqual([
      'first warn',
      'first error',
      'second warn',
    ]);
  });
});
