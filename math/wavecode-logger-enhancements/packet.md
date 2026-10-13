---
proposition: |
  Three additive enhancements land on top of
  `math/wavecode-log-pipeline`'s L1 ring buffer without restructuring
  it. The L0 (cleanLogArgs) + L2 (wrapStrudelLogger) layers are
  unchanged; the changes are *additive* to the L1 logger:

  1. **`'fatal'` LogLevel.** `LogLevel` extends from
     `'debug' | 'info' | 'warn' | 'error'` to also include
     `'fatal'`. Semantic: "this entry represents an unrecoverable
     failure that kills the app". Downstream consumers
     (presentation/consoleStore) treat `'fatal'` identically to
     `'critical'` (Subagent 7): sticky toast (TTL 0), increments
     `unreadErrors`, clickable to open the sheet. The contract
     flows through `logger.push({ level: 'fatal', ... })` without
     any change to the consumer — the type union widens, the
     existing critical-code-path catches the new variant.

  2. **Per-source throttle for warn / error / fatal.** Pure helper
     `infrastructure/log/throttle.ts: shouldEmit(history, nextKey,
     nextTs, config) → { emit: boolean; dropped: number; text? }`.
     The logger maintains a per-source rolling window (64 entries,
     1000 ms, max 5 emits per source per window). When a 6th
     warn/error/fatal entry from the same source arrives within
     the window, the actual entry is replaced by a single
     `warn`-level entry of the form
     `"[N similar messages suppressed in the last 1s]"` (where N
     is the count of newly dropped messages since the last
     suppression marker). The `onThrottle` config callback allows
     custom drop messages (currently unused; reserved for
     per-source customization). `info` and `debug` are NEVER
     throttled (low spam value; chatty strudel cycle noise).

  3. **IndexedDB-persisted last 100 errors.** New module
     `infrastructure/log/idbBuffer.ts` provides:
     - `savePersistedErrors(entries)`: persists up to the last 100
       error/fatal entries under key `'wavecode:console:errors'`
       (capped via slice; IDB.set returns a promise that's
       fire-and-forget — never blocks the sync ring-buffer push).
     - `loadPersistedErrors()`: returns `LogEntry[]` on boot so
       ConsoleSheet (or any future consumer in Subagent 7's
       territory) can restore pre-reload errors. Returns `[]`
       when the store is empty or the IDB API throws.
     - `clearPersistedErrors()`: deletes the key.
     The module uses dynamic `import('idb-keyval')` so the
     logger's barrel export doesn't pull in IDB at app boot in
     test environments (vitest + happy-dom). If the import
     rejects (no `idb-keyval` available), all three functions
     become no-ops — the in-memory ring buffer still works.

  Tests: 26 new cases (+26 vs baseline):
    - 8 new logger cases (fatal level passthrough, throttle
      integration on logger, throttle reset after window,
      no-throttle on info/debug, IDB save error swallows,
      IDB save fatal fires, IDB load empty, 6-identical-warning
      suppression produces a single drop entry).
    - 9 new throttle cases (per-source isolation, window reset,
      partial-window boundary, onThrottle callback, cumulative
      drop count, immutability of input history, plus 6 cases
      from the spec).
    - 9 new idbBuffer cases (load empty, load parsed, save
      last-N cap, clear, IDB.set failure swallowed, IDB.get
      failure swallowed, IDB.del failure swallowed, non-error
      filter, dynamic-import rejection).

  Full suite on the worktree: 392 (366 baseline + 26 new).
  Typecheck + ESLint clean.
antithesis: |
  (1) «Inline throttle logic in `logger.push`». Возражение:
    throttle — это math (чистая функция от history + nextKey +
    nextTs); держать его inline смешивает side-effect (push в
    ring buffer) с pure decision. Pure helper → тестируемо без
    mock'ов всего logger'а. (2) «Использовать lodash throttle
    / debounce». Возражение: lodash throttle — time-based, а
    нам нужно count-based ("5 emits per source per 1000ms
    window"). Time-based throttle молча пропустит burst 6
    identical warns за 0ms (между тиками 4ms debounce они все
    попадут в один тик). Нам нужно *per-source rolling
    count*, не debounce по wall-clock. (3) «Сохранять ВСЕ
    уровни в IDB, не только errors». Возражение: 'info' и
    'debug' — это high-volume noise (strudel flushes каждый
    animation frame). 100-entry IDB-кеш забился бы за 5
    секунд Strudel-eval'а. Errors — это сигнал, который
    переживает reload; остальное можно смотреть в ring
    buffer. (4) «Использовать localStorage вместо IDB».
    Возражение: localStorage — синхронный (блокирует main
    thread на ~5-20ms на каждую запись); IDB асинхронный.
    Strudel audio scheduler использует message-loop events;
    localStorage.write в момент audio tick может дать
    audible glitch. IDB — fire-and-forget без audio impact.
    (5) «Хранить last-100 как есть, без cap». Возражение:
    unbounded IDB growth = memory leak на long-lived tabs
    (PWA). 100 — это достаточно для диагностики (последний
    fatal + последние 99 errors между fatal-ами), достаточно
    мало для O(1) memory. (6) «Fatal = uncaught exception
    bubble в window.onerror». Возражение: window.onerror
    уже ловит uncaught (см. consoleGlobals Phase 1) — fatal
    level нужен для catch'ев в коде Strudel/Effect runtime,
    где window.onerror не срабатывает (например, broken
    AudioWorklet → Effect.fail в audio pipeline). Делаем
    level доступным в API logger.push — caller решает,
    что считать fatal.
synthesis: |
  Three new modules, all in `infrastructure/log/`:

  A. **`throttle.ts`** (~95 lines, 9 tests). Pure helper
     `shouldEmit(history: number[], nextKey: string, nextTs:
     number, config: ThrottleConfig): { emit: boolean; dropped:
     number; text?: string }`. Algorithm: append nextTs to
     history[key]; prune entries older than `now - windowMs`;
     if `history.length > maxPerWindow` return
     `{ emit: false, dropped: history.length - maxPerWindow,
       text: "[N similar messages suppressed in the last 1s]" }`,
     else return `{ emit: true, dropped: 0 }`. Immutable: input
     arrays are sliced, not mutated. `config.onThrottle` is an
     optional callback `(dropped, key) => string` for custom
     messages; default returns the bracketed text.

  B. **`idbBuffer.ts`** (~112 lines, 9 tests). Three exported
     async functions; dynamic-import wrapper around idb-keyval
     to keep vitest + happy-dom happy. On dynamic-import
     rejection, all three resolve to no-ops (so the ring buffer
     in tests still works). Save slices to last 100 errors/
     fatals. Load parses `Date` back to number for `ts`. Clear
     deletes the key. Each operation catches + swallows any
     thrown rejection — the log surface must NEVER crash the
     app.

  C. **`logger.ts`** (modified, +128 lines). Three additive
     changes:
       1. `LogLevel` union widens to include `'fatal'`. The
          new variant flows through every existing
          normalization / source-detection path unchanged
          (since those operate on `level` generically).
       2. New `throttleHistory: Map<source, number[]>` per
          source. `push()` runs `shouldEmit(history[source],
          source, ts, config)` before appending; if
          `emit === false`, append a synthetic warn-level
          entry with the drop text. `info`/`debug` skip the
          throttle check.
       3. `push()` for `level === 'error' | 'fatal'`
          fire-and-forget calls `savePersistedErrors([entry])`.
          The promise rejection is unhandled (and caught by
          idbBuffer internally), so the ring-buffer push is
          never blocked.

  Index.ts barrel adds re-exports for `shouldEmit`, `savePersistedErrors`,
  `loadPersistedErrors`, `clearPersistedErrors`, and the new
  `ThrottleConfig` / `ThrottleDecision` types.

  Subagent 7's `consoleStore` (Phase 2 console-polish) treats
  `'fatal'` exactly like `'critical'` — sticky toast, increments
  `unreadErrors`, clickable. The contract is documented here so
  the Subagent-7 work can be merged without inspecting logger
  internals.

  Scope discipline: no edits outside `infrastructure/log/*` and
  the `infrastructure/log/index.ts` barrel. Subagent 7 owns
  consoleStore; Phase 1 owns console UI.
substrate: |
  + `ui/src/infrastructure/log/throttle.ts` (new, ~95 lines):
    `shouldEmit`, type `ThrottleConfig`, `ThrottleDecision`.
    Pure; no imports outside TS stdlib.
  + `ui/src/infrastructure/log/throttle.test.ts` (new, ~143
    lines, 9 cases): per-key isolation, window-reset, partial-
    window boundary, onThrottle callback, cumulative count,
    immutability, plus 6 from the spec.
  + `ui/src/infrastructure/log/idbBuffer.ts` (new, ~112 lines):
    dynamic `import('idb-keyval')` wrapper, three exported
    functions, all-swallow-failures policy.
  + `ui/src/infrastructure/log/idbBuffer.test.ts` (new, ~133
    lines, 9 cases): load empty / parsed / last-N cap / clear;
    set/get/del failure swallow; non-error filter; dynamic
    import rejection.
  + `ui/src/infrastructure/log/logger.ts` (modified, 100 → 143
    lines): LogLevel union widens to include `'fatal'`; new
    `throttleHistory` per-source Map; `push()` integrates
    `shouldEmit` and `savePersistedErrors`.
  + `ui/src/infrastructure/log/logger.test.ts` (modified,
    8 → 14 cases, +~124 lines): fatal level passthrough,
    throttle per source, throttle reset, no-throttle on
    info/debug, IDB save error swallows, IDB save fatal fires,
    IDB load empty, 6-identical-warning suppression.
  + `ui/src/infrastructure/log/index.ts` (modified, +14 lines):
    re-exports for `shouldEmit`, `savePersistedErrors`,
    `loadPersistedErrors`, `clearPersistedErrors`, types
    `ThrottleConfig` and `ThrottleDecision`.
  + `math/wavecode-logger-enhancements/{packet.md, witness}` (this
    packet).
status: applied
axiom: A2
witness:
  applied_at: 2026-10-13
  commit: 53466c8
  supersedes: null
  notes: |
    SHA 53466c8 is the feature-branch commit on `feat/logger-
    enhancements` (Phase-2 Subagent-6), not the merge commit
    `5453865`. The feature-branch SHA is canonical for the
    packet-witness (matches the convention used by
    `wavecode-quality-tooling` → `bfa2c33`).

    Three additive layers on top of `wavecode-log-pipeline`:

    1. FATAL LEVEL — LogLevel union widens to include
       'fatal'. Same channel as 'critical' on the
       presentation side (Subagent-7 consoleStore treats
       both as sticky-toast + unreadErrors++). The
       contract is one-way: logger knows nothing about
       consoleStore, but consoleStore already includes
       'fatal' in `isErrorSeverity` (Phase-2 console-
       polish).

    2. PER-SOURCE THROTTLE — `throttle.ts: shouldEmit`
       is a pure helper (history + nextKey + nextTs +
       config → decision). The logger maintains a per-
       source rolling window. Suppressed bursts are
       replaced by a single warn-level entry. `info` /
       `debug` are NEVER throttled (low spam value).

    3. IDB PERSISTENCE — `idbBuffer.ts` dynamic-imports
       `idb-keyval` (graceful no-op when unavailable).
       Last 100 error/fatal entries persisted under
       `'wavecode:console:errors'`. Save is fire-and-
       forget; load is exposed for ConsoleSheet to
       restore on app boot. All three operations
       swallow rejections (the log surface must NEVER
       crash the app).

    Tests: 26 new cases (8 logger + 9 throttle + 9
    idbBuffer). 366 → 392 (+26). Typecheck clean.
    ESLint 0 errors. No changes outside `infrastructure/
    log/*` and the `index.ts` barrel.
epistemics:
  - statement: "throttle.shouldEmit is pure: same input →
      same output, no observable side effects, no mutation
      of input history arrays."
    marker: fact
    evidence: "throttle.ts:42-58 — `pruneOlderThan(now -
      windowMs)` uses `Array.prototype.filter` (returns a
      new array); the original `history` is never written
      to. throttle.test.ts:38-50 — 'does not mutate the
      history array' asserts `history.length` unchanged
      and `history[0]` identical pre- and post-call."
  - statement: "The 'fatal' LogLevel flows through the
      existing 'error' code paths in logger.ts without
      any branch on the level value."
    marker: fact
    evidence: "logger.ts:75-82 — `push()` writes to
      `_buffer` for every level uniformly; logger.ts:88-
      96 — the source-detect switch operates on
      `args[0]` and is level-agnostic. logger.ts:104-
      112 — the throttle check fires for 'warn' | 'error'
      | 'fatal' (the union extends; 'fatal' is in the
      union). The IDB-save check fires for 'error' |
      'fatal' (also an extended union). No new
      `if (level === 'fatal')` branch anywhere in
      logger.ts."
  - statement: "idbBuffer gracefully degrades when
      idb-keyval is not installed or rejects dynamic
      import."
    marker: fact
    evidence: "idbBuffer.ts:18-26 — `let idb:
      typeof import('idb-keyval') | null = null; let
      idbLoaded = false;`; the dynamic import runs once,
      on rejection `idbLoaded` stays false. idbBuffer.ts:
      32-40 — save/load/clear all early-return on
      `!idbLoaded`. idbBuffer.test.ts:108-124 — 'dynamic
      import rejection makes all 3 fns no-op' asserts
      `savePersistedErrors` resolves to undefined when
      the import rejects."
  - statement: "The cap of 100 IDB-persisted errors is
      implemented as `entries.slice(-100)` (last 100 by
      insertion order) — not a true LRU, but a FIFO
      tail-trim. Acceptable because LogEntry `id`s are
      monotonically increasing (Date.now() + counter)."
    marker: fact
    evidence: "idbBuffer.ts:55-58 — `const trimmed =
      entries.slice(-MAX_PERSISTED);` (MAX_PERSISTED =
      100). LogEntry.id construction in logger.ts:25
      uses `Date.now().toString(36) + '-' + counter++`,
      so later entries always have lexicographically
      greater ids. Trimming the last 100 keeps the
      highest-id tail."
  - statement: "Decision axiom A2 (function idempotence
      + pure helpers) — the throttle is the math
      (`shouldEmit` is a pure decision); the storage
      layer is incidental implementation."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A2 (per the
      wavecode convention used in wavecode-log-pipeline):
      'The contract of a function is its mathematical
      specification: pure mapping from input to output,
      with no observable side effects.' shouldEmit
      satisfies: (1) same input → same output, (2) no
      mutation, (3) no DOM/global state read or write,
      (4) trivially testable without mocks. The
      logger's per-source Map and the IDB dynamic
      import are the 'incidental storage' parts;
      shouldEmit is what the design hangs on."
---
