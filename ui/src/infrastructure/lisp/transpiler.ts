/**
 * Lisp → Strudel transpiler.
 *
 * Public API matches `@strudel/transpiler.transpiler` shape so it can be
 * swapped in `webaudioRepl({ transpiler: lispTranspiler })`.
 *
 * Pipeline: tokenize → parse → emit.
 *
 * Strudel mini-notation inside string literals is preserved untouched —
 * `@strudel/transpiler.transpiler` (the second arg) handles it downstream.
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
 * WebaudioRepl `transpiler` shim.
 *
 * On syntax error, returns the source as-is with errors populated so
 * the caller can surface them in the UI instead of crashing.
 */
export const lispTranspiler = (code: string, _strudel: unknown): LispTranspilerResult => {
  try {
    const tokens = tokenize(code);
    const ast = parse(tokens);
    const output = emit(ast);
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