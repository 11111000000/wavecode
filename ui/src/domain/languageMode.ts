/**
 * Score-file language mode.
 *
 * `js`   — current Strudel-JS mode (default). Score is JS code, evaluated
 *          through `@strudel/transpiler.transpiler` for mini-notation.
 * `lisp` — Scheme-like Lisp dialect. Score is s-expressions, transpiled
 *          to JS calls before reaching Strudel.
 *
 * See `math/wavecode-lisp-transpiler` packet.
 */
export type LanguageMode = 'js' | 'lisp';

export const DEFAULT_LANGUAGE_MODE: LanguageMode = 'js';

export const isLanguageMode = (v: unknown): v is LanguageMode =>
  v === 'js' || v === 'lisp';

/**
 * Detect the language of a score from its content, NOT from persisted
 * state. This is the reliable signal for eval / button visibility / LLM
 * prompt — a stale `localStorage` value (e.g. `lisp` from an old session
 * while the score is still JS) must not break playback.
 *
 * Heuristic (skips blank lines and comment lines):
 *   - first non-comment line starting with `(` → `lisp`
 *   - otherwise → `js`
 *
 * JS scores start with `// comment`, `stack(`, `note(` — never a bare
 * `(`; Lisp scores start with `(stack ...)` etc. A `;;`-comment then a
 * `(...)` is Lisp; a `//`-comment is JS.
 */
export const detectLanguage = (score: string): LanguageMode => {
  for (const raw of score.split('\n')) {
    const t = raw.trim();
    if (t === '') continue;
    if (t.startsWith(';;')) continue;
    if (t.startsWith('//')) return 'js';
    if (t.startsWith('(')) return 'lisp';
    // first non-empty, non-comment token decides
    return 'js';
  }
  return 'js';
};