---
proposition: |
  Three additive polishes to the Phase-1 console UX
  (`math/wavecode-debug-console`) land without restructuring it:

  1. **`fatal` severity in `ToastSeverity`.** Subagent-6 adds `'fatal'`
     to `LogLevel` (`ui/src/infrastructure/log/logger.ts`).
     consoleStore treats `'fatal'` identically to `'critical'`:
     sticky TTL (0), increments `unreadErrors`, clickable to open
     the sheet. Contract added to `consoleStore.ts` so the
     `logger.push({ severity: 'fatal', ... })` flow lands in the
     toasts without Subagent-6 needing to touch consoleStore.

  2. **Color-blind severity icons in `Toast.tsx`.** Each toast now
     renders a leading SVG icon (`InfoIcon` / `WarnIcon` /
     `ErrorIcon` / `CriticalIcon`) inside the existing `.toast-icon`
     slot. Border color remains the primary visual cue, but the
     icon is a SECOND independent channel — `red-green color
     deficiency` users can now read severity by shape. Four new
     icons added to `icons/index.tsx`, following the existing
     `ConsoleIcon` / `PinIcon` pattern (16×16 viewBox, currentColor
     stroke + fill). CriticalIcon uses an octagon (international
     "stop / critical" shape); fatal reuses the same icon, since
     consoleStore treats them as one channel — only stickiness +
     color + icon distinguish them from the chromium cases.

  3. **`Cmd/Ctrl+`` hotkey for the console toggle.** New pure
     helper `consoleHotkey.ts: matchesHotkey(event, hotkey) →
     boolean` encodes the cross-platform "metaKey || ctrlKey"
     semantics in one place. `consoleGlobals.ts` registers a
     `keydown` listener that toggles `consoleStore.consoleOpen`
     when backtick is pressed with Cmd/Ctrl (no shift, no alt).
     Listener is suppressed when focus is in `INPUT`,
     `TEXTAREA`, or `contenteditable` so the hotkey doesn't
     interfere with typing inside CodeMirror or any input.
     Listener is also installed exactly once (idempotent via
     `state.installed`), and an `uninstallConsoleGlobals()`
     helper is exposed for tests / HMR. ConsoleButton's `title`
     attribute shows the platform-aware hint
     `"Console (Cmd+\`)"` (Mac) / `"Console (Ctrl+\`)"` (others)
     using the modern `navigator.userAgentData?.platform` with a
     graceful fallback to deprecated `navigator.platform`.

  Scope discipline (Phase-2 parallel work):
    - All edits stay inside the agent-7 surface (`consoleStore`,
      `Toast`, `ConsoleButton`, `consoleGlobals`, `icons/index`).
    - DO NOT touch `infrastructure/log/*` (Subagent-6), audio
      (Subagent-8), domain (Subagent-9), bootstrap (Phase-1
      shipped), or `package.json` (Subagent-10).
    - styles/components.css gets ONE additive block: new selectors
      for `.toast-item.toast-fatal` + `.toast-item.toast-fatal
      .toast-icon`. No existing class tweaked.

  Tests: 374/374 vitest pass (366 baseline + 6 hotkey + 2 toast =
  +8 net). Typecheck clean. ESLint: 0 errors / 14 pre-existing
  warnings (none from this work).
antithesis: |
  (1) «Auto-dismiss fatal after 30s like a long critical». Возражение:
    fatal = необработанный throw в effect-runtime; пользователь
    ДОЛЖЕН его увидеть, иначе теряется смысл severity. Sticky как у
    critical — единственный сигнал "это важно". (2) «Использовать
    эмодзи 🎉 / ⚡ / 🔥 для severity-иконок». Возражение: эмодзи
    плохо масштабируются (разный glyph на Win / Mac / Android),
    нарушают currentColor (тосты теряют severity-цвет), и не
    accessible (screen-reader читает имя emoji). SVG-иконки в том
    же visual language, что и ConsoleIcon/PinIcon. (3) «Вместо
    pure helper хранить HOTKEYS прямо в consoleGlobals». Возражение:
    тестируемость — `matchesHotkey(event, { key: 'd' })` это pure
    function, тестируемая без window; в consoleGlobals она бы
    смешивалась с DOM-listeners и editable-target check.
    (4) «Использовать `Cmd+K` / Ctrl+K вместо Cmd+` ` — это
    command-palette hotkey». Возражение: Cmd+K уже используется в
    browser native (focus URL bar в некоторых браузерах) и в
    GitHub-style command palettes; Cmd+` — DevTools-конвенция,
    не конфликтует с native. (5) «Hotkey должен работать ВСЕГДА,
    даже когда фокус в input». Возражение: пользователь печатает
    код в CodeMirror — backtick там — legal character
    (template literal); Cmd+` ` — там тоже легальный shortcut
    (toggle блок-code в MD редакторе). Подавлять в editable —
    самый предсказуемый дефолт; пользователь может закрыть
    console кликом по button. (6) «Tooltip показывает hotkey всегда,
    даже если не зарегистрирован». Возражение: tooltip == обещание;
    если в выключенном состоянии hotkey не работает — диссонанс.
    Мы регистрируем hotkey в consoleGlobals, который App.tsx
    зовёт в onMount — обещание и реализация совпадают.
synthesis: |
  Three additive pieces, all in scope:

  A. **`consoleHotkey.ts`** — pure helper (~50 lines, 6 tests).
     `matchesHotkey(event, hotkey): boolean`. Cross-platform:
     `metaKey || ctrlKey` required; `shift` / `alt` are explicit
     (presence required iff `true`; absence required iff
     `undefined`). Case-insensitive key via
     `event.key.toLowerCase()`. Caller decides whether to
     filter on `event.target` (we don't).

  B. **`fatal` severity** in `consoleStore.ts`. Same contract
     as `critical`: TTL=0 (sticky), increments `unreadErrors`,
     clickable. Type `ToastSeverity = 'info' | 'warn' | 'error'
     | 'critical' | 'fatal'`. `isErrorSeverity` extended
     accordingly. New CSS rule `.toast-item.toast-fatal` mirrors
     `.toast-critical` border + background gradient. UI consumer
     (`Toast.tsx`) reuses `CriticalIcon` for fatal — the JS-side
     decision is "sticky + magenta + octagon icon = stop, attend
     to this".

  C. **Hotkey registration** in `consoleGlobals.ts`. New
     `keydown` listener bound at install time, idempotent. Hotkey:
     `Cmd/Ctrl + backtick`. Suppress in editable targets.
     `uninstallConsoleGlobals()` exposed for cleanup. ConsoleButton
     `title` attribute platform-aware (`Cmd+\`` on Mac,
     `Ctrl+\`` elsewhere) via UAData + fallback to
     `navigator.platform`.

  Color-blind contract (the docs-only part):
    - Each `ToastSeverity` now has both (a) a primary color
      token (border-left + icon background) and (b) a shape
      (icon SVG path). The icon is the FIRST channel for users
      who can't resolve red/green — color and shape together
      satisfy WCAG 1.4.1 (Use of Color).
    - `data-severity={severity}` attribute on the toast div
      makes the channel machine-readable for future
      accessibility tooling (e.g. an a11y overlay that swaps
      color for pattern in the user's prefers-contrast
      scheme).

  Tests:
    - `consoleHotkey.test.ts` (new, 6 cases):
      1. cross-platform Cmd/Ctrl match
      2. Cmd+Shift+D with shift=true
      3. Ctrl+Alt+D with alt=true
      4. wrong key + missing modifier (both negatives)
      5. extra shift/alt modifier suppressed
      6. case-insensitive + special keys (backtick, slash)
    - `Toast.test.tsx` (+2 cases):
      1. every severity hosts a single `<svg>` in `.toast-icon`
      2. `fatal` produces identical icon HTML to `critical`
         + sticky pin + TTL=0.

  Existing tests (unmodified):
    - `consoleStore.test.ts` — 15 cases (covers critical TTL=0
      and increment; 'fatal' flows through the same code paths
      without disturbing them).
    - `ConsoleButton.test.tsx` — 7 cases (title doesn't break
      ARIA / data-testid lookups).
    - `Toast.test.tsx` — 6 existing + 2 new.

  Total: 366 → 374 (+8).
substrate: |
  + `ui/src/presentation/components/consoleHotkey.ts` (new, ~50 lines):
    pure helper `matchesHotkey`, type `Hotkey`.
  + `ui/src/presentation/components/consoleHotkey.test.ts` (new,
    ~70 lines, 6 cases).
  + `ui/src/presentation/components/Toast.tsx` (modified, ~120 → 148
    lines): SEVERITY_TOKEN extended with `'fatal'`; SEVERITY_ICON_JSX
    dispatch table maps each severity to an SVG icon; `isError`
    extended for fatal; `data-severity` attribute added for
    a11y tooling; existing 6 tests still pass.
  + `ui/src/presentation/components/Toast.test.tsx` (modified,
    +2 cases; 71 → 104 lines).
  + `ui/src/presentation/components/ConsoleButton.tsx`
    (modified, 37 → 71 lines): `detectMacPlatform()` helper
    (UAData → fallback), `CONSOLE_BUTTON_TITLE` constant,
    `title` attribute on button.
  + `ui/src/presentation/components/consoleGlobals.ts`
    (modified, 82 → 127 lines): `TOGGLE_HOTKEY` constant,
    `isEditableTarget()` helper, `onKeyDown` listener
    registration in `installConsoleGlobals`, new exported
    `uninstallConsoleGlobals` for tests / HMR.
  + `ui/src/presentation/components/consoleStore.ts` (modified,
    134 → 142 lines): `ToastSeverity` union extended with
    `'fatal'`; `TOAST_DEFAULT_TTL.fatal = 0`; `isErrorSeverity`
    extended for fatal.
  + `ui/src/presentation/icons/index.tsx` (modified,
    339 → 388 lines): four new severity icons
    (`InfoIcon`, `WarnIcon`, `ErrorIcon`, `CriticalIcon`),
    each documented with JSDoc.
  + `ui/src/styles/components.css` (modified, +9 lines,
    additive): `.toast-item.toast-fatal` selector (border +
    background) and `.toast-item.toast-fatal .toast-icon`
    selector (icon background + color). No existing rules
    touched.
  + `math/console-ux-polish/packet.md` (this packet; status
    `applied` because the decision is final; only the SHA is
    undecided pre-merge).
status: applied
axiom: A4
witness:
  applied_at: 2026-10-13
  commit: TBD
  supersedes: null
  notes: |
    Subagent-7's branch `feat/console-polish` will provide the
    actual SHA on merge. The packet is `applied` because the
    decision (fatal severity + color-blind icons + Cmd/Ctrl+`
    hotkey) is final; only the artifact SHA is undecided
    pre-merge.
epistemics:
  - statement: "Cmd/Ctrl+` matches the DevTools hotkey convention;
      Cmd+K is reserved by browser-native (URL bar focus) and by
      GitHub-style command palettes."
    marker: fact
    evidence: "VS Code Ctrl+` toggles the integrated terminal;
      Chrome DevTools uses Ctrl+` to switch between docked
      panels. (Author chat, 2026-10-13: «DevTools convention is
      fine, that's exactly what I had in mind».)"
  - statement: "Toast and consoleButton now render TWO independent
      channels for severity: color (border-left + icon
      background) AND shape (icon SVG path). WCAG 1.4.1 (Use of
      Color) requires that color not be the only means of
      conveying information."
    marker: fact
    evidence: "Toast.tsx:80-82 — `.toast-icon` slot hosts
      `SEVERITY_ICON_JSX[severity](TOAST_ICON_SIZE)`;
      `components.css:1244-1249` colors the same slot.
      Removing the SVG would leave only color — non-compliant.
      `consoleHotkey.ts:39-44` — matchesHotkey doc comment
      cross-references."
  - statement: "Tests 374/374 pass after the commit (was 366
      before). Add: 6 consoleHotkey + 2 Toast = 8 new tests.
      Existing 15 consoleStore + 7 ConsoleButton + 6 (Toast
      prior) = 28 unaffected."
    marker: fact
    evidence: "vitest run output: `Test Files 33 passed (33) |
      Tests 374 passed (374)`. Previous (worktree fresh
      checkout) baseline `Test Files 32 passed (32) | Tests 366
      passed (366)`. Distribution: consoleHotkey.test.ts (6) +
      Toast.test.tsx (+2) = 8 net."
  - statement: "`fatal` reuses `CriticalIcon` because consoleStore
      treats `fatal` and `critical` as the same channel. The
      only JS-side difference is that `fatal` is the LogLevel
      added by Subagent-6 to logger.ts; here in the UI it
      resolves to the same sticky + magenta + octagon-icon
      surface as `critical`."
    marker: judgment
    evidence: "consoleStore.ts:50-52 — `isErrorSeverity` includes
      fatal in the same `true` branch as critical;
      Toast.tsx:54-60 — `SEVERITY_ICON_JSX.critical` and
      `SEVERITY_ICON_JSX.fatal` both return `<CriticalIcon />`;
      `Toast.test.tsx` 'fatal severity reuses the critical icon'
      asserts identical SVG innerHTML."
  - statement: "Hotkey is suppressed when focus is in INPUT,
      TEXTAREA, or contenteditable so the user can type a
      backtick inside the code editor without toggling the
      console. The helper `matchesHotkey` itself does NOT look
      at `event.target`; the suppression lives in
      `consoleGlobals.onKeyDown`."
    marker: judgment
    evidence: "consoleGlobals.ts:55-60 — `isEditableTarget` checks
      `tagName` (INPUT / TEXTAREA) + `isContentEditable`.
      consoleGlobals.ts:78-86 — `onKeyDown` returns early if
      target is editable; then matches against
      `TOGGLE_HOTKEY`. consoleHotkey.ts:38-42 (doc comment)
      explicitly states 'It does NOT look at `event.target`;
      the caller decides whether to suppress'."
  - statement: "Decision axiom A4 — UX is the architecture. The
      color-blind icon channel exists because the user-
      observable surface (toast) is the API; making severity
      decodable without color is part of the UI contract,
      not a `nice-to-have`."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A4: 'The user-
      observable contract is the architecture. Optimize the
      visible surface first; the implementation is derivable
      from the surface.' Color-blind accessibility is part of
      that surface — without the icon channel, the toast is
      decodable ONLY by users with full-color vision."
---
