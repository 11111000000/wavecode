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