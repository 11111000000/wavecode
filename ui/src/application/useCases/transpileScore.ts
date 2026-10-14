import { emitJs } from '~/infrastructure/lisp/transpiler';
import { LispSyntaxError } from '~/infrastructure/lisp/lexer';

/**
 * Result of trying to transpile a score from Lisp → JS.
 *
 * ok: true  — `js` is the clean Strudel-API-call source (no mini-notation
 *            pass — that's only applied on the audio path).
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
 * Uses `emitJs` (Lisp → JS calls WITHOUT the mini-notation pass) so the
 * button output is the clean source a user expects, not the
 * `m("...")`-wrapped form the audio engine consumes.
 *
 * Errors:
 *   - empty input → 'empty score'
 *   - LispSyntaxError during tokenize/parse → first error message
 *   - other unexpected failure → 'unexpected error: <message>'
 *
 * The function NEVER throws — the caller can `if (!r.ok)` without
 * try/catch.
 */
export const transpileScoreToJs = (source: string): TranspileScoreResult => {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: 'empty score' };

  let js: string;
  try {
    js = emitJs(source);
  } catch (e) {
    if (e instanceof LispSyntaxError) {
      return { ok: false, error: e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `unexpected error: ${msg}` };
  }

  return { ok: true, js };
};