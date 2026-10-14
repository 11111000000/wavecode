import { lispTranspiler } from '~/infrastructure/lisp/transpiler';

/**
 * Result of trying to transpile a score from Lisp → JS.
 *
 * ok: true  — `js` is the transpiled Strudel-compatible source.
 * ok: false — `error` is a human-readable failure reason.
 */
export type TranspileScoreResult =
  | { readonly ok: true; readonly js: string }
  | { readonly ok: false; readonly error: string };

/**
 * Transpile a Lisp score to its JS (Strudel-API-call) form.
 *
 * Pure function. No I/O, no dispatch, no state mutation — the caller
 * (TranspileButton or use case) decides what to do with the result.
 *
 * Errors:
 *   - empty input → 'empty score'
 *   - LispSyntaxError during tokenize/parse → first error message
 *   - other unexpected failure → 'unexpected error: <message>'
 *
 * The function NEVER throws — the caller can `if (!r.ok)` without
 * try/catch. This matches the contract of `lispTranspiler` which
 * already swallows internal errors and returns them in `r.errors`.
 */
export const transpileScoreToJs = (source: string): TranspileScoreResult => {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: 'empty score' };

  let result;
  try {
    result = lispTranspiler(source, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `unexpected error: ${msg}` };
  }

  if (result.errors.length > 0) {
    const first = result.errors[0];
    return {
      ok: false,
      error: first ? first.message : 'unknown transpile error',
    };
  }

  return { ok: true, js: result.output };
};