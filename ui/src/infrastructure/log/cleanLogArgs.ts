/**
 * Strudel-styled console.log cleanup (no IO, no state).
 *
 * Why this exists
 * ---------------
 * `@strudel/core/logger.mjs:21` emits
 *
 *   console.log(`%c${message}`, 'background-color: black;…');
 *
 * Chromium DevTools interprets the `%c` token together with the companion
 * CSS string as one styled message — the CSS never appears in the rendered
 * output. Plain console viewers (Paseo chat, copy-paste, log files, and
 * the in-app Console UI which renders entries as text) instead see
 *
 *   [eval] code updated background-color: black;color:white;border-radius:15px
 *
 * — the CSS appended verbatim to every line.
 *
 * Two shapes appear in practice:
 *
 *   (1) Two-arg:
 *         console.log('%c[eval] code updated',
 *                     'background-color: black;color:white;border-radius:15px');
 *
 *   (2) Single-arg concatenated (defensive — Strudel sometimes inlines
 *       the CSS when wrapping helper runs in source-transform modes):
 *         console.log('%c[eval] code updated background-color: black;…');
 *
 * `cleanLogArgs` returns a new array with the CSS removed. Used by:
 *
 *   - `strudelPatches.wrapStrudelLogger` — monkey-patches console.log →
 *     console.error, stripping CSS before rerouting.
 *   - `infrastructure/log/logger` — intercepts console.{log,info,warn,
 *     error} at install() time so the Console UI can render clean text.
 *
 * Rationale: `math/wavecode-log-pipeline-foundation/packet.md`.
 *
 * Behavior
 * --------
 * - Detects Strudel-style first arg: string starting with `%c[`.
 * - Two-arg shape: drops the CSS companion string, strips `%c` tokens
 *   from strings.
 * - One-arg shape: trims the trailing CSS substring (starting at the
 *   first `background-color:` / `color: white` / `border-radius` match),
 *   strips `%c` tokens.
 * - Strudel-style head without any CSS arg anywhere: still strips `%c`
 *   tokens from strings (defensive — Strudel sometimes drops the CSS arg).
 * - Non-Strudel args, non-string first args, empty arrays: returned as a
 *   fresh shallow copy.
 * - Idempotent: `cleanLogArgs(cleanLogArgs(x))` deep-equals
 *   `cleanLogArgs(x)`.
 */

const STRUDEU_CSS_HEURISTIC = /background-color:|color:\s*white|border-radius/;

export const cleanLogArgs = (args: readonly unknown[]): unknown[] => {
  if (args.length === 0) return args.slice();
  if (typeof args[0] !== 'string' || !args[0].startsWith('%c[')) {
    return args.slice();
  }

  // CSS-arg may live in args[1] (two-arg shape) or be concatenated into
  // args[0] (one-arg shape). Detect first, then dispatch.
  const cssArgIndex = args.findIndex(
    (a) => typeof a === 'string' && STRUDEU_CSS_HEURISTIC.test(a),
  );

  if (cssArgIndex === 1) {
    // Two-arg shape: drop the CSS companion. args[0] is narrowed to
    // `string` by the guard at the top of this function.
    const cleanedHead = args[0].replace(/%c/g, '');
    return [cleanedHead, ...args.slice(2)];
  }

  if (cssArgIndex === 0) {
    // One-arg concatenated shape: trim from start of CSS substring to
    // end of string. The CSS is always at the tail in Strudel's output
    // (`%c<msg> <css>`); trimming from the match start covers the only
    // shape seen in `@strudel/core` logger.mjs.
    const head = args[0];
    const match = STRUDEU_CSS_HEURISTIC.exec(head);
    const trimAt = match && typeof match.index === 'number' ? match.index : head.length;
    return [head.slice(0, trimAt).trimEnd().replace(/%c/g, '')];
  }

  if (cssArgIndex > 1) {
    // CSS appears beyond args[1] (unusual — Strudel doesn't emit this).
    // Don't try to be clever: just strip `%c` tokens from strings and
    // keep everything else as-is. The buffer entry will still have the
    // CSS garbage, but we avoid munging order in an unsupported shape.
    return args.map((a) => (typeof a === 'string' ? a.replace(/%c/g, '') : a));
  }

  // No CSS anywhere — defensive Strudel-style head. Strip `%c` tokens
  // from strings; leave non-string args untouched.
  return args.map((a) => (typeof a === 'string' ? a.replace(/%c/g, '') : a));
};