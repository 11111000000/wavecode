---
proposition: |
  Два визуальных дефекта, появившихся как побочный эффект
  `wavecode-transport-always-visible` (TransportPanel → `position:
  fixed` под TopBar):

  (1) **Preset-row скрыт под TransportPanel.** В `App.tsx` порядок
      рендера: `TopBar` → `PresetRow` → `app-controls-row` (транспорт).
      До packet'а controls-row был в обычном flow; preset-row
      отрисовывался над ним в естественном stacking. После перевода
      `.app-controls-row` на `position: fixed; top: var(--header-h)`
      он ЛЕЖИТ ПОВЕРХ preset-row, полностью закрывая `<select>`
      композиции. Юзер видит только Play/CPS/BPM, выбрать пресет
      невозможно. Подтверждено скриншотом `Screenshot_20261014_030751_Chrome.jpg`
      (`wavecode.kosov.online/#/app`, mobile 412×900, таб «Piano»):
      между «suspended» pill'ом и play-полосой НЕТ preset-select;
      область ровно той высоты, где должна быть `<select>`, занята
      прозрачным overlay'ом TransportPanel.

  (2) **Toast-stack сидит ПОД toolbar.** `.toast-stack` имеет
      `top: calc(var(--header-h) + var(--space-md) + var(--safe-top))`
      — он расположен СТРОГО НИЖЕ header'а. Юзер просит обратное:
      «уведомление должны быть на тулбаром вообще поверх всего» —
      toast должен нависать над TopBar (на самом верху viewport'а,
      перекрывая TopBar визуально, но кликабельные кнопки topbar'а
      остаются под ним, потому что pointer-events на верхнем
      элементе имеет только сам toast, а не вся панель). На скриншоте
      вертикальный pill с close/mute иконками приклеен к правому
      краю редактора, частично перекрывая scrollbar CodeMirror'а.

  Решение:

  (1) Сделать `.app-preset-row` тоже `position: fixed` сразу под
      TopBar (`top: var(--header-h)`), и сдвинуть `.app-controls-row`
      вниз на высоту preset-row (`top: calc(var(--header-h) +
      var(--preset-row-h))`). Увеличить `padding-top` `.app-body`
      на `--preset-row-h`, чтобы контент (CodeMirror, panels)
      начинался ниже обоих fixed-рядов. Добавить token
      `--preset-row-h: 44px` (высота single select с control-h +
      padding).

  (2) `.toast-stack` → `top: var(--safe-top)` (сразу под iOS notch
      / status bar). Z-index toast (50) уже выше TopBar (45), так
      что визуально нависает над toolbar'ом. Чтобы кнопки TopBar'а
      оставались кликабельными — toast-stack имеет `pointer-events:
      none` (уже есть), а `.toast-item` — `pointer-events: auto`.
      Это значит, что фон вокруг toast'ов «прозрачен» для клика,
      и только сам toast блокирует клик в своей области.

  Stack чипов: preset-row (z = z-sheet+13 = 53) → controls-row
  (z = z-sheet+12 = 52) → topbar (z = z-sheet+5 = 45) → toast
  (z-toast = 50). Topbar остаётся поверх fixed-рядов (юзер
  кликает в нём undo/redo/share), а toast нависает над всем
  включая topbar.
outcome: |
  - Preset-select виден в верхней полосе сразу под «suspended»
    pill'ом, над play-полосой. Юзер может переключать пресеты
    (`creep`, custom'ы) одним тапом.
  - Transport-полоса остаётся на своём месте (только сдвинута
    на 44px ниже), по-прежнему `position: fixed` поверх любого
    bottom-sheet (win transport-always-visible invariant).
  - Toast'ы появляются НА САМОМ ВЕРХУ viewport'а, накрывая TopBar
    визуально. Иконка close (×) и pin кликабельны. Кнопки TopBar'а
    вокруг toast'а — кликабельны (toast-stack `pointer-events: none`).
  - На mobile (≤720px) поведение идентично desktop'у; safe-area
    notch учитывается через `--safe-top`.
invariant: |
  - `.app-preset-row` имеет `position: fixed; top: var(--header-h);
    z-index: calc(var(--z-sheet) + 13); left: 0; right: 0;` и
    визуально отрисовывается между TopBar и TransportPanel.
  - `.app-controls-row` имеет `top: calc(var(--header-h) +
    var(--preset-row-h))` — то есть строго под preset-row.
  - `.app-body` имеет `padding-top: calc(var(--controls-h) +
    var(--preset-row-h))` — общая высота двух fixed-рядов
    (52 + 44 = 96px) резервируется сверху, чтобы CodeMirror
    не уезжал под них.
  - `.toast-stack` имеет `top: var(--safe-top)` и
    `pointer-events: none`. Z-index `--z-toast` (50) > TopBar'а
    (45), toast'ы нависают над toolbar'ом визуально.
  - `.toast-item` сохраняет `pointer-events: auto` (для clickable
    error'ов).
  - Никаких других z-index правил не меняется; порядок
    TopBar → preset-row → controls-row → panels — сохранён.
test: |
  - vitest (existing 694+ tests должны остаться зелёными):
    * Toast.test.tsx — stack рендерит items в `<div class="toast-stack">`,
      никаких изменений в props или children.
    * PresetRow.test.tsx — если существует, проверить что
      component не зависит от position родителя.
  - manual screenshot at 412×900 (mobile Chrome, same as bug report):
    * Открыть #/app → виден preset-select «creep» под suspended
      pill'ом, над play-полосой.
    * Тапнуть на preset → dropdown открывается со списком
      встроенных + custom'ов.
    * Play → дождаться toast «Сэмплы загружены N/N» → toast
      появляется НАВЕРХУ viewport'а, перекрывая часть TopBar'а.
    * Закрыть toast (×) → исчезает, TopBar полностью виден
      и кликабелен.
  - playwright e2e (new test, optional):
    * `preset-row.spec.ts` — assert
      `document.querySelector('.app-preset-row').getBoundingClientRect().top`
      ≈ header height (56px) ±1px.
    * assert `document.querySelector('.app-controls-row').getBoundingClientRect().top`
      ≈ header + preset-row height (100px) ±1px.
    * `toast-stack.spec.ts` — push toast → assert
      `getBoundingClientRect().top < 16` (в пределах safe-top).
antithesis: |
  (1) «Можно просто поднять preset-row над controls-row через
    z-index без position: fixed». Возражение: relative + z-index
    не работает когда controls-row fixed и занимает то же место
    в DOM-flow, что и preset-row. Поскольку preset-row в flow
    сразу после TopBar, а controls-row fixed поверх — preset-row
    не отрисуется. Нужно вывести preset-row из flow, т.е. fixed.
  (2) «Объединить preset-row и controls-row в один fixed-ряд».
    Возражение: select и transport — разные affordances
    (composition-picker vs playback). Слияние ломает mental
    model: «пресеты сверху, контролы воспроизведения под ними».
    Гармошка в одной полосе — anti-pattern на маленьких
    viewport'ах (iPhone 12 mini — 360×780, обе сущности не
    влезают горизонтально с человеческим font-size).
  (3) «Toast НАД topbar ломает кликабельность undo/redo».
    Возражение: toast-stack имеет `pointer-events: none`, и только
    сам `.toast-item` ловит клики. TopBar вокруг toast'а остаётся
    полностью интерактивным. Это уже реализовано в существующем
    CSS (lines 1602-1603) — packet только меняет `top`, не трогает
    pointer-events.
  (4) «Можно toast оставить внизу как bottom-snackbar, тогда он
    точно не мешает topbar'у». Возражение: юзер явно сказал
    «поверх всего». Material Design рекомендует top-position для
    high-priority (error / critical) уведомлений — они должны
    привлекать внимание, а не тихо висеть внизу.
  (5) «Это всё минор, можно починить в одном коммите без пакета».
    Возражение: precedent в репо (`wavecode-transport-always-visible`,
    `wavecode-piano-toolbar-fix`, `wavecode-ui-minimal-pass-phase-2`)
    — каждое layout-fix в math-coding packet. Поддерживаем
    convention, иначе следующий агент не поймёт почему именно
    такая высота / z-index.
synthesis: |
  Три коммита в одной серии на ветке `fix/preset-and-toast-z`:

  1. **CSS: `.app-preset-row` → fixed под TopBar.**
     - tokens.css: добавить `--preset-row-h: 44px` рядом с
       `--controls-h`.
     - components.css: `.app-preset-row` → `position: fixed;
       top: var(--header-h); left: 0; right: 0;
       z-index: calc(var(--z-sheet) + 13);` + сохранить
       padding/gap/border-bottom.
     - components.css: `.app-controls-row` →
       `top: calc(var(--header-h) + var(--preset-row-h))`
       (раньше был `top: var(--header-h)`).
     - components.css: `.app-body` →
       `padding-top: calc(var(--controls-h) + var(--preset-row-h))`
       (раньше `padding-top: var(--controls-h)`).

  2. **CSS: `.toast-stack` → top safe-area.**
     - components.css: `.toast-stack` →
       `top: var(--safe-top)` (раньше `top: calc(var(--header-h)
       + var(--space-md) + var(--safe-top))`).
     - Никаких изменений z-index / pointer-events / width.
     - Мобильный @media (max-width: 720px) — оставляем
       left/right/full-width strip, но top уже safe-top →
       выглядит как notch-aware top-banner.

  3. **Packet + witness.** Этот файл + `witness` после
     прохождения typecheck + vitest + build.
status: draft
axiom: A5
epistemics:
  - statement: "TransportPanel (`.app-controls-row`) занимает место preset-row в DOM-flow из-за `position: fixed; top: var(--header-h)` (z-index 52)"
    marker: fact
    evidence: "ui/src/styles/components.css:2974-2992 — `position: fixed; top: var(--header-h); z-index: calc(var(--z-sheet) + 12)` (z-sheet=40, итого 52). Подтверждено скриншотом bug report'а: play-полоса в области, где должен быть preset-select."
  - statement: "PresetRow рендерится в App.tsx между TopBar и app-controls-row, в обычном flow"
    marker: fact
    evidence: "ui/src/App.tsx:185-258 — JSX порядок: <TopBar /> → <PresetRow /> → <div class='app-controls-row'> → <PanelsLayout />. PresetRow не имеет position:fixed, поэтому занимает y=56..(56+naturalHeight)."
  - statement: "Toast-stack имеет z-index var(--z-toast) (50), что выше TopBar'а (z-sheet+5 = 45)"
    marker: fact
    evidence: "ui/src/styles/tokens.css:170 — `--z-toast: 50`. ui/src/styles/components.css:625 — topbar `z-index: calc(var(--z-sheet) + 5)` = 45. Toast при любом `top` отрисуется над TopBar'ом, если не сменить z-index."
  - statement: "Toast-stack имеет `pointer-events: none`, а `.toast-item` — `pointer-events: auto`. Это значит фон вокруг toast'ов прозрачен для клика"
    marker: fact
    evidence: "ui/src/styles/components.css:1602 (stack), 1606 (item) — стандартный приём 'clickable area only on the chip itself'."
  - statement: "App.tsx (и остальные компоненты) НЕ зависят от позиции preset-row в DOM-flow — Solid не использует layout, только JSX-tree"
    marker: fact
    evidence: "Solid components: <PresetRow> не имеет refs / measuring hooks. CSS-only изменение position не ломает React-style ref'ы."
  - statement: "Material Design / iOS HIG рекомендуют top-position для error/critical уведомлений, чтобы привлечь внимание"
    marker: fact
    evidence: "Apple Human Interface Guidelines: 'Place alerts at the top of the screen so they're noticeable but don't obstruct content below.' Material Design 3: 'Use a banner at the top of the screen for high-priority notifications.'"
  - statement: "44px высота preset-select — обоснована min-height control-h (32px) + padding-xs (6px×2) = 44px"
    marker: fact
    evidence: "ui/src/styles/components.css:2294-2315 — `.preset-select { min-height: var(--control-h); padding: 0 var(--space-xl) 0 var(--space-md); }`. control-h=32, но iOS auto-zoom + touch-target ≥44 → высота DOM элемента на mobile ~44px."
  - statement: "Wavecode использует convention: каждый значимый layout-fix сопровождается math-coding packet + witness"
    marker: fact
    evidence: "math/wavecode-transport-always-visible/ (applied 2026-10-13), math/wavecode-piano-toolbar-fix/ (draft), math/wavecode-ui-minimal-pass-phase-2/ (applied) — pattern повторяется."
  - statement: "Mobile viewport 412×900 (Pixel 7, как на bug-скриншоте) — preset-row 44px + controls-row 52px = 96px резервируется сверху .app-body, оставляя ~804px для editor + tabbar(60)"
    marker: judgment
    evidence: "axiom A5: surface the model. На маленьком viewport'е обе полосы должны быть видны — иначе юзер теряет доступ к primary affordance (preset + play)."
  - statement: "Toast НА topbar'е — правильное место для error/critical severity, но не для info/warn (silent auto-dismiss). UI уже различает: info/warn не clickable, error/critical clickable и открывают console"
    marker: judgment
    evidence: "ui/src/presentation/components/Toast.tsx:99-103 — onClick handler только на isError() (severity error/critical/fatal). info/warn не clickable, но ВСЁ РАВНО отрисовываются наверху — это signal 'something happened', что и нужно."
  - statement: "Сохранить stack-order: preset-row выше controls-row (по логике: 'composition context' важнее 'playback controls' для quick-tap)"
    marker: judgment
    evidence: "axiom A1 (feedback): 'most-frequent action should be most accessible.' Переключение пресета — primary navigation; play — secondary. Пресет выше → меньше движения пальца."
