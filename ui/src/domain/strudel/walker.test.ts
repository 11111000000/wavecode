/**
 * Unit tests for the Strudel-score AST walker.
 *
 * Coverage:
 *   - findTopStack on every BUILTIN_PRESETS entry (fuzz-style)
 *   - countSLayers on hand-built fixtures
 *   - validateForEdit / validateForMixer behaviour
 *   - hand-counted layer totals for each preset (regression net)
 */

import { describe, it, expect } from 'vitest';
import {
  findTopStackOf,
  countSLayers,
  getStackArgs,
  validateForEdit,
  validateForMixer,
  parseScore,
} from './walker';
import { BUILTIN_PRESETS } from '~/domain/presets';

/**
 * Hand-counted layer totals for each preset (the test against
 * which `findTopStack` + `countSLayers` must match). Derived
 * from the score strings in `ui/src/domain/presets.ts` (Oct 2026
 * audit) and the documented layering in each preset comment.
 *
 * These values are derived from the legacy regex-parser
 * behaviour (which returned the first `stack(` regardless of
 * nesting) and now act as the regression oracle: any change
 * to `findTopStack` semantics must be reflected here.
 */
const EXPECTED_STACK_LAYERS: ReadonlyArray<{ readonly id: string; readonly sLayers: number; readonly totalLayers: number }> = [
  { id: 'creep', sLayers: 0, totalLayers: 2 }, // verse bar 1 only (legacy depth-1)
  { id: 'edm-house', sLayers: 2, totalLayers: 4 }, // section 1 only (legacy depth-1)
  { id: 'hiphop-boombap', sLayers: 2, totalLayers: 2 }, // intro only (legacy depth-1)
  { id: 'jazz-ii-v-i', sLayers: 2, totalLayers: 7 }, // no cat wrapper, top-level stack
  { id: 'ambient-drone', sLayers: 1, totalLayers: 6 }, // top-level stack
  { id: 'bossa-nova', sLayers: 2, totalLayers: 7 }, // top-level stack
  { id: 'trap-atlanta', sLayers: 2, totalLayers: 3 }, // section 1 only (legacy depth-1)
  { id: 'reggaeton', sLayers: 3, totalLayers: 5 }, // top-level stack (5 layers)
  { id: 'step-grid-demo', sLayers: 4, totalLayers: 4 }, // 4 s-layers, edit-mode valid
  { id: 'piano-ballad', sLayers: 2, totalLayers: 5 }, // top-level stack
  { id: '808-classic', sLayers: 4, totalLayers: 5 }, // 4 s-layers + 1 note — edit NOT valid (mix of s and note)
  { id: 'analog-bass', sLayers: 3, totalLayers: 6 }, // 3 s-layers + 3 note — edit NOT valid
  { id: '808-king', sLayers: 5, totalLayers: 6 }, // 5 s-layers, edit NOT valid
  { id: 'retro-lead', sLayers: 2, totalLayers: 6 }, // top-level stack
  { id: 'toms-funk', sLayers: 6, totalLayers: 7 }, // 6 s-layers + 1 note — edit NOT valid
];

describe('walker', () => {
  it('findTopStack returns null for empty input', () => {
    expect(findTopStackOf('')).toBeNull();
  });

  it('findTopStack returns null for whitespace-only input', () => {
    expect(findTopStackOf('   \n  ')).toBeNull();
  });

  it('findTopStack returns null for input with no stack call', () => {
    expect(findTopStackOf('note("c3")')).toBeNull();
  });

  it('findTopStack finds a single top-level stack', () => {
    const stack = findTopStackOf('stack(s("a"), s("b"))');
    expect(stack).not.toBeNull();
    expect(countSLayers(stack!)).toBe(2);
  });

  it('countSLayers counts only `s(…)` leading-name args', () => {
    const stack = findTopStackOf('stack(s("a"), note("c"), n("0,1"), s("b"), S("c"))')!;
    expect(countSLayers(stack)).toBe(3);
  });

  it('countSLayers is case-insensitive on the leading name', () => {
    const stack = findTopStackOf('stack(S("a"), S("b"))')!;
    expect(countSLayers(stack)).toBe(2);
  });

  it('countSLayers returns 0 for a stack with no `s(…)` rows', () => {
    const stack = findTopStackOf('stack(note("c"), n("0,1"))')!;
    expect(countSLayers(stack)).toBe(0);
  });

  it('getStackArgs returns source + span in order', () => {
    const stack = findTopStackOf('stack(s("a"), note("c"))')!;
    const args = getStackArgs(stack);
    expect(args).toHaveLength(2);
    expect(args[0]?.source).toBe('s("a")');
    expect(args[1]?.source).toBe('note("c")');
  });

  it('validateForEdit returns ok: true exactly for step-grid-demo', () => {
    expect(validateForEdit(BUILTIN_PRESETS.find((p) => p.id === 'step-grid-demo')!.score).ok).toBe(true);
  });

  it('validateForEdit returns ok: false for presets with non-sample layers', () => {
    for (const id of ['creep', 'edm-house', 'hiphop-boombap', 'jazz-ii-v-i', 'bossa-nova', 'reggaeton', 'piano-ballad', 'analog-bass', '808-king', 'retro-lead', 'toms-funk']) {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id)!;
      expect(validateForEdit(preset.score).ok).toBe(false);
    }
  });

  it('validateForEdit returns discriminated reason: "empty" for whitespace-only input', () => {
    const r = validateForEdit('   \n  ');
    expect(r).toEqual({ ok: false, layerCount: 0, reason: 'empty' });
  });

  it('validateForEdit returns discriminated reason: "no-top-stack" when no stack at all', () => {
    const r = validateForEdit('note("c4 e4 g4")');
    expect(r).toEqual({ ok: false, layerCount: 0, reason: 'no-top-stack' });
  });

  it('validateForEdit returns discriminated reason: "wrong-count" with the actual count', () => {
    const r = validateForEdit('stack(s("a"), s("b"), s("c"))');
    expect(r).toEqual({ ok: false, layerCount: 3, reason: 'wrong-count' });
  });

  it('validateForEdit returns reason: null on success', () => {
    const r = validateForEdit('stack(s("a"), s("b"), s("c"), s("d"))');
    expect(r).toEqual({ ok: true, layerCount: 4, reason: null });
  });

  it('validateForMixer returns the same layers as the legacy parseStackTopLayers', () => {
    // The mixer shape (index/source/name triples) is the public
    // contract — verify on a hand-built fixture.
    const score = 'stack(s("a"), note("c3"), n("0,1"))';
    const layers = validateForMixer(score);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual({ index: 0, source: 's("a")', name: 'Samples' });
    expect(layers[1]).toEqual({ index: 1, source: 'note("c3")', name: 'Piano' });
    expect(layers[2]).toEqual({ index: 2, source: 'n("0,1")', name: 'Arp' });
  });

  // ---- Fuzz / regression: every preset parses ----

  it('every BUILTIN_PRESETS entry parses via parseScore without throwing', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(() => parseScore(preset.score)).not.toThrow();
    }
  });

  it('every BUILTIN_PRESETS entry has either a stack inside or returns a single-layer fallback', () => {
    for (const preset of BUILTIN_PRESETS) {
      const stack = findTopStackOf(preset.score);
      const mixer = validateForMixer(preset.score);
      if (stack) {
        expect(stack.args.length).toBeGreaterThan(0);
        expect(mixer.length).toBeGreaterThan(0);
      } else {
        expect(mixer.length).toBe(1);
        expect(mixer[0]?.source).toBe(preset.score.trim());
      }
    }
  });

  it('countSLayers on every preset matches the documented expectations', () => {
    for (const { id, sLayers } of EXPECTED_STACK_LAYERS) {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`preset not found: ${id}`);
      const stack = findTopStackOf(preset.score);
      expect(stack).not.toBeNull();
      const actual = countSLayers(stack!);
      if (actual !== sLayers) {
        throw new Error(`preset ${id}: expected ${sLayers} s-layers, got ${actual}`);
      }
      expect(actual).toBe(sLayers);
    }
  });

  it('total layer count on every preset matches the documented expectations', () => {
    for (const { id, totalLayers } of EXPECTED_STACK_LAYERS) {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`preset not found: ${id}`);
      const stack = findTopStackOf(preset.score);
      if (!stack) continue;
      expect(stack.args.length).toBe(totalLayers);
    }
  });
});