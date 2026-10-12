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
 * 3. applyBankAliasFallback — `s("drums")` (no `:sound` suffix) looks up
 *    `soundMap["drums"]`, which is the BANK NAME not an individual sound.
 *    superdough has no fallback for bare bank names and throws
 *    `sound drums not found! Is it loaded?` in
 *    `superdough/superdough.mjs:572`. The SampleLoader registers
 *    `drums_bd`, `drums_sd`, etc. as keys but NOT a bare `drums` alias.
 *    LLM-generated scores frequently hallucinate `s("drums")` as a generic
 *    drum sound; the missing alias then produces the `[getTrigger]` error
 *    per cycle, ~every 200 ms.
 *
 *    Fix: after each bank's `samples()` resolves, register `drums` →
 *    `drums_bd`, `piano` → `piano_a4`, `synth` → `synth_bass-c2`. The
 *    fallback sound is the most common one in each bank so the user hears
 *    something instead of silence + a scheduler error every cycle.
 *
 *    Integration: apply at the end of `SampleLoader.registerBank()`.
 *
 * All patches are idempotent — safe to call more than once.
 */

const STRUDEU_CSS_HEURISTIC = /background-color:|color:\s*white|border-radius/;

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
      && typeof args[1] === 'string'
      && STRUDEU_CSS_HEURISTIC.test(args[1])
    ) {
      const cleaned = args[0].replace(/%c/g, '');
      const rest = args.slice(2);
      console.error.call(console, cleaned, ...rest);
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

type SoundEntry = { onTrigger: unknown; data: unknown };
type SoundMapSnapshot = Record<string, SoundEntry>;

export type WebaudioModule = {
  soundMap?: { get(): SoundMapSnapshot; set(value: SoundMapSnapshot): void };
};

/**
 * Default fallbacks for bare bank-name lookups. Keys are bank names as they
 * appear in user code (`s("drums")` without a colon), values are
 * specific sounds known to exist once `SampleLoader` has run.
 *
 * `drum` (singular) included because many LLM outputs use the singular.
 */
export const DEFAULT_BANK_FALLBACKS: Readonly<Record<string, string>> = {
  drums: 'drums_bd',
  drum: 'drums_bd',
  piano: 'piano_a4',
  synth: 'synth_bass-c2',
};

/**
 * After sample banks have loaded, register bare bank-name aliases pointing
 * to a default sound from each bank. Idempotent: re-running with the same
 * soundMap state is a no-op.
 *
 * Caller must pass the loaded module's namespace. Returns the names of
 * aliases added (for logging).
 */
export const applyBankAliasFallback = (
  webaudio: WebaudioModule,
  fallbacks: Readonly<Record<string, string>> = DEFAULT_BANK_FALLBACKS,
): string[] => {
  const soundMap = webaudio.soundMap;
  if (!soundMap) return [];

  const dict = soundMap.get();
  const updates: SoundMapSnapshot = {};
  const added: string[] = [];
  for (const bank of Object.keys(fallbacks)) {
    if (dict[bank] !== undefined) continue;
    const fallback = fallbacks[bank];
    if (typeof fallback !== 'string') continue;
    const entry = dict[fallback];
    if (entry === undefined) continue;
    updates[bank] = entry;
    added.push(bank);
  }
  if (added.length > 0) {
    soundMap.set({ ...dict, ...updates });
  }
  return added;
};
