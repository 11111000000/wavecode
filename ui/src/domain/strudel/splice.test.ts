/**
 * Unit tests for the AST-based `appendToTopStack` and
 * `replaceLayerSources` score splices.
 *
 * `appendToTopStack` tests pin the legacy `stackAppend` behaviour
 * (the hand-rolled paren-walker previously living in
 * `pianoRecStore.ts` / `micStore.ts`) so the migration to the AST
 * is a drop-in replacement, PLUS the new "unbalanced stack" refusal
 * the walker could not express.
 *
 * `replaceLayerSources` tests cover the in-place byte-range splice
 * that powers `editGridLayer` — every character between edited rows
 * must be preserved verbatim, including commas, whitespace, and
 * comments.
 */

import { describe, it, expect } from 'vitest';
import { appendToTopStack, appendLayersToScore, replaceLayerSources } from './splice';

const SNIPPET = 'note("c4").s("triangle")';

describe('appendToTopStack — empty / whitespace editor', () => {
  it('returns the snippet verbatim for an empty editor', () => {
    const out = appendToTopStack('', SNIPPET);
    expect(out).toEqual({ ok: true, score: SNIPPET });
  });

  it('returns the snippet verbatim for a whitespace-only editor', () => {
    const out = appendToTopStack('   \n  ', SNIPPET);
    expect(out).toEqual({ ok: true, score: SNIPPET });
  });
});

describe('appendToTopStack — wrap (no top-level stack)', () => {
  it('wraps a bare note(...) score in a fresh stack', () => {
    const out = appendToTopStack('note("e4 g4")', SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toMatch(/^stack\(/);
      expect(out.score).toContain('note("e4 g4")');
      expect(out.score).toContain(SNIPPET);
      expect(out.score.trimEnd().endsWith(')')).toBe(true);
    }
  });

  it('wraps a cat([...]) container (not a splice target)', () => {
    const out = appendToTopStack('cat([s("a"), s("b")])', SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
      expect(out.score).toContain('cat([s("a"), s("b")])');
    }
  });

  it('does not splice into a stack that follows a non-stack statement', () => {
    // Legacy `findTopLevelStackAt` required the FIRST token to be `stack`.
    const out = appendToTopStack('foo(1)\nstack(s("a"))', SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Wrapped, not spliced → a fresh outer stack containing both.
      expect(out.score).toMatch(/^stack\(/);
      expect(out.score).toContain('foo(1)');
      expect(out.score).toContain('stack(s("a"))');
    }
  });
});

/**
 * Многосекционный пресет (`cat(stack(…), stack(…), …)`) — самая частая
 * форма партитуры в приложении. Запись (ритм, микрофон, пианино)
 * должна стать НОВОЙ СЕКЦИЕЙ, а не обернуть весь пресет во внешний
 * `stack(...)`: обёртка схлопывала микшер с 29 строк до двух.
 */
describe('appendToTopStack — многосекционный пресет', () => {
  const preset = [
    'cat(',
    '  stack(note("c4"), note("g4")),',
    '  stack(note("e4"))',
    ')',
  ].join('\n');

  it('добавляет запись как новую секцию, а не оборачивает пресет', () => {
    const out = appendToTopStack(preset, SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toMatch(/^cat\(/);
      expect(out.score).toContain('stack(note("c4"), note("g4"))');
      expect(out.score).toContain('stack(note("e4"))');
      expect(out.score).toContain('note("c4").s("triangle")');
    }
  });

  it('микшер видит все слои пресета плюс новую секцию', async () => {
    const { listLayerSpans } = await import('~/domain/layers/layerSpans');
    const out = appendToTopStack(preset, SNIPPET);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const layers = listLayerSpans(out.score);
    // 2 слоя первой секции + 1 слой второй + 1 слой новой секции.
    expect(layers.length).toBe(4);
    expect(layers[3]?.source).toContain('note("c4").s("triangle")');
  });
});

/**
 * `appendLayersToScore` — добавление НЕСКОЛЬКИХ независимых слоёв.
 *
 * Зачем: шаг-сетка коммитит четыре ударных ряда. Если завернуть их
 * в один `stack(...)`, микшер покажет одну строку вместо четырёх и
 * фейдер на ней двигал бы барабан, малый, хай-хэт и клэп разом.
 */
describe('appendLayersToScore — несколько слоёв', () => {
  const ROWS = ['s("bd ~ ~ ~ ~ ~ ~ ~")', 's("~ sd ~ ~ ~ ~ ~ ~")', 's("~ ~ hh ~ ~ ~ ~ ~")', 's("~ ~ ~ ~ ~ ~ ~ ~")'];

  it('пустой редактор → stack из четырёх слоёв', () => {
    const out = appendLayersToScore('', ROWS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.score).toMatch(/^stack\(/);
    for (const row of ROWS) expect(out.score).toContain(row);
    expect((out.score.match(/\bs\("/g) ?? []).length).toBe(4);
  });

  it('верхнеуровневый stack → слои добавляются внутрь него', () => {
    const existing = 'stack(\n  note("c4")\n)';
    const out = appendLayersToScore(existing, ROWS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
    for (const row of ROWS) expect(out.score).toContain(row);
  });

  it('пресет cat(...) → новая секция, все слои пресета на месте', async () => {
    const preset = [
      'cat(',
      '  stack(note("c4"), note("g4")),',
      '  stack(note("e4"))',
      ')',
    ].join('\n');
    const out = appendLayersToScore(preset, ROWS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.score).toMatch(/^cat\(/);
    const { listLayerSpans } = await import('~/domain/layers/layerSpans');
    const layers = listLayerSpans(out.score);
    // 2 + 1 слоя пресета и 4 новых ряда сетки.
    expect(layers.length).toBe(7);
    expect(layers[3]?.source).toContain('s("bd ~ ~ ~ ~ ~ ~ ~")');
  });

  it('пустой список слоёв → партитура не меняется', () => {
    const out = appendLayersToScore('note("c4")', []);
    expect(out).toEqual({ ok: true, score: 'note("c4")' });
  });

  it('пустые и пробельные источники отбрасываются', () => {
    const out = appendLayersToScore('', ['', '   ', 's("bd")']);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.score).toContain('s("bd")');
    expect((out.score.match(/\bs\("/g) ?? []).length).toBe(1);
  });
});

describe('appendToTopStack — splice into existing top-level stack', () => {
  it('splices inside, preserving a single outer stack', () => {
    const existing = 'stack(\n  note("e4"),\n  s("hh*4")\n)';
    const out = appendToTopStack(existing, SNIPPET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score.startsWith('stack(')).toBe(true);
      expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
      expect(out.score).toContain('note("e4")');
      expect(out.score).toContain('s("hh*4")');
      expect(out.score).toContain(SNIPPET);
    }
  });

  it('does not double the comma when the stack ends with a trailing comma', () => {
    const out = appendToTopStack('stack(s("a"),)', 's("b")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('s("a"),');
      expect(out.score).toContain('s("b")');
      expect(out.score).not.toContain(',,\n');
    }
  });

  it('survives commas inside nested string args of an existing stack', () => {
    const out = appendToTopStack('stack(s("<a, b, c>"), s("d"))', 's("e")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('s("<a, b, c>")');
      expect(out.score).toContain('s("d")');
      expect(out.score).toContain('s("e")');
    }
  });

  it('does not treat s("…") inside a comment as a splice boundary', () => {
    const existing = 'stack(\n  // s("fake layer")\n  s("a")\n)';
    const out = appendToTopStack(existing, 's("b")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('s("fake layer")');
      expect(out.score).toContain('s("a")');
      expect(out.score).toContain('s("b")');
      expect((out.score.match(/\bstack\s*\(/g) ?? []).length).toBe(1);
    }
  });

  it('keeps a trailing method chain (.gain / .slow) outside the splice', () => {
    const out = appendToTopStack('stack(s("a")).gain(0.5)', 's("b")');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toContain('.gain(0.5)');
      expect(out.score).toContain('s("b")');
      expect(out.score).toContain('s("a")');
    }
  });
});

describe('appendToTopStack — unbalanced stack refusal', () => {
  it('returns { ok: false } for an unterminated stack(...)', () => {
    const out = appendToTopStack('stack(s("a")', SNIPPET);
    expect(out).toEqual({ ok: false, reason: 'unbalanced-stack' });
  });

  it('returns { ok: false } for a stack with an unterminated string', () => {
    const out = appendToTopStack('stack(s("a", s("b")', SNIPPET);
    expect(out).toEqual({ ok: false, reason: 'unbalanced-stack' });
  });
});

describe('replaceLayerSources — no-op and preconditions', () => {
  it('returns the original score when no edits are requested', () => {
    const score = 'stack(s("a"), s("b"), s("c"), s("d"))';
    const out = replaceLayerSources(score, []);
    expect(out).toEqual({ ok: true, score, replaced: 0 });
  });

  it('returns { ok: false, reason: "no-top-stack" } for a non-stack score', () => {
    const out = replaceLayerSources('note("c4 e4 g4")', [{ index: 0, source: 's("x")' }]);
    expect(out).toEqual({ ok: false, reason: 'no-top-stack' });
  });

  it('returns { ok: false, reason: "no-top-stack" } for an unbalanced stack', () => {
    const out = replaceLayerSources('stack(s("a")', [{ index: 0, source: 's("x")' }]);
    expect(out).toEqual({ ok: false, reason: 'no-top-stack' });
  });

  it('returns { ok: false, reason: "index-out-of-range" } for an out-of-bounds index', () => {
    const out = replaceLayerSources('stack(s("a"), s("b"))', [
      { index: 5, source: 's("x")' },
    ]);
    expect(out).toEqual({ ok: false, reason: 'index-out-of-range' });
  });

  it('returns { ok: false, reason: "index-out-of-range" } for duplicate indices', () => {
    const out = replaceLayerSources('stack(s("a"), s("b"))', [
      { index: 0, source: 's("x")' },
      { index: 0, source: 's("y")' },
    ]);
    expect(out).toEqual({ ok: false, reason: 'index-out-of-range' });
  });

  it('returns { ok: false, reason: "index-out-of-range" } for negative indices', () => {
    const out = replaceLayerSources('stack(s("a"), s("b"))', [
      { index: -1, source: 's("x")' },
    ]);
    expect(out).toEqual({ ok: false, reason: 'index-out-of-range' });
  });

  it('returns { ok: false } without partially applying edits on validation failure', () => {
    // 2 valid edits + 1 invalid → no splice at all (no half-state).
    const score = 'stack(s("a"), s("b"), s("c"), s("d"))';
    const out = replaceLayerSources(score, [
      { index: 0, source: 's("X")' },
      { index: 99, source: 's("Y")' },
      { index: 1, source: 's("Z")' },
    ]);
    expect(out).toEqual({ ok: false, reason: 'index-out-of-range' });
  });
});

describe('replaceLayerSources — in-place byte-range splice', () => {
  it('replaces a single row and preserves every other byte', () => {
    const score = 'stack(\n  s("a"),\n  s("b"),\n  s("c"),\n  s("d")\n)';
    const out = replaceLayerSources(score, [
      { index: 1, source: 's("REPLACED")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.replaced).toBe(1);
      expect(out.score).toBe(
        'stack(\n  s("a"),\n  s("REPLACED"),\n  s("c"),\n  s("d")\n)',
      );
    }
  });

  it('replaces multiple rows in one pass (right-to-left internally)', () => {
    const score = 'stack(s("a"), s("b"), s("c"), s("d"))';
    const out = replaceLayerSources(score, [
      { index: 0, source: 's("A")' },
      { index: 2, source: 's("C")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toBe('stack(s("A"), s("b"), s("C"), s("d"))');
    }
  });

  it('preserves commas between args (does not double them)', () => {
    const score = 'stack(s("a"), s("b"), s("c"), s("d"))';
    const out = replaceLayerSources(score, [
      { index: 1, source: 's("X")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toBe('stack(s("a"), s("X"), s("c"), s("d"))');
      expect(out.score).not.toContain(',,');
    }
  });

  it('preserves non-sample (note/n) args in mixed stacks', () => {
    const score = 'stack(note("c4"), s("a"), s("b"), s("c"), s("d"))';
    const out = replaceLayerSources(score, [
      { index: 1, source: 's("X")' },
      { index: 3, source: 's("Y")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // note("c4") is untouched byte-for-byte.
      expect(out.score).toBe(
        'stack(note("c4"), s("X"), s("b"), s("Y"), s("d"))',
      );
    }
  });

  it('preserves leading and trailing whitespace + comments', () => {
    const score = '// my beat\n  stack(\n    s("a"),\n    s("b"),\n    s("c"),\n    s("d")\n  )\n';
    const out = replaceLayerSources(score, [
      { index: 0, source: 's("X")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score.startsWith('// my beat\n  stack(')).toBe(true);
      expect(out.score.endsWith('  )\n')).toBe(true);
      expect(out.score).toContain('s("X")');
      // Indentation inside the stack is preserved.
      expect(out.score).toContain('    s("X"),');
    }
  });

  it('does not confuse s("…") inside a comment with an s-row', () => {
    // The comment contains text that LOOKS like a sample row, but the
    // AST only counts actual top-level args.
    const score = '// s("fake")\nstack(s("a"), s("b"), s("c"), s("d"))';
    const out = replaceLayerSources(score, [
      { index: 0, source: 's("REAL")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toBe('// s("fake")\nstack(s("REAL"), s("b"), s("c"), s("d"))');
    }
  });

  it('handles a shorter replacement (output shorter than input)', () => {
    const score = 'stack(s("xxxxxxxxxx"), s("b"))';
    const out = replaceLayerSources(score, [
      { index: 0, source: 's("x")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toBe('stack(s("x"), s("b"))');
    }
  });

  it('handles a longer replacement (output longer than input)', () => {
    const score = 'stack(s("a"), s("b"))';
    const out = replaceLayerSources(score, [
      { index: 1, source: 's("REPLACED_WITH_SOMETHING_LONGER")' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.score).toBe('stack(s("a"), s("REPLACED_WITH_SOMETHING_LONGER"))');
    }
  });
});
