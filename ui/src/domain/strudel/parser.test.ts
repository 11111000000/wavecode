/**
 * Unit tests for the Strudel-score parser + AST.
 *
 * Coverage:
 *   - empty / whitespace / comment-only inputs
 *   - single bare call
 *   - top-level stack
 *   - nested stack
 *   - comments interleaved with code
 *   - mini-notation in strings (no parse of inner contents)
 *   - broken / unbalanced syntax (permissive parse, never throws)
 *   - performance benchmark (`parseScore(preset) < 5 ms`)
 */

import { describe, it, expect } from 'vitest';
import { parseScore } from './parser';
import { findTopStack, countSLayers, validateForMixer, validateForEdit } from './walker';
import { BUILTIN_PRESETS } from '~/domain/presets';

const sumNodes = (ast: ReturnType<typeof parseScore>): number => ast.nodes.length;

describe('parseScore', () => {
  it('returns an empty AST for empty input', () => {
    const ast = parseScore('');
    expect(ast.nodes).toEqual([]);
    expect(ast.length).toBe(0);
  });

  it('returns an empty AST for whitespace-only input', () => {
    const ast = parseScore('   \n\n  ');
    expect(ast.nodes).toEqual([]);
  });

  it('parses a single bare call as a CallNode', () => {
    const ast = parseScore('note("c3")');
    expect(sumNodes(ast)).toBe(1);
    expect(ast.nodes[0]?.kind).toBe('call');
    if (ast.nodes[0]?.kind === 'call') {
      expect(ast.nodes[0].name).toBe('note');
      expect(ast.nodes[0].args).toHaveLength(1);
      expect(ast.nodes[0].args[0]?.kind).toBe('string');
    }
  });

  it('parses a top-level stack call as a StackNode', () => {
    const ast = parseScore('stack(s("a"), s("b"))');
    expect(sumNodes(ast)).toBe(1);
    expect(ast.nodes[0]?.kind).toBe('stack');
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    expect(countSLayers(stack!)).toBe(2);
  });

  it('handles a nested stack at top level (one inner layer per arg)', () => {
    const ast = parseScore('stack(s("a"), stack(s("b"), s("c")), s("d"))');
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    // The OUTER stack has 3 args; the inner stack is one arg.
    expect(stack!.args).toHaveLength(3);
  });

  it('emits a CommentNode for leading line comments', () => {
    const ast = parseScore('// hello\ns("a")');
    expect(sumNodes(ast)).toBe(2);
    expect(ast.nodes[0]?.kind).toBe('comment');
    expect(ast.nodes[1]?.kind).toBe('call');
  });

  it('does not parse the contents of a string literal', () => {
    // The `stack(` inside the string is part of data, not code.
    const ast = parseScore('s("fake stack(")');
    expect(sumNodes(ast)).toBe(1);
    expect(ast.nodes[0]?.kind).toBe('call');
    expect(findTopStack(ast)).toBeNull();
  });

  it('does not count `s("…")` inside a line comment as a sample row', () => {
    // Regression for the regex parser bug — comments are opaque.
    const ast = parseScore('// s("this is in a comment")\nstack(s("a"))');
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    expect(countSLayers(stack!)).toBe(1);
  });

  it('does not count `s("…")` inside a block comment', () => {
    const ast = parseScore('/* s("commented") */\nstack(s("a"))');
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    expect(countSLayers(stack!)).toBe(1);
  });

  it('preserves mini-notation verbatim inside strings', () => {
    const text = 's("<bd sd [hh hh]>")';
    const ast = parseScore(text);
    expect(ast.nodes[0]?.kind).toBe('call');
    if (ast.nodes[0]?.kind === 'call') {
      const arg = ast.nodes[0].args[0];
      expect(arg?.kind).toBe('string');
      if (arg?.kind === 'string') {
        expect(arg.value).toBe('<bd sd [hh hh]>');
      }
    }
  });

  it('parses unbalanced syntax without throwing (returns a valid AST)', () => {
    expect(() => parseScore('stack(s("a")')).not.toThrow();
    expect(() => parseScore('stack(s("a"')).not.toThrow();
    expect(() => parseScore('((')).not.toThrow();
  });

  it('captures spans pointing into the original text', () => {
    const text = 'stack(\n  s("a"),\n  s("b"),\n)';
    const ast = parseScore(text);
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    expect(stack!.span.start).toBe(0);
    expect(stack!.span.end).toBe(text.length);
  });

  it('preserves source text verbatim for round-trip', () => {
    const text = 'stack(\n  s("a"),\n  note("c3"),\n)';
    const ast = parseScore(text);
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    const sliced = text.slice(stack!.span.start, stack!.span.end);
    expect(sliced).toBe(text);
  });

  it('handles comma inside `<>` mini-notation', () => {
    const text = 's("<a, b, c>")';
    const ast = parseScore(text);
    expect(ast.nodes[0]?.kind).toBe('call');
  });

  it('handles comma inside `[ ]` brackets', () => {
    const text = 'n("[a, b, c]")';
    const ast = parseScore(text);
    expect(ast.nodes[0]?.kind).toBe('call');
  });

  it('handles a stack with trailing comma', () => {
    const text = 'stack(s("a"), s("b"),)';
    const ast = parseScore(text);
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    expect(stack!.args).toHaveLength(2);
  });

  it('handles a stack with nested parens in args', () => {
    const text = 's("a").gain(0.5).lpf(saw.range(400, 4000).slow(1))';
    const ast = parseScore(text);
    expect(ast.nodes[0]?.kind).toBe('call');
  });

  it('handles a bare `swing(0.5, 1/8)` call', () => {
    const text = 's("hh*8").swing(0.5, 1/8)';
    const ast = parseScore(text);
    expect(ast.nodes[0]?.kind).toBe('call');
  });

  it('parses numbers as separate args', () => {
    const ast = parseScore('gain(0.5, 0.6)');
    if (ast.nodes[0]?.kind === 'call') {
      expect(ast.nodes[0].args).toHaveLength(2);
      expect(ast.nodes[0].args[0]?.kind).toBe('number');
      expect(ast.nodes[0].args[1]?.kind).toBe('number');
    }
  });

  it('handles a 4-layer stack (the precondition for StepGrid edit mode)', () => {
    const text = [
      'stack(',
      '  s("bd ~ bd ~ ~ ~ ~ ~"),',
      '  s("~ sd ~ sd ~ ~ ~ ~"),',
      '  s("hh hh hh hh hh hh hh hh"),',
      '  s("~ ~ ~ ~ ~ ~ ~ ~")',
      ')',
    ].join('\n');
    const ast = parseScore(text);
    const stack = findTopStack(ast);
    expect(stack).not.toBeNull();
    expect(countSLayers(stack!)).toBe(4);
    expect(validateForEdit(text).ok).toBe(true);
  });

  it('perf budget: parses any preset within a generous CI budget (median over 200 runs)', () => {
    // The 5-ms target in `decisions/wavecode-strudel-ast` was
    // measured on M1. CI runs in a NixOS QEMU VM that is ~2-3x
    // slower, so we set the ceiling at 20 ms — well under the
    // 50 ms debounce window of the MixerPanel's reactive memo.
    const samples: number[] = [];
    const preset = BUILTIN_PRESETS[0]!;
    // Warm-up.
    for (let i = 0; i < 10; i += 1) parseScore(preset.score);
    // Benchmark.
    for (let i = 0; i < 200; i += 1) {
      const t0 = performance.now();
      parseScore(preset.score);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(median).toBeLessThan(20);
  });

  it('validateForMixer fallback when no stack present', () => {
    const layers = validateForMixer('note("c3 e3 g3")');
    expect(layers).toHaveLength(1);
    expect(layers[0]?.index).toBe(0);
    expect(layers[0]?.name).toBe('Piano');
  });

  it('validateForMixer counts stack layers by source', () => {
    const layers = validateForMixer('stack(s("a"), note("c3"), n("0,1,2"))');
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => l.name)).toEqual(['Samples', 'Piano', 'Arp']);
  });

  it('validateForEdit returns ok: true iff 4 s-layers present', () => {
    expect(validateForEdit('stack(s("a"), s("b"), s("c"), s("d"))').ok).toBe(true);
    expect(validateForEdit('stack(s("a"), s("b"), s("c"))').ok).toBe(false);
    expect(validateForEdit('stack(s("a"), note("c"))').ok).toBe(false);
    expect(validateForEdit('note("c")').ok).toBe(false);
    expect(validateForEdit('').ok).toBe(false);
  });
});

/**
 * Regression tests for the string-unescape behaviour in `makeArg`.
 * The original implementation used a naive `s.replace(/\\(.)/g, '$1')`
 * which collapsed `s("a\nb")` (literal backslash + n) into `s("anb")`,
 * corrupting the user's source on round-trip. Fix: delegate unescape
 * to `JSON.parse` (which mirrors how Strudel would eval the string at
 * run time) with a try/catch fallback to the naive algorithm for
 * exotic escapes that JSON rejects (so the parser never throws).
 */
describe('string argument unescape', () => {
  it('unescapes \\n as a real newline character (not literal "n")', () => {
    const ast = parseScore('s("a\\nb")');
    const stack = findTopStack(ast) as { args: ReadonlyArray<{ kind: string; value?: string }> } | null;
    // The score is just `s("a\nb")` — no outer stack, so look at top-level call.
    const call = ast.nodes[0] as { kind: string; args: ReadonlyArray<{ kind: string; value?: string }> };
    expect(call.kind).toBe('call');
    expect(call.args[0]?.kind).toBe('string');
    expect(call.args[0]?.value).toBe('a\nb');
  });

  it('unescapes \\\\ as a single backslash', () => {
    const ast = parseScore('s("a\\\\b")');
    const call = ast.nodes[0] as { kind: string; args: ReadonlyArray<{ kind: string; value?: string }> };
    expect(call.args[0]?.value).toBe('a\\b');
  });

  it('unescapes \\" without breaking the string boundary', () => {
    const ast = parseScore('s("say \\"hi\\"")');
    const call = ast.nodes[0] as { kind: string; args: ReadonlyArray<{ kind: string; value?: string }> };
    expect(call.args[0]?.value).toBe('say "hi"');
  });

  it('unescapes \\t and \\u00e9', () => {
    const ast = parseScore('s("\\tcaf\\u00e9")');
    const call = ast.nodes[0] as { kind: string; args: ReadonlyArray<{ kind: string; value?: string }> };
    expect(call.args[0]?.value).toBe('\tcafé');
  });

  it('falls back to raw text for unknown escapes (does not throw)', () => {
    // \q is not a valid JSON escape — JSON.parse would throw. The
    // parser must still return a value rather than crash.
    const ast = parseScore('s("a\\qb")');
    const call = ast.nodes[0] as { kind: string; args: ReadonlyArray<{ kind: string; value?: string }> };
    expect(call.args[0]?.kind).toBe('string');
    // Fallback path returns the naive-unscape (drops the backslash).
    expect(call.args[0]?.value).toBe('aqb');
  });
});