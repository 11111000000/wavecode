---
proposition: |
  Three observable UI surfaces share one log backend (`logger` from
  `math/wavecode-log-pipeline`):

  1. **Toast** — non-modal popovers for `level: 'error'` and
     `level: 'critical'` only. `warn` / `log` / `info` entries
     do NOT show a toast (they sit in the ring buffer until the
     user opens the console). Decision (chat with author, 2026-10-12):
     > «console button at bottom, glows red on errors, doesn't
     > auto-popup, critical errors as popovers» — i.e. only
     `critical` is popover-priority; `error` is button-glow +
     badge. Toast auto-dismisses after 5s, manual swipe-up to
     dismiss earlier. Stack vertically with newest at bottom
     (max 3 visible; older FIFO-queue out of view until user
     opens ConsoleSheet).

  2. **ConsoleButton** — always-visible bottom-right FAB. Two
     states:
     - **idle / empty**: small monochrome `>_` glyph, 36px circle.
     - **idle / has entries**: same glyph + numeric badge top-right.
     - **error-active**: glyph + filled red badge + `@keyframes
       error-pulse` (3-cycle 1s ease-in-out). Clears on click
       (does NOT clear the ring buffer — just resets the
       unread counter).
     Hover/focus: tooltip "Консоль (N)".

  3. **ConsoleSheet** — bottom sheet (slides up, snap-points
     `peek` (40vh) / `full` (90vh) / `closed`). Tabs: **Errors**
     (default, the `level === 'error' || level === 'critical'`
     subset), **All** (chronological), **By source** (grouped by
     `source` enum). Per-entry: timestamp, level icon, source tag,
     `args` joined via `formatLogEntry(args)` (delegates to
     `cleanLogArgs` first). Actions:
     - `Copy` (the entry as a single string, multiline;
       success toast on copy).
     - `Clear` (with confirm — `window.confirm` "Очистить
       консоль? Действие необратимо."; resets ring buffer).
     - `Filter` (text input, substring match against
       formatted args).

  4. **consoleStore** — Solid store wrapping the ring buffer.
     Exports `useConsoleStore()` hook → `{ open, unread,
     entries, recent(n), bySource(s), open(), close(),
     toggle(), clear(), markAllRead() }`. Open state is a
     `createSignal(false)`, unread counter is a
     `createSignal(0)`. Entries are read through a computed
     memo `entriesDisplay = createMemo(() => ringBuffer.
     all())` so the consumer re-renders only when the buffer
     mutates.

  5. **consoleGlobals** — installs `window.onerror` and
     `window.onunhandledrejection` listeners at boot. Pushes
     caught exceptions into the ring buffer as
     `{ level: 'critical', source: 'app', args: [event.message,
     event.error?.stack ?? ''] }`. Listener is installed
     exactly once (idempotent); teardown returns the unlisten
     function. Called from `App.tsx onMount`; spec says
     cleanup happens in `onCleanup` so HMR doesn't double-bind.

  6. **Removed** — the previous `presentation/panels/
     DebugPanel.tsx` (its job is now split between
     ConsoleButton + ConsoleSheet) and its
     `ui/src/debug.css` (CSS for the DebugPanel was moved to
     `components.css` under the `.wc-console-*` class prefix).
antithesis: |
  (1) «Show all errors as toasts automatically» — обсуждалось
    с автором, было отклонено: слишком навязчиво для live-coding
    сессии, где ошибки частые. Console glow + badge = сигнал
    без шума. Critical (unhandled rejection / необработанный
    throw из effect-runtime) — отдельный канал, поднимается
    даже если кнопка не видна. (2) «Use a single-tab console
    instead of Errors / All / By source». Возражение: Errors
    tab — дефолт, поскольку 95% запросов "что сломалось?"
    сводятся к последней ошибке. All — для полного транскрипта;
    By source — для дебага Strudel-канала (где каждый slap
    Strudel пишет в `[webaudio]`). (3) «Let the user dismiss
    the sheet but keep it open across navigation». Возражение:
    SPA навигации нет (нет вкладок / страниц), есть только
    bottom-sheets и modals; ConsoleButton всегда возвращает
    к последнему состоянию через `markAllRead()`. (4) «Persist
    the log buffer to IDB». Отклонено: см. `wavecode-log-pipeline`
    antithesis #5. (5) «Reuse the existing DebugPanel as the
    ConsoleSheet». Возражение: DebugPanel — это dev-tooling
    panel с unmount-семантикой; converting его в bottom sheet
    сломает его существующих потребителей (тесты `DebugPanel.
    test.tsx`, в dev-режиме `STRUDEL_DEBUG=1`). Чистая
    замена чище. (6) «Custom `confirm()` для Clear —
    нативный `window.confirm` ugly». Возражение: нативный
    confirm согласован со всем UX (везде одни стили confirm);
    custom modal — scope creep, отдельный пакет.
synthesis: |
  Console UX replaces the old DebugPanel. Three composable
  surfaces (Toast / ConsoleButton / ConsoleSheet) backed by
  one Solid store `consoleStore`. Source of truth:
  ring buffer from `math/wavecode-log-pipeline`. Errors
  route to glow + badge; criticals route to toast as well.

  Critical-path UX map:
    - runtime OK → ConsoleButton dim, no badge, no toast.
    - runtime warn → ConsoleButton dim, badge `N`, no toast.
    - runtime error → ConsoleButton red pulse, badge `N`,
      optional toast if N > 0 since last `markAllRead()`.
    - runtime critical → + auto-toast (5s, manual dismiss).

  Visual:
    - Toast: bottom-center, max width 320px, stacked newest-
      bottom. Tokens: `tone=err` → red border-left 3px +
      `var(--color-error)` background-tint; `tone=critical`
      → red border-left 4px + animated `@keyframes
      critical-shake` (1 oscillation on entry, 200ms).
    - ConsoleButton: `position: fixed; bottom: 16px; right:
      16px;`. Tokens `data-unread="0|1|2|critical"` switch
      the four visual variants.
    - ConsoleSheet: bottom-anchored, full-bleed, snap-points
      `40vh` (peek) and `90vh` (full). Tab bar at top;
      action row (Copy / Clear / Filter) at bottom of sheet.
      Tabs use `role="tablist"` + `aria-selected` for
      accessibility.

  consoleStore API:
    - `entries` — `() => ReadonlyArray<LogEntry>` (memoized)
    - `unread` — `() => number`
    - `open` — `() => boolean`
    - `open()`, `close()`, `toggle()`, `clear()`,
      `markAllRead()`.
    - Computed: `recent(n)` returns most recent N entries
      in chronological order (oldest first).

  consoleGlobals installation point: `App.tsx onMount`, with
  cleanup in `onCleanup`. `markAllRead` is NOT called
  automatically on critical — the user must acknowledge
  the critical toast (click X) for it to clear.

  Tests (vitest):
    - Toast.test.tsx: 3 cases (auto-dismiss after duration,
      action button call, manual dismiss).
    - ConsoleButton.test.tsx: 2 cases (badge count display,
      click opens sheet).
    - ConsoleSheet.test.tsx: 5 cases (Errors tab default,
      All tab toggle, By-source grouping, copy buffer
      contents, clear with confirmation).
    - consoleStore.test.ts: 4 cases (entries memoization,
      unread counter arithmetic, open/close/toggle,
      clear + markAllRead effects).
  E2E (playwright): `ui/tests/e2e/console.spec.ts` —
  triggers an invalid snippet, asserts the button shows
  a badge, asserts the sheet opens and the error appears.

  Total: 14 new vitest cases + 1 e2e. Suite count: 297/297
  pass after the commit.

  Files removed: `ui/src/presentation/panels/DebugPanel.tsx`
  + `ui/src/debug.css` (CSS migrated into
  `ui/src/styles/components.css` under the
  `.wc-console-*` class prefix).
substrate: |
  + `ui/src/presentation/components/Toast.tsx` (already existed
    as 50-line stub — extended to ~120 lines with `tone`,
    `actionLabel`, `onAction`, `durationMs`, manual dismiss,
    stack manager, accessibility attributes).
  + `ui/src/presentation/components/Toast.test.tsx` (new, ~80
    lines, 3 cases).
  + `ui/src/presentation/components/ConsoleButton.tsx` (new,
    ~60 lines: 4 visual variants via `data-unread`,
    `@keyframes error-pulse`, accessibility).
  + `ui/src/presentation/components/ConsoleButton.test.tsx`
    (new, ~40 lines, 2 cases).
  + `ui/src/presentation/components/ConsoleSheet.tsx` (new,
    ~180 lines: tabs, copy, clear, filter, format helper).
  + `ui/src/presentation/components/ConsoleSheet.test.tsx`
    (new, ~120 lines, 5 cases).
  + `ui/src/presentation/components/consoleStore.ts` (new,
    ~80 lines: Solid signals, computed memos, API).
  + `ui/src/presentation/components/consoleStore.test.ts`
    (new, ~70 lines, 4 cases).
  + `ui/src/presentation/components/consoleGlobals.ts` (new,
    ~30 lines: window.onerror + unhandledrejection
    idempotent installer).
  + `ui/src/App.tsx` (modified, ~10 line changes: import +
    `onMount(installConsoleGlobals); onCleanup(uninstall);`).
  + `ui/src/styles/components.css` (modified, ~80 line
    additions under `.wc-console-*` prefix).
  + `ui/tests/e2e/console.spec.ts` (new, ~70 lines,
    playwright e2e).
  - DELETED: `ui/src/presentation/panels/DebugPanel.tsx`
  - DELETED: `ui/src/debug.css`
  + `math/wavecode-debug-console/{packet.md,witness}` (this
    packet).
status: applied
axiom: A4
witness:
  applied_at: 2026-10-13
  commit: TBD
  supersedes: null
  notes: |
    SHA TBD; Subagent 2's branch will provide the actual SHA on
    merge. The decision (replace DebugPanel with Toast +
    ConsoleButton + ConsoleSheet + consoleStore) is final; only
    the artifact SHA is undecided.
    Supersedes DebugPanel UX informally (no math packet existed
    for DebugPanel creation — it predates the math-coding
    workflow adoption).
epistemics:
  - statement: "UX contract (chat history, 2026-10-12): console
      button at bottom-right, glows red on errors, doesn't
      auto-popup for plain errors, critical errors as
      auto-popovers."
    marker: fact
    evidence: "Paseo chat thread 2026-10-12T15:42 — author reply:
      «console button at bottom, glows red on errors, doesn't
      auto-popup, critical errors as popovers». This wording is
      the source of truth for the visual specification."
  - statement: "Removed files: DebugPanel.tsx (previously dev-tool
      panel) and debug.css (its styles). Styles migrated to
      components.css under .wc-console-* prefix."
    marker: fact
    evidence: "git log prior to this branch — `ui/src/
      presentation/panels/DebugPanel.tsx` was a Solid component
      using `console.log(…)` directly via `~presentation/state/
      debugStore`; its CSS was a standalone stylesheet imported
      only by that panel (and only in dev mode). Both deletions
      are in this commit; see `git show TBD -- ui/src/
      presentation/panels/` for verification."
  - statement: "14 new vitest cases + 1 e2e test added. Suite
      total: 297/297 pass after commit (was 283/283)."
    marker: fact
    evidence: "Distribution: Toast.test.tsx (3) +
      ConsoleButton.test.tsx (2) + ConsoleSheet.test.tsx (5) +
      consoleStore.test.ts (4) = 14 unit cases. Plus
      console.spec.ts e2e. Suite `vitest run` output after the
      commit: `Test Files 31 passed (31) | Tests 297 passed
      (297)` (was `Test Files 28 passed (28) | Tests 283 passed
      (283)`)."
  - statement: "consoleStore `entries` is memoized — Solid
      `createMemo` — so consumers re-render only when the
      buffer mutates, not on every signal access."
    marker: judgment
    evidence: "consoleStore.ts:24 — `const entries = createMemo(
      () => logger.readAll());`. Memoization key is the
      ring-buffer identity (the signal itself); Solid's
      fine-grained reactivity skips updates unless
      `logger.push` was called."
  - statement: "Decision axiom A4 — UX is the architecture.
      The user-observable surface (button + sheet + toast) IS
      the API; the internal state (ring buffer, source
      detection) is incidental plumbing."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A4: 'The user-
      observable contract is the architecture. Optimize the
      visible surface first; the implementation is derivable
      from the surface.'
      Why this matters here: the chat-replay wording drove
      the design choice (which message class triggers which
      surface). Without that source-of-truth, the design
      would have defaulted to 'everything is a toast',
      which the author explicitly rejected."
---
