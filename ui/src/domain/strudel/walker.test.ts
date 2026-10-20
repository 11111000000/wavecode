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
  collectStacksOf,
  validateForEdit,
  validateForMixer,
  parseScore,
} from './walker';
import { BUILTIN_PRESETS } from '~/domain/presets';

/**
 * Hand-counted expectations for each preset.
 *
 * `topSLayers` / `topStackLayers` describe the FIRST `stack(…)` that
 * `findTopStack` returns — the legacy depth-1 answer that
 * `validateForEdit` (the StepGrid precondition) is defined against.
 * Those values did not change.
 *
 * `sections` / `mixerRows` describe the all-stacks walk that
 * `validateForMixer` uses. They are much larger for every multi-section
 * preset because `cat(stack(…), stack(…), …)` contributes one stack per
 * arrangement section: `edm-house` is 8 sections / 44 layers, of which
 * the legacy answer surfaced only 4.
 */
const EXPECTED_STACK_LAYERS: ReadonlyArray<{
  readonly id: string;
  readonly topSLayers: number;
  readonly topStackLayers: number;
  readonly sections: number;
  readonly mixerRows: number;
}> = [
  //                                first-stack      all-stacks
  { id: 'creep',          topSLayers: 0, topStackLayers: 2, sections: 8, mixerRows: 29 },
  { id: 'edm-house',      topSLayers: 2, topStackLayers: 4, sections: 8, mixerRows: 44 },
  { id: 'hiphop-boombap', topSLayers: 2, topStackLayers: 2, sections: 8, mixerRows: 42 },
  { id: 'jazz-ii-v-i',    topSLayers: 2, topStackLayers: 7, sections: 1, mixerRows: 7 },
  { id: 'ambient-drone',  topSLayers: 1, topStackLayers: 6, sections: 1, mixerRows: 6 },
  { id: 'bossa-nova',     topSLayers: 2, topStackLayers: 7, sections: 1, mixerRows: 7 },
  { id: 'trap-atlanta',   topSLayers: 2, topStackLayers: 3, sections: 8, mixerRows: 43 },
  { id: 'reggaeton',      topSLayers: 3, topStackLayers: 5, sections: 1, mixerRows: 5 },
  { id: 'step-grid-demo', topSLayers: 4, topStackLayers: 4, sections: 1, mixerRows: 4 },
  { id: 'piano-ballad',   topSLayers: 2, topStackLayers: 5, sections: 1, mixerRows: 5 },
  { id: '808-classic',    topSLayers: 4, topStackLayers: 5, sections: 1, mixerRows: 5 },
  { id: 'analog-bass',    topSLayers: 3, topStackLayers: 6, sections: 1, mixerRows: 6 },
  { id: '808-king',       topSLayers: 5, topStackLayers: 6, sections: 1, mixerRows: 6 },
  { id: 'retro-lead',     topSLayers: 2, topStackLayers: 6, sections: 1, mixerRows: 6 },
  { id: 'toms-funk',      topSLayers: 6, topStackLayers: 7, sections: 1, mixerRows: 7 },
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
    // The mixer shape (index/source/name/section quadruples) is the
    // public contract — verify on a hand-built fixture.
    const score = 'stack(s("a"), note("c3"), n("0,1"))';
    const layers = validateForMixer(score);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual({ index: 0, source: 's("a")', name: 'Samples', section: 0 });
    expect(layers[1]).toEqual({ index: 1, source: 'note("c3")', name: 'Piano', section: 0 });
    expect(layers[2]).toEqual({ index: 2, source: 'n("0,1")', name: 'Arp', section: 0 });
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
    for (const { id, topSLayers } of EXPECTED_STACK_LAYERS) {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`preset not found: ${id}`);
      const stack = findTopStackOf(preset.score);
      expect(stack).not.toBeNull();
      const actual = countSLayers(stack!);
      if (actual !== topSLayers) {
        throw new Error(`preset ${id}: expected ${topSLayers} s-layers, got ${actual}`);
      }
      expect(actual).toBe(topSLayers);
    }
  });

  it('findTopStack layer count on every preset matches the documented expectations', () => {
    for (const { id, topStackLayers } of EXPECTED_STACK_LAYERS) {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`preset not found: ${id}`);
      const stack = findTopStackOf(preset.score);
      if (!stack) continue;
      expect(stack.args.length).toBe(topStackLayers);
    }
  });

  // ---- collectStacks: the all-stacks walk the mixer depends on ----

  it('collectStacks returns one ref per stack, in source order', () => {
    const score = [
      'cat(',
      '  stack(note("c3").gain(1), note("e3").gain(1)),',
      '  stack(note("g3").gain(1)),',
      '  stack(s("bd").gain(1), note("c2").gain(1)),',
      ')',
    ].join('\n');
    const refs = collectStacksOf(score);
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.args.length)).toEqual([2, 1, 2]);
  });

  it('collectStacks re-bases nested spans onto the original score text', () => {
    const prefix = '// header comment\ncat([\n  stack(\n    note("c3").gain(1),\n  ),\n])\n';
    const [ref] = collectStacksOf(prefix);
    expect(ref).toBeDefined();
    const stackStart = prefix.indexOf('stack(');
    expect(ref!.start).toBe(stackStart);
    // Slicing by the re-based span must land exactly on the arg text.
    for (const arg of ref!.args) {
      const text = prefix.slice(arg.span.start, arg.span.end);
      expect(text.startsWith('note(')).toBe(true);
      expect(text.endsWith(')')).toBe(true);
    }
  });

  it('collectStacks handles the bracketed cat([...]) form as well as cat(a, b)', () => {
    const bracketed = 'cat([\n  stack(note("c3"), note("e3")),\n  stack(note("g3")),\n])';
    const bare = 'cat(\n  stack(note("c3"), note("e3")),\n  stack(note("g3")),\n)';
    expect(collectStacksOf(bracketed)).toHaveLength(2);
    expect(collectStacksOf(bare)).toHaveLength(2);
  });

  it('collectStacks does not descend into a stack nested inside a stack', () => {
    const score = 'stack(note("c3"), stack(note("e3"), s("bd")))';
    const refs = collectStacksOf(score);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.args).toHaveLength(2);
  });

  it('section count and mixer row count match the documented expectations', () => {
    for (const { id, sections, mixerRows } of EXPECTED_STACK_LAYERS) {
      const preset = BUILTIN_PRESETS.find((p) => p.id === id);
      if (!preset) throw new Error(`preset not found: ${id}`);
      expect(collectStacksOf(preset.score)).toHaveLength(sections);
      expect(validateForMixer(preset.score)).toHaveLength(mixerRows);
    }
  });

  it('mixer rows are enumerated contiguously across sections', () => {
    for (const preset of BUILTIN_PRESETS) {
      const layers = validateForMixer(preset.score);
      layers.forEach((layer, i) => expect(layer.index).toBe(i));
      // Section ordinals are non-decreasing.
      for (let i = 1; i < layers.length; i += 1) {
        expect(layers[i]!.section).toBeGreaterThanOrEqual(layers[i - 1]!.section);
      }
    }
  });
});