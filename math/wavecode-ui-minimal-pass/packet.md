---
proposition: |
  Текущий `#/app` регрессировал по визуальному шуму относительно
  мокапа лендинга (`ui/src/presentation/components/landing/sections/EditorMockup.tsx`):

  - `TopBar.tsx:31` — 10 видимых иконок подряд (undo, redo, new,
    save, share, layout-swap, mobile-menu, delete-preset, reset-all)
    плюс LED-индикатор и два параллельных loading-индикатора
    (`audio-loading-skeleton`, `audio-loading-pill`). Мокап показывает
    4 иконки + 1 LED.
  - `PresetRow.tsx:62-63` — debug-кнопки `beep(440)` и `beep(220)`
    визуально неотличимы от пресет-chips (такой же `wc-chip`).
  - `App.tsx:284-286` — ссылка `→ /admin` всегда торчит в углу как
    dev-инструмент без контекста.
  - `AIEditPanel.tsx:217-247` — два `<select>` (модель + thinking)
    занимают целую строку над «Применить». После первой настройки
    большинство юзеров их не трогает.
  - `PresetRow.tsx:44-61` — Step/Piano/Mixer chips висят на верхней
    панели рядом с пресет-select. Семантически это «инструменты»,
    они должны жить в нижней зоне (рядом с AI в TabBar).
  - `TransportPanel.tsx:31-35, :20-25` — cps-presets (60/120/240)
    и swing-divisor select (1/4/1/8/1/16/1/3) добавляют плотности
    без визуальной иерархии. На ширине 360-414px это горизонтальный
    overflow.

  Цель: привести `#/app` к визуальной чистоте мокапа **без регрессий**
  для daily workflow. Сохранить power-user shortcuts, схлопнуть шум.
antithesis: |
  (1) «Схлопнуть всё под ⋯ — потеряем discoverability редких действий».
    Возражение: «Сбросить всё», «Мобильный режим», «Сохранить пресет» —
    это setup/cleanup, не daily workflow. Hide-once-discoverable —
    нормальный паттерн (Linear, Figma). Для тех кто знает, остаётся
    keyboard shortcut (`Ctrl+Shift+A` для админки).
  (2) «Удалить cps-presets и swing-divisor — регрессия для power
    users». Возражение: НЕ удаляем функционально, визуально принижаем
    (smaller, outline-style) и скрываем cps-presets на `@media
    (max-width: 639px)`. Функция остаётся, просто не визуально
    равноправна play-кнопке.
  (3) «AI ⚙-popover скроет выбор модели от новых юзеров».
    Возражение: на кнопке показываем текущее значение (`⚙ M3 · high`),
    плюс tooltip при первом hover. Discoverability ≠ visibility 24/7.
    Эти настройки не «фичи продукта», а escape hatch.
  (4) «Bottom-toolstrip vs Tools tab в TabBar — оба варианта рабочие».
    Возражение: bottom-toolstrip = 1 тап на любое действие; Tools tab
    = 2 тапа. Step/Piano открываются часто (поправь grid → послушай →
    закрой → открой снова), friction ×2 заметен на длинной сессии.
  (5) «Админка в ⋯ меню избыточна — есть keyboard shortcut».
    Возражение: A+B+C — keyboard shortcut для тех кто знает, ⋯ меню
    для тех кто не знает (но увидел «что-то ещё»), контекстный ⚠ бейдж
    для тех у кого прямо сейчас ошибка. Три уровня покрывают все
    user-state'ы без постоянного визуального шума.
synthesis: |
  Восемь правок в одной серии инкрементальных коммитов:

  1. **`ui/src/presentation/components/app/PresetRow.tsx`** (modify):
     удалить `<button>440</button>` (`beep(440)`) и `<button>220</button>`
     (`beep(220)`) на `:62-63`. Импорт `beep` из `audioActions` больше
     не нужен — удалить. Чипы Step/Piano остаются пока (уходят в п. 7).

  2. **`ui/src/presentation/components/app/TopBar.tsx`** (modify):
     оставить видимыми: `WavecodeLogo`, LED-индикатор, **New**
     (отдельная иконка, частый action), Undo, Redo, Share, LayoutSwap,
     **OverflowMenu** (новый компонент, кнопка `⋯`). В OverflowMenu —
     Save preset, Delete preset (только если `custom-`), Mobile mode
     (auto/compact/full), ────, Open admin 🔧, Reset all.
     `mobile-menu-wrap` блок удаляется (его функция — Mobile mode,
     переезжает в OverflowMenu).

  3. **`ui/src/presentation/components/app/OverflowMenu.tsx`** (new,
     ~90 строк): popover с разделителем между user-actions и
     admin-actions. Backdrop-close, keyboard navigation (ArrowUp/Down,
     Esc), aria-haspopup/menu/menuitem. Mobile-friendly (full-width
     sheet на <640px, popover на десктопе).

  4. **`ui/src/App.tsx`** (modify): удалить `<a class="wc-debug-link"
     href="#/admin">→ /admin</a>` (постоянная ссылка). Добавить
     `openAdmin` callback в `installKeyboardShortcuts`:
     `Ctrl+Shift+A` → `goHash('/admin')`. Long-press на
     `WavecodeLogo` (3 сек) → `goHash('/admin')`. Условный бейдж
     `<a class="wc-admin-warn" href="#/admin" aria-label="...">⚠</a>`
     в TopBar показывается когда `appStore.audio.lastError` непуст.

  5. **`ui/src/presentation/state/uiState.ts`** (modify):
     расширить `installKeyboardShortcuts` опциональным `openAdmin`
     callback. Сигнатура: `installKeyboardShortcuts(refs: {
     focusAI; focusScore; undoScore; redoScore; openAdmin?: () => void })`.
     Хэндлер: `Ctrl+Shift+A` → `refs.openAdmin?.()`.

  6. **`ui/src/presentation/panels/AIEditPanel.tsx`** (modify):
     заменить два `<select>` (model + thinking) на одну кнопку
     `⚙ M3 · high` → popover `LLMSettingsPopover.tsx` (~70 строк).
     На кнопке — текущая model + thinking через ` · `. В popover —
     два `<select>` и краткий one-liner про trade-off (smart/медленнее
     vs fast/быстрее).

  7. **`ui/src/presentation/components/TransportPanel.tsx`** (modify):
     cps-presets и swing-divisor select — оставляем функционально,
     но визуально принижаем:
     - `.cps-preset-btn` → smaller + outline (без primary fill).
     - `.cps-presets` → hidden на `@media (max-width: 639px)`.
     - `.swing-divisor` → icon-style (только chevron, без border).
     В preset-чипах и select — добавить `title="..."` если нет.
     Никаких функциональных удалений.

  8. **`ui/src/presentation/components/BottomToolstrip.tsx`** (new,
     ~60 строк): horizontal toolstrip над TabBar с тремя иконками
     (Step, Piano, Mixer). Каждая — toggle кнопка: подсвечивается
     когда соответствующий bottom-sheet открыт (`getKindSnap`).
     aria-pressed, data-active, single-tap access. На mobile —
     sticky чуть выше TabBar.

  9. **`ui/src/App.tsx`** (modify): добавить `<BottomToolstrip />`
     после `<PanelsLayout />` (т.е. между panels и TabBar).
     `showStepGrid`/`showPiano` state и `onToggleStepGrid`/`onTogglePiano`
     из AppShell удаляются (BottomToolstrip сам управляет через
     `openKindSheet`/`closeKindSheet`). Mixer toggle добавляется
     (state в AppShell, `showMixer`).

  10. **`ui/src/presentation/components/app/PresetRow.tsx`** (modify,
      продолжение п. 1): удалить Step/Piano чипы и связанные props
      (`showStepGrid`, `showPiano`, `onToggleStepGrid`, `onTogglePiano`).
      Компонент сводится к одному `<select>` пресетов + save-preset-bar.

  Удалить CSS:
  - `ui/src/styles/components.css:.audio-loading-skeleton` (мёртвый,
    `suspended`-state не достигается после рефакторинга audio-actions).
  - `ui/src/styles/components.css:.wc-debug-link` (заменён на
    `.wc-admin-warn` только в error-state).

  Добавить CSS (`components.css` ~120 строк):
  - `.wc-overflow-menu`, `.wc-overflow-menu__backdrop`, `.wc-overflow-item`,
    `.wc-overflow-sep` — стили для OverflowMenu.
  - `.wc-llm-settings-btn`, `.wc-llm-popover` — стили для AI gear.
  - `.wc-toolstrip`, `.wc-toolstrip-btn`, `.wc-toolstrip-btn[data-active]`
    — стили для BottomToolstrip.
  - `.wc-admin-warn` — стиль для error-badge.
  - Mobile-правила для `.cps-presets` (`@media (max-width: 639px)`).

  Visual after:
    TopBar (7 visible):  Logo · LED · [New] · [↺] [↻] [Share] [⇄] [⋯]
    PresetRow:           [Creep ▼]                                     ← один select
    TransportPanel:      [▶] · cps── · BPM · swing── · (cps-presets мелко)
    ScorePanel:          code editor
    BottomToolstrip:     [Step] [Piano] [Mixer]                       ← новая строка
    TabBar:              Score · AI · Status

  Error-state TopBar (только при `appStore.audio.lastError`):
    LED заменяется на ⚠ → `#/admin`.
status: applied
---