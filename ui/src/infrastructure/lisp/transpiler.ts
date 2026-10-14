/**
 * Lisp → Strudel transpiler (pure core).
 *
 * Pipeline: tokenize → parse → emit.
 *
 * This module is DELIBERATELY free of `@strudel/*` imports: the audio
 * path (`@strudel/transpiler`) pulls in `@kabelsalat/web` (a CJS-only
 * module) which breaks the Vitest ESM resolver. Keeping this module pure
 * means unit tests can exercise the Lisp core without touching Strudel.
 *
 * Mini-notation is applied on the AUDIO path only — see
 * `LiveAudioEngine.ensureRepl`, which composes `emitJs` with
 * `@strudel/transpiler.transpiler` for `lisp` mode.
 */

import type { Token } from './lexer';
import { LispSyntaxError, tokenize } from './lexer';
import { parse, type Expr } from './parser';
import { emit } from './emitter';

/** Re-export for tests and downstream consumers. */
export { tokenize, parse, emit, LispSyntaxError };
export type { Token, Expr };

export type LispTranspilerResult = {
  output: string;
  miniLocations: ReadonlyArray<unknown>;
  errors: ReadonlyArray<{ message: string; start: number }>;
};

/**
 * Emit a Lisp source as plain JS (Strudel API calls), WITHOUT the
 * mini-notation pass. Throws `LispSyntaxError` on bad input.
 *
 * Used by `transpileScoreToJs` (the "→ JS" button) so the user sees a
 * clean `note("a4 b4 c5")` instead of the mini-notation-transformed
 * `note(m("a4 b4 c5", offset))` that only the audio path should see.
 */
export const emitJs = (code: string): string => {
  const tokens = tokenize(code);
  const ast = parse(tokens);
  return emit(ast);
};

/**
 * Pure Lisp → JS transpiler. No mini-notation pass (that is applied on
 * the audio path). On Lisp syntax error, returns the source as-is with
 * `errors` populated so callers can surface it instead of crashing.
 */
export const lispTranspiler = (code: string): LispTranspilerResult => {
  try {
    const output = emitJs(code);
    return { output, miniLocations: [], errors: [] };
  } catch (e) {
    if (e instanceof LispSyntaxError) {
      return {
        output: code,
        miniLocations: [],
        errors: [{ message: e.message, start: e.start }],
      };
    }
    throw e;
  }
};