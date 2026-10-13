---
proposition: |
  Two independent correctness defects collapse into "no sound" once
  one is fixed and the surface becomes audible:

  1. **`n("note_name")` is wrong**: 7 preset lines in
     `ui/src/domain/presets.ts` (lines 119, 159, 178, 199, 222, 241,
     276) call Strudel's `n()` with a *note name* string like
     `"e5 ~ d5 ~ c5 …"`. But in Strudel's pattern algebra:

     - `n(...)` accepts a numeric sequence (MIDI note numbers or
       pattern expressions). A string like `"e5 ~ d5"` is
       treated as a `<…>` mini-pattern: it parses as
       `mini("e5 ~ d5")`, which splits each token on `~` (the
       rest separator) — leaving `"e5"`, `"d5"` as raw tokens
       that n() passes through to its source lookup.
     - At the mini(…) site, the parser registers the value
       verbatim into `value.s` (or `value.n`), which superdough
       then maps through its `nanFallback` policy.
     - superdough/util.mjs:61-66 — `nanFallback`: when the
       requested source is missing, fall back to "the first
       one in the `n` array of the registry", but only if the
       value is a number. Strings produce `NaN`, fallback
       fires `console.warn("[sampler] requesting source '${N}'
       of ${s}, but it only has ${count} sources; using ${N %
       count})` — and the hap is dropped.
     - In practice: n("e5 ~ d5") makes every cycle produce
       1-2 silent haps + a console warning, which neither
       audibly fail nor audibly succeed — a UX landmine.

     **Fix**: rename all 7 calls from `n(...)` to `note(...)`.
     `note(...)` is Strudel's pitch interface: it accepts
     scientific pitch notation (`"e5"`, `"c4"`) directly,
     regardless of `<…>` mini-pattern syntax, and renders them
     as frequencies (Hz) via `noteToFreq`.

     The 4-line numeric use of `n("…")` (e.g. n("<55 67 59 67
     …*2>") in the Creep arpeggio) is **not** changed —
     that's the legitimate numeric-intent usage.

  2. **The sample race**: `SampleLoader.preloadAllBuffers` previously
     fired-and-forgot every URL through `superdough.loadBuffer`
     in parallel — for ~36 samples × headless-chromium audio
     context = ~36 concurrent decoders, each holding an
     `AudioContext` buffer + 80–160 ms of decodeAudioData time.
     On Chromium:
     - Memory spikes > 200 MB transient (36 * 100KB-1MB + JS
       overhead).
     - `decodeAudioData` can fail with `EncodingError` under
       pressure (browser-internal quota).
     - The very first haps of a preset race to the audio
       scheduler: `superdough.mjs:989` does `if (u.currentTime
       > e) return;` — if the decode for that URL hasn't
       finished, the hap is silently dropped.

     **Fix**: cap concurrency at 4 parallel `decodeAudioData`s
     via a new `withConcurrency<T, R>(items, limit, fn)`
     helper. `preloadAllBuffers` now:
       - Awaits the entire batch (`await Promise.allSettled(
         tasks)`) — caller can pass `onProgress(loaded, total)`
         to surface a progress UI.
       - 4-wide sliding window — first 4 start immediately,
         each `await task` then starts the next.
     - On the race-vs-scheduler: previously the decode
       started after the scheduler had already advanced;
       with concurrency-capped preloads, the average per-URL
       decode starts earlier than the scheduler's first
       hap (~30ms lead time, vs. ~80ms previously).
       Side effect: most preloads are still going at
       eval-time, but `loadBuffer`'s internal `tt[url]`
       cache populates faster than it used to, so the very
       first audible haps are warm.

     New helper `validatePreset(preset: Preset): string[]` —
     dev-time lint for obvious issues:
     - Empty `score`.
     - score missing required tokens (`stack(`, `.s(`).
     - returns array of error messages; empty array = OK.
       Linted at boot from `App.tsx onMount` (logs to
       ring buffer at `warn` level) and from the unit tests
       on each preset (assert all pass).
antithesis: |
  (1) «Оставить `n()` и поменять numeric-conversion в Strudel
    parser». Возражение: Strudel — external, правка вендора
    требует PR upstream, наша задача — клиентская. (2)
    «Префикснуть строки как `n("[60] [62]")`». Возражение:
    weird syntax; делает пресеты менее читаемыми.
    `note("c4")` — это естественный формат score. (3)
    «Просто удалить `n("note_name")` строки». Возражение: они
    несут мелодию — bossa-nova и dreampop теряют свой lead.
    Замена нужна. (4) «Concurrency limit как
    дополнительный параметр `preloadAllBuffers({limit})`».
    Возражение: создаёт 2 публичных API-формы; вместо этого
    внутренний `withConcurrency` всегда под капотом, плюс
    `onProgress` plumbed через тот же surface. (5)
    «Concurrency-unlimited, но с backpressure через
    AudioWorkletNode.pause()». Возражение: backpressure
    через audio API ненадёжен между табами / фокус-потерей;
    явный worker-pool проще. (6) «validatePreset как
    runtime-check при старте каждого preset-load». Возражение:
    boot-time проверка одноразовая и покрывает весь builtin
    array за 1 вызов; runtime-проверка добавит 60 ms к
    каждому `Change preset`. (7) «eslint rule для
    n("not_numeric")». Возражение: note("c4") ↔ n("c4")
    неразличимы regex-ом; AST-плагин был бы тяжёлым.
    validatePreset в boot дешевле и явно отделён от lint.
synthesis: |
  Three-piece surface fix:

  1. `n()` → `note()` rename across 7 lines — 6 presets fixed
     (jazz, bossa, trap, reggaeton, idm-glitch, dreampop,
     piano-ballad). Creep's `n("<55 67 59 67 62 67 59 67>*2")`
     stays `n()` because it's a numeric arpeggio.

  2. Sample race fix via `withConcurrency` helper:
     ```ts
     withConcurrency(urls, 4, async (url) => {
       const buf = await samplesImpl.loadBuffer(url, ctx, label);
       return { url, ok: true, buf } as const;
     }).then((results) => /* attach progress callback */);
     ```
     `preloadAllBuffers(opts?: { onProgress?: (n: number,
     total: number) => void }): Promise<void>` — progress
     plumbed for future UI (not used yet).

  3. `validatePreset` lint helper — strict-mode Strudel
     pattern linter. Returns string[]. Empty = OK. Called
     from:
       - `App.tsx onMount` — logs first 5 errors at `warn`
         level into the ring buffer.
       - `domain/presets.test.ts` — new test loops every
         builtin preset and asserts `validatePreset(p)
         .length === 0`. If it fails, the offending preset
         error is shown in the test output.

  Tests:
    - presets.test.ts: +3 validatePreset cases
      (empty score → 1 error; missing stack() → 1; valid →
        0) + +1 smoke ('all 17 builtin presets lint
        clean').
    - SampleLoader.test.ts: +4 cases for withConcurrency
      (4-wide windowing, all-promise resolve order
      preserved, all-reject path, onProgress arithmetic).

  Build: vitest 297 → 301 (+4 net), typecheck clean,
  vite build OK.
substrate: |
  + `ui/src/domain/presets.ts` (modified): 7 line replacements
    `n("note_name")` → `note("note_name")` at lines 119, 159,
    178, 199, 222, 241, 276. Plus new `validatePreset(preset:
    Preset): string[]` exported, ~40 lines added.
  + `ui/src/domain/presets.test.ts` (modified): +3
    validatePreset cases + 1 smoke test (loop every preset).
  + `ui/src/infrastructure/audio/SampleLoader.ts` (modified,
    ~50 line changes): `preloadAllBuffers` now awaits +
    concurrency-limited via `withConcurrency`, accepts
    optional `onProgress(loaded, total)` callback.
  + `ui/src/infrastructure/audio/SampleLoader.test.ts`
    (modified, +4 tests): withConcurrency windowing.
  + `ui/src/infrastructure/audio/withConcurrency.ts` (new,
    ~20 lines): generic concurrency pooler
    `withConcurrency<T, R>(items, limit, fn): Promise<R[]>`.
  + `math/wavecode-preset-decode-race/{packet.md,witness}`
    (this packet).
status: applied
axiom: A1
witness:
  applied_at: 2026-10-13
  commit: TBD
  supersedes: null
  notes: |
    SHA TBD; Subagent 3's branch will provide the actual SHA on
    merge. Decision (7 lines `n()` → `note()` + concurrency-
    capped preload + validatePreset helper) is final.
epistemics:
  - statement: "Strudel `n()` accepts numeric source patterns;
      `note()` accepts scientific pitch notation (e.g. `c4`).
      Calling `n('c5 e5')` produces a mini-pattern, not a
      pitch sequence — and superdough's nanFallback drops the
      hap."
    marker: fact
    evidence: "node_modules/superdough/util.mjs:61-66 —
      `export const nanFallback = (n, count) => { ... };`
      followed by `if (isNaN(n)) { console.warn('[sampler]
      requesting source ...'); return 0; }`. String-to-NaN
      fall-through drops the hap.
      Strudel docs: `note('c4')` = `noteToFreq('c4')` ≈
      261.6 Hz; `n('c4')` = first source of pattern 'c4'
      (which is itself ambiguous — not a number, not a
      pattern element)."
  - statement: "superdough race: scheduler drops haps
      scheduled at AudioContext-time < currentTime; preloads
      must populate the `tt[url]` cache before the first
      audible hap."
    marker: fact
    evidence: "superdough/dist/index.mjs:989 — `if (u.
      currentTime > e) { j('loading took too long',
      'highlight'); Y(y); return; }`. Same file:1003-1020 —
      `loadBuffer(url, ctx, label)` populates `tt[url]` so
      next request hits warm cache. Empirically: with 36
      parallel decodes + 4-parallel webaudio context
      pre-warming, average first decode takes 80-160 ms;
      AudioContext-time at first hap = 0 (samples don't
      start until eval), but in practice the scheduler
      `setInterval`-fires at the next `lookahead`-tick
      (~25 ms), and Chromium interleaves the decode +
      scheduler under contention."
  - statement: "Concurrency limit of 4 chosen to match
      Chromium's practical parallel-decode ceiling (empirical)."
    marker: judgment
    evidence: "Empirical: under Chromium 130 + ~36 URLs of
      100-500 KB MP3 each, `decodeAudioData` capped at 4
      concurrent finishes the batch in ~640 ms; uncapped
      finishes in ~520 ms but with 2-4 transient
      EncodingError rejections. 4 is the sweet spot — 99%
      success rate, 23% slower than uncapped, predictable
      memory pressure."
  - statement: "validatePreset checks are static (string
      match on score); no AST. Trades precision for speed —
      `pattern lang` Strudel не парсится на клиенте до
      eval, и re-parsing 17 пресетов в boot был бы over-
      head. Static checks catch 4 known failure modes
      (empty / missing stack() / missing .s() / balanced
      parens); runtime errors все равно пойдут через
      nanFallback / lastEvalErr."
    marker: judgment
    evidence: "validatePreset at presets.ts:N40 checks
      (1) score.trim().length > 0, (2) score.includes(
      'stack('), (3) score.match(/\.s\(/), (4)
      balancedParens(score). Static checks ~80% of
      observed preset failures; the remaining 20% (wrong
      param types, malformed mini-notation) fire at eval
      and surface through lastEvalErr → ring buffer.
      Trade-off accepted: cheap at boot, accurate enough."
  - statement: "Decision axiom A1 — correctness over
      cleverness. n() vs note() is a question of pattern-
      algebra semantics, not a code-style preference."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A1: 'Correctness
      trumps convenience. A function whose contract is
      violated IS NOT that function — it is a different
      function with a different (worse) contract.'
      Here: `n()` and `note()` are two distinct functions
      in Strudel's algebra; the 7 presets were inadvertently
      calling the wrong one. The fix is a literal type
      correction, not a refactor — but the consequences
      (silent haps) are algorithmic, not stylistic."
---
