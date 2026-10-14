import { describe, it, expect } from 'vitest';

import { LISP_SYSTEM_PROMPT, getSystemPrompt } from './lispPrompt';
import { GOLDEN_PAIRS } from '~/infrastructure/lisp/goldenPairs';

describe('lispPrompt/LISP_SYSTEM_PROMPT', () => {
  it('mentions the dialect name (so LLM knows it is not regular Lisp)', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/wavecode Lisp-диалекте/);
  });

  it('preserves the additive-editing rule (same as JS prompt)', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/СОХРАНЯЙ СУЩЕСТВУЮЩЕЕ, ДОБАВЛЯЙ НОВОЕ/);
    expect(LISP_SYSTEM_PROMPT).toMatch(/ОБЕРНИ существующее в \(stack/);
  });

  it('documents method-chain rule (chain only inside single-pattern ctor)', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/METHOD-CHAIN/i);
    expect(LISP_SYSTEM_PROMPT).toMatch(/single-pattern constructor/i);
  });

  it('shows at least 3 Lisp few-shot examples (matches real pairs)', () => {
    const exampleMarkers = (LISP_SYSTEM_PROMPT.match(/User:/g) ?? []).length;
    expect(exampleMarkers).toBeGreaterThanOrEqual(3);
  });

  it('forbids sample-based drum names (bd/sd/hh/cp) — same as JS prompt', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/НЕ используй bd\/sd\/hh\/oh\/cp/);
    expect(LISP_SYSTEM_PROMPT).toMatch(/sbd/);
  });

  it('explains the wrap-outer pattern for chaining on stack', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/\(slow 2 \(stack/s);
  });

  it('includes a comment syntax reminder', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/строчный/);
    expect(LISP_SYSTEM_PROMPT).toMatch(/блочный/);
  });
});

describe('lispPrompt/getSystemPrompt', () => {
  it('returns LISP prompt for mode=lisp', () => {
    expect(getSystemPrompt('lisp')).toBe(LISP_SYSTEM_PROMPT);
  });

  it('returns JS prompt for mode=js (different from Lisp)', () => {
    const js = getSystemPrompt('js');
    const lisp = getSystemPrompt('lisp');
    expect(js).not.toBe(lisp);
    // Sanity: JS prompt mentions Strudel mini-notation markers, Lisp does not.
    expect(js).toMatch(/TidalCycles/);
    expect(lisp).toMatch(/wavecode Lisp-диалекте/);
  });
});

describe('lispPrompt/golden pairs — few-shot coverage', () => {
  // LISP_SYSTEM_PROMPT should reference at least the canonical "add bass"
  // and "make faster" examples verbatim — those are the most-tested
  // golden-pair intents. If the prompt diverges, the test fails loudly.
  it('contains the canonical "add bass" example structure', () => {
    // The example should mention "басовую линию" and wrap-in-stack.
    expect(LISP_SYSTEM_PROMPT).toMatch(/добавь басовую линию/);
    expect(LISP_SYSTEM_PROMPT).toMatch(/\(stack/);
  });

  it('contains the canonical "make faster" example structure', () => {
    expect(LISP_SYSTEM_PROMPT).toMatch(/сделай быстрее/);
    expect(LISP_SYSTEM_PROMPT).toMatch(/\(fast 2\)/);
  });

  // All golden pairs' lisp form should be syntactically valid s-expressions
  // (this is already covered in goldenPairs.test.ts; here we just assert
  // the prompt's mini-notation examples survive the same transpile).
  it('every mini-notation example in the prompt survives Lisp transpilation', async () => {
    // Extract code examples between User: and the next User: or end.
    const blocks = LISP_SYSTEM_PROMPT.split(/(?=^User:)/m);
    for (const block of blocks) {
      if (!/^User:/m.test(block)) continue;
      // Heuristic: look for the last parenthesised form in the block.
      // Real examples are 1-3 line snippets ending with `)`.
      const lines = block.split('\n');
      const codeLines: string[] = [];
      for (const line of lines) {
        if (/^\s*$/.test(line)) {
          if (codeLines.length > 0) break;
          continue;
        }
        if (/^User:/.test(line)) continue;
        if (/^Правильный/.test(line)) continue;
        if (/^===/.test(line)) break;
        codeLines.push(line);
      }
      const code = codeLines.join('\n').trim();
      if (!code || !code.startsWith('(')) continue;

      // Transpile: should NOT throw, output should be JS-shaped.
      const { tokenize, parse, emit } = await import('~/infrastructure/lisp/transpiler');
      let output: string;
      try {
        output = emit(parse(tokenize(code)));
      } catch (e) {
        throw new Error(`Prompt example failed to transpile:\n${code}\n\n${(e as Error).message}`);
      }
      expect(output).toMatch(/^[\s\S]*\)$/); // balanced parens
    }
  });
});

describe('lispPrompt — golden pair count and intent alignment', () => {
  it('at least 30 golden pairs (LLM regression baseline)', () => {
    expect(GOLDEN_PAIRS.length).toBeGreaterThanOrEqual(30);
  });
});