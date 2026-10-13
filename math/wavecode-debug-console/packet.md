---
proposition: |
  Console UI wavecode — три новых компонента в `ui/src/presentation/components/`:
  `<Toast />` (top popover stack), `<ConsoleButton />` (fixed FAB-кнопка
  bottom-right), `<ConsoleSheet />` (bottom-sheet / right-drawer с
  вкладками Errors / All logs / By source). Solid-сигналы
  `consoleStore` (toasts, consoleOpen, unreadErrors) — единый источник
  истины. Кнопка ВСЕГДА видна (44×44, safe-area-aware); пульсирует
  красным + бейдж unreadErrors, если есть непрочитанные ошибки.
  Critical / error — кликабельные popovers с open-console affordance.
  Console НЕ auto-popup — пользователь сам нажимает кнопку.
  Заменяет `DebugPanel.tsx` (Ctrl+Shift+D toggle, агрессивный auto-open
  при любой ошибке — пережиток ранней разработки).
antithesis: |
  (1) «Агрессивный auto-popup overlay помогает на mobile, где нет
     DevTools». Возражение: пользователь смотрит на Score, а overlay
     с логом закрывает редактор посреди набора. Console должна быть
     *доступна*, не *навязана* — кнопка в углу + click-to-open = лучший
     баланс. В крайнем случае, `window.onerror` → `toastStack.push(...)`
     верхний popover с CTA «Open console» —> пользователь сам решает.
  (2) «Toast перегружает UI на каждый warn/info». Решение: info/warn
     silent (только stack), error/critical → popover + glow-button.
     Source auto-detect по `[wavecode]/[strudel]/...` префиксу.
  (3) «Polling logger 500ms — лишняя работа». Возражение: sink-механизм
     Subagent 1 (logger.setSink) даёт immediate update без polling.
     Polling оставлен как fallback на случай, если logger ещё не landed.
  (4) «Bottom-sheet 60vh/90vh на mobile = перекрытие tabbar». Решение:
     `bottom: calc(var(--tabbar-h) + var(--safe-bottom))` — sheet
     начинается НА tabbar'е, не за ним. Desktop ≥1024px — right drawer
     width 480px, full-height.
  (5) «Динамический import() ломает tree-shaking». Возражение: vite
     умеет динамические imports, Vite-ignore comment исключает файл
     из статического графа. Модуль не попадает в initial bundle,
     грузится lazy после первого open console.
synthesis: |
  Три компонента + signal-store + 1 лист CSS + 1 .d.ts stub. Удаляем
  DebugPanel (Ctrl+Shift+D) и debug.css. App.tsx навешивает Toast
  сверху, ConsoleButton + ConsoleSheet в конце. consoleGlobals
  устанавливает window.onerror / unhandledrejection в onMount. Console
  UX: всегда видна кнопка → пульсирует при ошибках → click → bottom
  sheet с логами → copy/clear. Параллельно работающие агенты не
  блокируют друг друга: Subagent 1 (logger) опционально подцепляется
  через динамический import; Subagent 3 (SampleLoader) вообще не
  пересекается по API. До merge'а Subagent 1: ConsoleSheet показывает
  warning «Logger module not installed» + пустой список — функционально
  корректно, тесты проходят.
substrate: |
  − `ui/src/presentation/panels/DebugPanel.tsx` (deleted): заменён
    на trio Toast+ConsoleButton+ConsoleSheet. Ctrl+Shift+D toggle
    больше не работает — button в углу + click-to-open. Старая
    панель имела свой собственный buffer + console monkey-patching,
    что дублировало функциональность и мешало logger'у от Subagent 1.
  − `ui/src/debug.css` (deleted): стили DebugPanel'а. Никто
    больше не использует `.debug-*` классы (legacy.css:774
    `.score-debug .debug-err` — другой селектор, не трогаем).
  + `ui/src/presentation/components/consoleStore.ts`: Solid signals
    + signal store API. Cap MAX_TOASTS=4 FIFO; drop oldest non-sticky
    first; sticky = critical (ttlMs=0); severity-based unreadErrors
    counter; setConsoleOpen(true) ⇒ markAllRead.
  + `ui/src/presentation/components/consoleGlobals.ts`: window.onerror
    + unhandledrejection → pushToast({severity:'error', source:'window'}).
    Dedupe 1s window по fingerprint.
  + `ui/src/presentation/components/Toast.tsx` (rewritten): стек
    popovers. Severity-tinted left border + icon badge. Кликабельный
    error/critical → setConsoleOpen(true) + dismiss. Sticky critical
    имеет PinIcon. Mobile: full-width strip. Desktop: top-right
    column 360px max.
  + `ui/src/presentation/components/ConsoleButton.tsx`: fixed
    bottom-right 44×44 (touch-target AAA). `has-errors` class +
    pulse-glow keyframes (1Hz, 60%→100% opacity). Badge top-right
    с count (cap 99+). Mobile: поднят над FAB через
    `bottom: calc(safe-bottom + fab-size + 16px)`.
  + `ui/src/presentation/components/ConsoleSheet.tsx`: bottom-sheet
    с in-компонентным state (activeTab, snap). Tab 'errors' —
    warn+error последние 50; 'all' — последние 200 (reverse chrono);
    'by-source' — grouped по [wavecode]/[strudel]/etc. Footer:
    Copy as text (clipboard.writeText, graceful no-op если нет
    navigator.clipboard) + Clear (logger.clear + consoleStore.clearToasts).
    Logger optional: dynamic import через variable, fall back
    gracefully.
  + `ui/src/infrastructure/log.d.ts`: stub declarations для
    `~/infrastructure/log` — type-check проходит до merge'а Subagent 1.
    Контракт зафиксирован (LogLevel, LogEntry, logger.getBuffer/clear/
    install/setSink/push, MAX_LOG_ENTRIES).
  + `ui/src/presentation/icons/index.tsx`: добавлены ConsoleIcon
    (terminal-propt, антенна+точки) и PinIcon.
  ~ `ui/src/styles/components.css`: append sections `.toast-stack`,
    `.toast-item`, `.console-btn` + `pulse-glow` keyframes,
    `.console-sheet` + `.console-backdrop` + `.console-panel`
    + `.console-tabs` + `.console-entry` + `.console-group`
    + `.console-footer` + `wc-sheet-fade`/`wc-sheet-rise` keyframes.
    Использует существующие tokens: `--err`, `--warn`, `--cyan`,
    `--magenta`, `--surface-{1..4}`, `--shadow-pop`, `--ease-spring`,
    `--z-toast`/`--z-fab`/`--z-sheet`. Никаких новых vars.
  ~ `ui/src/main.tsx`: удалён `import './debug.css';` — стили теперь
    внутри `components.css` (единая components layer).
  ~ `ui/src/App.tsx`: импорты Toast/ConsoleButton/ConsoleSheet/
    installConsoleGlobals. `onMount(installConsoleGlobals)`. JSX:
    `<Toast />` сверху; `<ConsoleButton />` и `<ConsoleSheet />`
    внизу (после TabBar). `<DebugPanel />` удалён.
