/**
 * Strudel runtime patches — pure helpers, called from boot/loaders.
 *
 * Why each patch exists (root cause each fixes):
 *
 * 1. wrapStrudelLogger — strips `console.log('%c…', 'background-color: black;…')`
 *    style emissions from `@strudel/core/logger.mjs:21`. The original call
 *    relies on Chromium DevTools to interpret the `%c` token + companion CSS
 *    string. In raw console viewers (Paseo chat, copy-paste, log files) the
 *    CSS string is appended to the message verbatim, polluting error output
 *    with `background-color: black;color:white;border-radius:15px`.
 *
 *    Replacement: route the same call through `console.error` after stripping
 *    the `%c` token. Visually the devtools console now shows the message at
 *    error level (red badge) instead of a styled capsule; everywhere else the
 *    message is plain text with no CSS garbage.
 *
 *    The actual CSS-strip logic lives in `infrastructure/log/cleanLogArgs`
 *    so it can be shared with `infrastructure/log/logger` (which captures
 *    console.* for the in-app Console UI). This file is now a thin
 *    detection + reroute wrapper.
 *
 * 2. applyVoicingAliases — `@strudel/tonal/voicings.mjs:144` does
 *    `dictionary[symbol].map(...)` on the voicing dictionary; if `symbol`
 *    (chord suffix like `maj7` or `min7`) is not a key the call throws and
 *    the catch in `voicings.mjs:210` emits `[voicing]: unknown chord "X"` ON
 *    EVERY HAP. The ireal dictionaries (`simple`/`complex` from `ireal.mjs`)
 *    ship with tonal-style keys (`^7`, `m7`, etc.) plus `-`/`^`/`+` alias
 *    entries created by `voicingAlias()` at import time. They have NO entry
 *    for the long-form chord symbols `maj7` / `min7` that score authors and
 *    humans write. Jazz preset `<Dmin7 G7 Cmaj7>` hits this path once per
 *    chord change × once per hap of the resolved pattern: ~8 logs/sec spam
 *    in production.
 *
 *    Fix: add `maj7` → `^7`, `min7` → `m7` (and a few other common tails) as
 *    alias entries into both `ireal` and `ireal-ext` dictionaries. They
 *    point to the same voicing arrays, so no musical change. MUST be called
 *    AFTER `@strudel/tonal` module loads (the `voicingAlias()` registrations
 *    happen at import time and we need to add ours AFTER them).
 *
 *    Integration: apply at the end of `LiveAudioEngine.ensureRepl()`,
 *    immediately after `evalScope(core, mini, tonal)` resolves.
 *
 * All patches are idempotent — safe to call more than once.
 *
 * (Historical: `applyBankAliasFallback` / `DEFAULT_BANK_FALLBACKS` lived
 * here as patch #3 until superseded by `SampleLoader.addBareAliases()` +
 * `preloadAllBuffers()` in `wavecode-sample-bank-underscore` shas a140d7c /
 * 6464c35. Bare bank-name lookup (`s("drums")`) is now handled inside
 * SampleLoader.ts, not as a post-load patch.)
 */

import { cleanLogArgs } from '~/infrastructure/log/cleanLogArgs';

let logWrapped = false;
export const wrapStrudelLogger = (): void => {
  if (logWrapped) return;
  logWrapped = true;
  const original = console.log;
  const patched = function patchedLog(this: Console, ...args: unknown[]): void {
    // Detect strudel-flavored log: 1st arg starts with `%c[`, 2nd arg is a
    // CSS string. The shape is stable across @strudel/core logger.mjs:
    //   console.log(`%c${message}`, 'background-color: black;…');
    if (
      args.length >= 2
      && typeof args[0] === 'string'
      && args[0].startsWith('%c[')
    ) {
      const cleaned = cleanLogArgs(args);
      console.error.call(console, ...cleaned);
      return;
    }
    // Also try to strip embedded CSS in single-arg calls (rare Strudel
    // source-transform shape where CSS is concatenated into one string).
    if (
      args.length === 1
      && typeof args[0] === 'string'
      && /%c\[/.test(args[0])
      && /background-color:|border-radius/.test(args[0])
    ) {
      const cleaned = cleanLogArgs(args);
      console.error.call(console, ...cleaned);
      return;
    }
    return original.apply(this, args);
  };
  console.log = patched as typeof console.log;
};

type VoicingDictionary = Record<string, readonly string[] | string>;
type VoicingEntry = { dictionary?: VoicingDictionary } & Record<string, unknown>;
type VoicingRegistry = Record<string, VoicingEntry>;

export type TonalModule = {
  voicingRegistry?: VoicingRegistry;
} & Record<string, unknown>;

// Long-form spellings that Tonal accepts as chord-type tokens but the ireal
// dictionaries (simple/complex from ireal.mjs) have no entries for. Each pair
// is `[long_form_target, source_key_already_in_ireal]`. We copy the source's
// voicing array verbatim, so the long form produces the same output.
const CHORD_ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Major-7 family — `^7` in ireal.
  ['maj7', '^7'],
  ['maj9', '^9'],
  ['maj13', '^13'],
  ['maj7#11', '^7#11'],
  ['maj9#11', '^9#11'],
  ['maj7#5', '^7#5'],
  ['major7', '^7'],
  ['major', '^'],
  // Minor-7 family — `m7` in ireal. Tonal already maps `min` → `m` for
  // triad forms, but the full `min7` suffix is not handled by the ireal
  // dictionary at all.
  ['min7', 'm7'],
  ['min9', 'm9'],
  ['min11', 'm11'],
  ['min13', 'm13'],
  ['min6', 'm6'],
  ['minor', 'm'],
  // Half-diminished / diminished alternate spellings.
  ['hdim7', 'm7b5'],
  ['dim7', 'o7'],
];

const aliasIntoDictionary = (
  dict: VoicingDictionary,
  sink: string,
  source: string,
): boolean => {
  const target = dict[source];
  if (target === undefined) return false;
  if (dict[sink] !== undefined) return false;
  dict[sink] = target;
  return true;
};

/**
 * Inject chord-symbol aliases into every voicing dictionary registered in
 * `tonal.voicingRegistry`. Mutates in place (the registry is module-scope
 * mutable state owned by `@strudel/tonal`). Returns the number of aliases
 * added. Caller must pass the loaded module's namespace.
 */
export const applyVoicingAliases = (tonal: TonalModule): number => {
  const registry = tonal.voicingRegistry;
  if (!registry || typeof registry !== 'object') return 0;

  let addedTotal = 0;
  for (const dictName of Object.keys(registry)) {
    const entry = registry[dictName];
    if (!entry || typeof entry !== 'object') continue;
    const dict = entry.dictionary;
    if (!dict || typeof dict !== 'object') continue;
    for (const [sink, source] of CHORD_ALIAS_PAIRS) {
      if (aliasIntoDictionary(dict, sink, source)) addedTotal += 1;
    }
  }
  return addedTotal;
};
