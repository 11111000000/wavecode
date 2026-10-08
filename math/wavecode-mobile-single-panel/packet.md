---
proposition: |
  На экранах ≤720px (`window.matchMedia('(max-width: 720px)').matches`)
  при первой загрузке (no localStorage entry) — `scoreOpen=true,
  aiOpen=false, statusOpen=false`. Score-панель занимает весь
  viewport-height (flex: 1). AI и Status свернуты — доступ через tap
  на collapsible header. На десктопе (>720px) — текущее поведение
  `scoreOpen=true, aiOpen=true, statusOpen=true`. Выбор сохраняется
  в `localStorage[wavecode-mobile-default: 'compact' | 'full']` —
  юзер может явно переопределить toggle-button'ом («📱 mobile-режим»
  toggle в header, pin).
antithesis: |
  (1) auto-detection делает странное для iPad landscape (1180pt,
    >720) — там пользователь видит все 3 панели и не страдает.
    Решение: breakpoint 720 — landscape iPad остаётся full-panel.
    (2) Юзер в mobile хочет иногда AI-панель открыть → tap на
    toggleable header. Не нужен desktop-style horizontal layout.
    (3) Если localStorage говорит «full», а breakpoint — mobile,
    что важнее? — Решение: explicit user pref (`wavecode-mobile-
    default: 'auto'|'compact'|'full'`) побеждает auto-detection.
    Default = 'auto'. (4) single-panel layout на iPhone SE
    (320×568, 16-year-old device) = 568 - 50 toolbar - 26 header
    = 492pt editor height — приемлемо для typing.
synthesis: |
  Auto-detect viewport ≤720px на load + сохранять pref в localStorage
  для explicitness. По умолчанию `auto`. Юзер может переопределить
  через «📱 mobile-режим» toggle. AI и Status collapsed на mobile,
  Score занимает 100% доступной высоты. CSS уже имеет @media для
  mobile, расширяется на .app-body layout.
substrate: |
  + `presentation/state/uiState.ts`: `loadState()` enhanced с
    `window.matchMedia('(max-width: 720px)').matches` если нет
    explicit `wavecode-mobile-default` в localStorage.
  + `presentation/state/uiState.ts`: новый `setMobileMode(mode:
    'auto' | 'compact' | 'full')`, `getMobileMode()`, persist
    to `wavecode-mobile-default`.
  + `App.tsx`: новый `📱` toggle-кнопка в `.app-header` —
    открывает mini-menu с тремя опциями (auto/compact/full),
    default active = current. НЕ показывать в desktop breakpoint
    (visibility control через CSS).
  + `index.css`: extended `@media (max-width: 720px)` —
    `.app-body` уже column-flex, добавляется:
    - `.ai-panel[data-open='false']`, `.status-panel[data-open=
      'false']` — скрыты на mobile чтобы сэкономить скролл-пространство
    - `.score-panel` — `flex: 1 1 auto; min-height: calc(100vh -
      100pt)` (полный viewport)
  − ничего не удалено.
status: applied
axiom: A1
epistemics:
  - statement: "iPhone SE 3rd gen = 375×667pt CSS; 1st gen = 320×568
      — основные mobile breakpoints 720 (covers все iPhones landscape
      тоже)"
    marker: fact
    evidence: "Apple device specs — iPhone SE landscape = 667×
      375pt; breakpoint 720 catches portrait AND landscape small phones"
  - statement: "Default wavecode UI bootstrap = score+ai+status
      all open (loadState defaultState). Mobile UX плохой —
      score-panel=200pt на iPhone SE"
    marker: fact
    evidence: "presentation/state/uiState.ts:11-15 defaultState =
      {scoreOpen:true, aiOpen:true, statusOpen:true}"
  - statement: "`window.matchMedia('(max-width: 720px)')` работает
      в первой загрузке (loadState synchronous); re-eval при
      resize = не нужен (юзер меняет через toggle-button)"
    marker: fact
    evidence: "MDN `matchMedia` — synchronous, returns
      MediaQueryList объект; `.matches` boolean access"
  - statement: "Localstorage `wavecode-mobile-default` сохранённая
      override побеждает matchMedia detection; user-pinned pin
      mechanic стандартен (Figma pin режим «auto-detect» vs «manual»)"
    marker: fact
    evidence: "стандартная UI pattern — explicit override побеждает
      detection; Figma theme, VSCode UI Density"
  - statement: "Collapsible header click уже handling of toggleState
      через `toggleScore`/`toggleAI`/`toggleStatus` — AI/Status
      toggleable уже работает"
    marker: fact
    evidence: "App.tsx:32-39 CollapsibleHeader `onToggle` → toggle
      handler"
  - statement: "Min-height score panel на mobile = remainder of
      viewport - header - footer = ~440pt на iPhone SE — комфортно
      для active editor use"
    marker: fact
    evidence: "iPhone SE 568pt - 76pt (header+panel-header+preset
      row+button row) - 26pt (footer-debug) = ~466pt editor"
  - statement: "На mobile AI-panel default closed — но юзер может
      его раскрыть и ввести инструкцию; сценарий не блокирован"
    marker: fact
    evidence: "AI panel имеет свой collapsible, toggle через
      header tap"
---
