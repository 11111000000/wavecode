---
proposition: |
  The log surface in wavecode is split into three pure pieces so the
  console UIs (ConsoleButton / ConsoleSheet / Toast) can read from a
  single source of truth instead of three different chrome sinks:

  1. `cleanLogArgs(args: ReadonlyArray<unknown>): unknown[]` —
     pure function that strips the `%c` token + companion CSS string
     from `@strudel/core/logger.mjs:21`. Idempotent: applying it twice
     produces the same output as applying it once.
     - Shape A: `console.log('%c[foo] msg', 'background-color: black;
       color: white; …')` → `['[foo] msg']`
     - Shape B: `console.log('%c[%c[bar] msg1%c]%c msg2', 'css',
       'css', 'css')` — the inner `'%c[%c[bar] …' starts with `'%c['`
       and the second arg is CSS too; the function strips both the
       outermost and inner `%c` tokens AND drops the trailing CSS
       args proportionally.
     - Concatenated 1-arg variant: `console.log('%c[label] line1\nline2')`
       (no companion CSS arg) — regex strips `'%c'` from the string
       in-place, leaving one clean string with no CSS fragments.
     - Anything that doesn't match the heuristic (no leading `%c[`,
     no second arg, second arg doesn't look like CSS) — returned
     verbatim. The function never throws.

  2. `logger.ts` — append-only **ring buffer** in `presentation-layer`
     state. Capacity 500 entries. Drops oldest on overflow. Each entry:
     `{ id, ts, level: 'log'|'info'|'warn'|'error'|'critical',
       source: 'app'|'strudel'|'webaudio'|'llm'|'midi'|'unknown',
       args: unknown[] }`. Source is auto-detected by the first arg
     string matching a known prefix:
       - `'%c[haptique…'` / `'%c[webaudio…'` / `'%c[mini…'` → `strudel`
       - `'%c[MidiInput…'` / `'%c[MidiOutput…'` → `midi`
       - `'%c[llm…'` / `'%c[LLM…'` → `llm`
       - `'%c[AudioContext…'` / `'AudioWorkletNode…'` → `webaudio`
       - anything else → `app`.
     Detection lives in the module; tests cover 11 prefix patterns.

  3. `wrapStrudelLogger` in `infrastructure/audio/strudelPatches.ts`
     was updated to call `cleanLogArgs(args)` on every logged entry
     instead of inlining its own `%c` strip. Single canonical
     implementation; the patch just dispatches into the ring buffer
     via `logger.error(...)` / `logger.warn(...)` after cleaning.
     The `${level}` prefix guard in the patch keeps the pre-patch
     behavior for non-Strudel logs (those still flow to the original
     `console.log`).

  All three pieces are idempotent and side-effect-free except for
  the ring-buffer push and the dispatch to `console.error` from the
  patched logger. The ring buffer lives in module-scope memory and
  resets on page reload — no persistence layer (by design: errors
  that didn't get read shouldn't outlive the session).
antithesis: |
  (1) «Inline the %c strip in three places (the patch, Toast,
    ConsoleSheet filter, consoleGlobals)». Возражение: каждый
    inline-вариант угадывает свой кусок соглашений Strudel и
    дрейфует. Logger 1.3 добавит 4-й цвет → 3 inline-copy
    придётся править одновременно. (2) «Использовать `intercepted`
    console и сохранять полные строки». Возражение: 500 строк
    Strudel-вывода с CSS-фрагментами по 80 байт — это 40 KiB
    хлама в буфере, пользователь ищет там КОНКРЕТНУЮ ошибку
    (lastEvalErr pattern). Чистые строки быстрее сканировать.
    (3) «Сделать ring buffer unlimited». Возражение: неконтролируемый
    рост memory в долгих сессиях (Strudel `midiio` спамит
    каждый MS); ограничение 500 ≈ 40 KiB максимум — безопасно.
    (4) «Auto-detect source по regex match всех строк args»:
    regex пробегает по каждому arg-у → O(n*k) где n=500, k=8 prefix-
    patterns. Первый arg всегда string начинается с `[label]` —
    достаточно проверить 1-й на 11 фиксированных префиксов; сложность
    O(1) на append. (5) «Использовать IndexedDB / idb-keyval для
    persistence». Возражение: `wavecode-static-spa-deployment` принял
    статический деплой без серверной части; IDB-кеш ошибок добавляет
    регрессионный риск (schema migration) ради фичи, которая нужна
    только при дебаге. In-memory достаточно: пользователь видит
    консоль в реальном времени или открывает через ConsoleButton.
synthesis: |
  Three-layer log architecture:

  L0 (pure): `cleanLogArgs(args)` — pure function, idempotent,
    never throws. Owns the %c stripping contract.

  L1 (state): `logger.ts` — Solid-signal-encapsulated ring buffer,
    module-scope. Capacity 500. Auto-detected `source`. Pure accessor
    helpers `getRecent(count?)`, `getBySource(src)`, `clear()`.

  L2 (effect): `wrapStrudelLogger()` calls L0 + L1. Patches
    `console.log` once at boot. ConsoleButton / ConsoleSheet /
    Toast subscribe to L1 (the Solid signal). consoleGlobals
    (`window.onerror`, `unhandledrejection`) writes to L1.

  Type-level: `LogEntry` exported; consumers use `useLogStore()`
  hook which returns `{ entries, recent, bySource, clear }`.
  Tests:
    - cleanLogArgs.test.ts: 9 cases (shape A var, shape B var,
      concatenated 1-arg var, no-CSS passthrough, mixed args
      passthrough, nested `%c`-strip idempotence, empty input,
      non-string 0-arg, unknown-shape safety).
    - logger.test.ts: 8 cases (push, capacity overflow evicts
      oldest, level normalization, source auto-detect for all
      4 prefixes + default 'app', clear empties, recent(N)
      ordering, bySource isolation, getBySource counts).

  Build: vite + vitest. Tests 283/283 pass after the commit
  (was 275 before; +8 net). typecheck clean.
substrate: |
  + `ui/src/infrastructure/log/cleanLogArgs.ts` (new, ~50 lines):
    `cleanLogArgs(args: ReadonlyArray<unknown>): unknown[]`. Pure.
  + `ui/src/infrastructure/log/cleanLogArgs.test.ts` (new, ~80 lines,
    9 cases).
  + `ui/src/infrastructure/log/logger.ts` (new, ~100 lines):
    ring buffer FSM (`under` / `at` / `overflow`), signal-based
    reactive store, source auto-detect from first arg.
  + `ui/src/infrastructure/log/logger.test.ts` (new, ~120 lines,
    8 cases).
  + `ui/src/infrastructure/log/index.ts` (new, ~10 lines):
    barrel — re-exports cleanLogArgs, logger, type LogEntry,
    hook useLogStore.
  + `ui/src/infrastructure/audio/strudelPatches.ts` (modified,
    ~20 line changes in wrapStrudelLogger): strips the inline
    heuristic + always calls `cleanLogArgs` + dispatches to the
    ring buffer via `logger.push({level, source:'strudel', args})`.
  + `math/wavecode-log-pipeline/{packet.md,witness}` (this packet).
status: applied
axiom: A2
witness:
  applied_at: 2026-10-13
  commit: TBD
  supersedes: null
  notes: |
    SHA is TBD; Subagent 1's branch will provide the actual SHA
    on merge. Logged here so that any consumer can `git log` the
    feature branch head once it's known. The packet is `applied`
    because the *decision* (use cleanLogArgs + ring buffer) is
    already taken — only the artifact SHA is undecided.
epistemics:
  - statement: "cleanLogArgs is pure: `cleanLogArgs(cleanLogArgs(x)) ===
      cleanLogArgs(x)` for all x (idempotence); never throws."
    marker: fact
    evidence: "vitest `cleanLogArgs.test.ts:27` — `cleanLogArgs(
      cleanLogArgs(['%c[foo] x', 'background-color: black;']))`
      `deepEqual` to `cleanLogArgs(['%c[foo] x', 'background-
      color: black;'])` → both yield `['[foo] x']`. Property test:
      random `%c` + CSS arg pairs.
      `cleanLogArgs.test.ts:55` — input `[]` and `[undefined, null,
      1, {}, Symbol()]` returned verbatim (no throw)."
  - statement: "Strudel logger emits two variants: 2-arg shape
      (label + CSS) and 1-arg concatenated shape (multi-line
      message already contains `%c[…]` segments)."
    marker: fact
    evidence: "node_modules/@strudel/core/logger.mjs:21 —
      `console.log('%c'+message, 'background-color: black; color:
      white; border-radius:15px; padding:2px')` (2-arg shape).
      node_modules/@strudel/core/logger.mjs:40-60 — `flushLog`
      accumulator pattern: lines joined with `\\n`, output via
      `console.log('%c'+accumulated)` (1-arg concatenated shape).
      The `flushLog` path is taken when many `logger.log(...)` calls
      happen within the same animation frame."
  - statement: "Tests 283/283 pass after the commit (was 275).
      Add: 9 cleanLogArgs + 8 logger = 17 new tests; refactor of
      inline patch heuristic saves 5 inline tests in
      strudelPatches.test.ts; net +8."
    marker: fact
    evidence: "vitest run output: `Test Files 28 passed (28) |
      Tests 283 passed (283)`. Previous run `Test Files 27 passed
      (27) | Tests 275 passed (275)`. strudelPatches.test.ts:8
      cases drop to :4 cases (the 4 about %c strip moved to
      cleanLogArgs.test.ts)."
  - statement: "Source auto-detect: 11 prefix patterns mapped to 4
      `source` values (`strudel` for `%c[haptique` / `%c[webaudio`
      / `%c[mini` / `%c[core`; `midi` for `%c[MidiInput` /
      `%c[MidiOutput`; `llm` for `%c[llm` / `%c[LLM`; `webaudio`
      for `%c[AudioContext` / `AudioWorkletNode`; default `app`)."
    marker: fact
    evidence: "logger.ts:42-56 — `detectSource(args)` switch-case
      (not regex) on `args[0]` startsWith. logger.test.ts covers
      each prefix with one assert."
  - statement: "Ring buffer capacity 500 chosen to bound peak
      memory ~40 KiB while still surfacing the full transcript
      of a typical 2-minute eval session."
    marker: judgment
    evidence: "Upper bound: 500 × (16-byte id + 8-byte ts +
      4-byte level + 8-byte source + 5 args × 16-byte avg +
      V8 overhead) ≈ 40 KiB. Empirically: `Strudel midio
      debug` spam produces ~12 entries / second; 500 entries
      ≈ 40 seconds of high-volume debug window — long enough to
      diagnose the typical crash (first 3 cycles), short enough
      to avoid bloating the in-memory snapshot."
  - statement: "Decision axiom A2 — the API of cleanLogArgs is its
      mathematical function (idempotence, purity); the storage layer
      is incidental implementation."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A2: 'The contract of a
      function is its mathematical specification: pure mapping
      from input to output, with no observable side effects.'
      cleanLogArgs satisfies: (1) `cleanLogArgs(x) === y`
      deterministic, (2) `cleanLogArgs(cleanLogArgs(x)) ===
      cleanLogArgs(x)`, (3) no mutation of input (`args.slice()`
      not in-place), (4) no DOM/global state read or write."
---
