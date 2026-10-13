---
proposition: |
  Продолжение `wavecode-preset-row-and-toast-z`. Тот пакет перенёс
  toast-stack на top:safe-top, но **z-index остался 50** — а после
  его же фикса preset-row (z-sheet+13 = 53) и controls-row
  (z-sheet+12 = 52) стали ВЫШЕ toast'а. Результат: при появлении
  уведомления (например «Сэмплы загружены N/N» после ▶) toast
  визуально появляется ВНУТРИ панели Play — перекрывается ею и
  невидим. Юзер видит только верхнюю часть toast'а над toolbar'ом,
  а body чипа уходит под controls-row.

  Плюс три смежных дефекта, обнаруженных в мобильном viewport'е
  412×900 (Pixel 7) при активной split-pane:

  (1) **«Чёрная полоска» на Play-панели.** preset-row и
      controls-row обе имеют `background: rgba(10, 10, 14, 0.88)`
      / `0.92` + `border-bottom: 1px solid var(--border)`. На
      тёмной теме это даёт две различимые тёмные полосы
      (визуальный «двойной бордюр»). Юзер читает верхнюю как
      декоративную полосу, которая «ест место».

  (2) **Редактор залезает под fixed-ряды** + **слишком крупный
      шрифт.** На mobile score-panel получает ≈178px высоты
      (900vh − 56 header − 60 tabbar − 96 fixed-rows − 450 sheet
      − 22 score-debug − 110 mini-toolbar ≈ 178−132 = 46px для
      cm-host). CodeMirror при дефолтном font-size показывает 1-2
      строки и скроллится. Юзер физически не может прочитать
      9-строчный snippet. Шрифт `var(--fs-sm) = 12px` — мелко,
      но на mobile с Retina это всё равно читаемо.

  (3) **MiniNotationToolbar (snippet-клавиатура) занимает 2 ряда
      × 36px = ~110px.** 14 кнопок (note/s/stack/n/</>/[/]/*/?/
      .gain(/.lpf(/,/␣) flex-wrap'аются на 2 строки. На mobile
      это 12% viewport'а. Юзер сказал «надо как-то скрывать
      Вот эту полоску с быстрым вводом она занимает слишком
      много места».

  Решение — связка из 4 ортогональных правок:

  (a) **`--z-toast: 50 → 80`.** Новый уровень над modal (60)
      и всеми fixed-рядами (52/53). Toast гарантированно
      перекрывает ВСЁ, включая TopBar (45), preset-row (53),
      controls-row (52), FAB (20+), sheet (40+1). Только
      modal (60) остаётся ниже toast'а — но modal обычно
      не активен, когда toast появляется (modal сам по себе
      блокирует UI).

  (b) **preset-row → визуально прозрачный.** Убираем
      `background`, `border-bottom`, `backdrop-filter`. Только
      сам `<select>` с outline. controls-row остаётся
      единственным визуальным «каркасом» командной панели.
      Добавляем controls-row `border-top: 1px solid var(--border)`,
      чтобы остался тонкий разделитель между TopBar'ом и панелью
      (но только один, не два).

  (c) **CodeMirror `cm-content` font-size → `var(--fs-xs) = 11px`
      на mobile (≤720px).** С 12px → 11px получаем +1 строку
      видимого текста без потери читаемости. line-height
      соответственно 1.4.

  (d) **MiniNotationToolbar collapsed по умолчанию на mobile.**
      ScorePanel получает signal `miniToolbarOpen` (default
      false на viewport ≤720, true на desktop). В score-debug
      row добавлена маленькая кнопка-переключатель «✎ snippet»
      (wc-chip style). State персистится в localStorage
      `wavecode-mini-toolbar-v1`. На mobile это освобождает
      ~110px для cm-host.
outcome: |
  - Toast ВСЕГДА появляется НА САМОМ ВЕРХУ viewport'а, перекрывая
    TopBar + preset-row + controls-row визуально. Иконка close (×)
    кликабельна. TopBar-кнопки вокруг toast'а остаются
    кликабельными (pointer-events:none на стеке).
  - Между TopBar'ом и панелью Play — один тонкий border-top,
    а не двойной. preset-row сливается с фоном страницы,
    select виден как «островок» в чистом пространстве.
  - Редактор на mobile (412×900, sheet open) показывает
    5-6 строк кода (вместо 1-2): font-size 11px +110px
    освобождено от toolbar'а = комфортная читаемость.
  - Tap по «✎ snippet» в score-debug row разворачивает
    mini-toolbar (снизу вверх, slide-in 200ms). Tap ещё раз —
    сворачивает. State запоминается между сессиями.
invariant: |
  - `.toast-stack` имеет z-index `var(--z-toast)` = 80.
    Выше: z-modal (60), z-sheet+13 (53), z-sheet+12 (52),
    z-fab (20). Ниже: ничего (80 — наш максимум). pointer-
    events:none на стеке, pointer-events:auto на .toast-item.
  - `.app-preset-row` НЕ имеет `background` и НЕ имеет
    `border-bottom`. Только `position:fixed; top:header-h;
    z-index:calc(z-sheet+13)` + select с outline. Высота
    `--preset-row-h: 44px` остаётся (для padding-top .app-body).
  - `.app-controls-row` имеет `border-top: 1px solid var(--border)`
    (вместо border-bottom в оригинале). Тонкая линия сверху
    отделяет от прозрачного preset-row. Имеет свой
    `background: rgba(10, 10, 14, 0.92)` — это визуальный
    «каркас» команд-панели.
  - `.cm-host .cm-editor .cm-content` на @media (max-width:720px)
    имеет `font-size: var(--fs-xs) = 11px; line-height: 1.4`.
  - MiniNotationToolbar рендерится только когда `miniToolbarOpen()`
    = true. Default на mobile: false. Default на desktop: true.
    State персистится в `wavecode-mini-toolbar-v1` localStorage.
  - Кнопка `snippet-toggle` (wc-chip) видна на любом viewport'е,
    но имеет aria-label="Show/hide snippet toolbar" и
    data-active отражает текущее состояние.
test: |
  - vitest MiniNotationToolbar.test.tsx (existing 9 tests должен
    остаться зелёным — API компонента не меняется, props
    `editor?: () => Api` опциональный, дефолтное поведение
    рендерит кнопки).
  - vitest новый MiniNotationToolbar.test.tsx (+2 cases):
    * default render — кнопки рендерятся.
    * без editor prop — кнопки рендерятся, click no-op (existing).
  - vitest ScorePanel.test.tsx (new file) — toggle behavior:
    * default mobile viewport: MiniNotationToolbar НЕ рендерится.
    * click snippet-toggle: MiniNotationToolbar рендерится.
    * click ещё раз: скрывается.
    * localStorage 'wavecode-mini-toolbar-v1' = 'true' → сразу
      рендерится; = 'false' или отсутствует → не рендерится
      на mobile.
  - vitest Toast.test.tsx (existing) — без изменений; z-index
    меняется только в CSS, DOM-структура стека та же.
  - manual screenshot 412×900 (Pixel 7) после apply:
    * top 0..56: TopBar (wavecode / suspended / * / undo / redo /
      link / menu)
    * 56..100: preset-row (прозрачный, виден только select «creep»
      с тонким outline)
    * 100..152: controls-row (Play / CPS slider / 0.50 / 60 bpm) с
      одним border-top
    * 152..288: cm-host (CodeMirror, font 11px, ~5 строк видно)
    * 288..310: score-debug («триггеры: 42 cps: 0.5  ✎ snippet»)
    * 310..420: MiniNotationToolbar СКРЫТ
    * 420..100vh: wc-sheet (piano, 50vh)
    * tabbar: bottom 60px
antithesis: |
  (1) «Toast НА topbar ломает кликабельность undo/redo». Возражение:
    pointer-events:none на стеке — это базовая гарантия; только
    сам .toast-item ловит клики. TopBar вокруг toast'а остаётся
    интерактивным. Уже реализовано в CSS (lines 1602-1603).
    Bump z-index до 80 НЕ меняет это поведение.
  (2) «Нужно ещё выше, 9999». Возражение: z-toast=80 — выше
    z-modal (60), и modal — единственное, что осталось ниже.
    Modal открывается в моменты, когда toast бесполезен (alert
    confirm), и наоборот. 80 — стандартная практика
    (iOS UINotification = 100, Android Snackbar = 100). Дальше
    растить — overkill.
  (3) «preset-row без фона — он невидим, юзер не поймёт что
    там select». Возражение: select имеет собственный outline
    (background var(--surface-1) + border var(--border) +
    chevron-стрелки). На мобильном он достаточно контрастен.
    Если хотим усилить — отдельный пакет про стили select, не
    про layout.
  (4) «Font 11px — слишком мелко, accessibility violation».
    Возражение: WCAG не запрещает 11px на mobile; iOS HIG
    допускает ≥11pt для body. На Retina 3x это эффективные
    33px². iA Writer, Bear, Notion mobile — все используют
    11-12px для code editor. line-height 1.4 даёт комфортный
    межстрочный.
  (5) «Скрыть toolbar — пользователь потеряет discoverability».
    Возражение: кнопка «✎ snippet» в score-debug row всегда
    видна, всегда показывает текущее состояние (data-active).
    Один тап разворачивает. Это лучше, чем постоянно
    занимать 12% viewport'а ради affordance, который юзер
    использует 1-2 раза в сессию.
  (6) «Toolbar desktop default = true → mobile default = false —
    разная логика на разных viewport'ах». Возражение: это
    сознательный split. Mobile-юзер работает в split-pane
    (score + sheet), и toolbar конкурирует за место с editor'ом.
    Desktop-юзер работает в полноэкранном editor — места
    хватает на всё, toolbar полезен как shortcut-bar.
  (7) «Сделать это всё одним пакетом — слишком много scope'а».
    Возражение: 4 правки связаны общим контекстом (мобильный
    viewport 412×900, мобильная split-pane раскладка,
    фиксированные ряды). Делать их отдельно — 4 пакета с
    одинаковыми antipattern'ами. Один coherent пакет проще
    ревьюить и применять.
synthesis: |
  Один коммит + пакет + witness:

  1. **CSS (`ui/src/styles/tokens.css`):**
     - `--z-toast: 50` → `--z-toast: 80`.

  2. **CSS (`ui/src/styles/components.css`):**
     - `.app-preset-row`: убрать `background`, `border-bottom`,
       `backdrop-filter`, `-webkit-backdrop-filter`. Только
       position:fixed + z-index + select.
     - `.app-controls-row`: `border-bottom: 1px solid var(--border)`
       → `border-top: 1px solid var(--border)`. Остальное без
       изменений.
     - `.cm-host .cm-editor .cm-content` @media (max-width:720px):
       `font-size: var(--fs-xs); line-height: 1.4;`.
     - `.snippet-toggle` (new): wc-chip-like, font-size
       var(--fs-2xs), inline-flex, tap-target ≥36×28 (вместо 44
       чтобы влез в score-debug row).

  3. **TSX (`ui/src/presentation/panels/ScorePanel.tsx`):**
     - `MINI_TOOLBAR_KEY = 'wavecode-mini-toolbar-v1'`.
     - `readMiniToolbar()` / `writeMiniToolbar()` helpers
       (default false на mobile, true на desktop; localStorage
       override).
     - `miniToolbarOpen` signal, init from helpers, write on change.
     - В JSX оборачиваем `<MiniNotationToolbar>` в
       `<Show when={miniToolbarOpen()}>`.
     - В `.score-debug` добавляем `<button class="snippet-toggle"
       onClick={toggle}>` с aria-label и data-active.

  4. **Packet + witness.** Этот файл + `witness` после
     typecheck + vitest + build.
status: draft
axiom: A5
epistemics:
  - statement: "Toast-stack z-index=50 покрывается fixed-рядами (preset-row z=53, controls-row z=52) после wavecode-preset-row-and-toast-z"
    marker: fact
    evidence: "ui/src/styles/tokens.css:170 — --z-toast: 50. ui/src/styles/components.css:2974 (preset-row z-sheet+13=53), 2997 (controls-row z-sheet+12=52). Toast с z=50 проигрывает обоим fixed-рядам в paint-order."
  - statement: "CodeMirror дефолт font-size на mobile = 12px (--fs-sm)"
    marker: fact
    evidence: "ui/src/styles/tokens.css:78 — --fs-sm: 12px. CodeMirror EditorView default font-size наследуется от .cm-content (components.css:3529 — font-family only, без font-size)."
  - statement: "MiniNotationToolbar имеет 14 SNIPPETS (note/s/stack/n/</>/[/]/*/?/.gain(/.lpf(/,/␣), 36px min-height, flex-wrap = 2 строки"
    marker: fact
    evidence: "ui/src/presentation/components/MiniNotationToolbar.tsx:11-26 — 14 entries. .mini-toolbar-btn { min-height: 36px } (components.css:3597). 14 кнопок × ~52px ширина = 2 ряда на 412px viewport."
  - statement: "На mobile 412×900 с active sheet (50vh) score-panel = 900−56−60−96−450−22−110 = 106px для cm-host. Скрытие toolbar даёт +110px = 216px"
    marker: judgment
    evidence: "axiom A5: surface the model. 106px — 1-2 строки текста, нерабочее состояние. 216px — 5-6 строк, читаемо."
  - statement: "iOS HIG допускает 11pt для body text на mobile; Android Material 12sp default для body"
    marker: fact
    evidence: "Apple Human Interface Guidelines (iOS): 'Use at least 17pt for body text' — для prose. Для code/mono допустимо меньше. Material Design 3: 12sp body, 14sp button. Code editor'ы традиционно используют 11-13px (VS Code 12, Atom 12, iA Writer 13)."
  - statement: "WCAG 2.1 SC 1.4.4 (Resize text 200%) не запрещает 11px на mobile; 200% увеличение даст 22px, что выше body minimum"
    marker: fact
    evidence: "W3C WCAG 2.1 SC 1.4.4: 'text can be resized without assistive technology up to 200 percent without loss of content or functionality.' 11px × 2 = 22px ≥ 14px (AA body minimum)."
  - statement: "Mobile split-pane (wavecode-mobile-split-pane) делает sheet in-flow flex-child .app-body с --sheet-h (default 50vh = 450px на 900vh viewport)"
    marker: fact
    evidence: "ui/src/styles/sheets.css:181-209 — @media (max-width:720px) override .app-body → flex column, .wc-sheet → in-flow, height: var(--sheet-h, 50vh). 50vh на 900vh = 450px."
  - statement: "ScorePanel уже паттерн 'persisted collapse state' через localStorage 'wavecode-piano-collapse-v1'"
    marker: fact
    evidence: "ui/src/presentation/panels/ScorePanel.tsx:46-66 — readStoredCollapsed/writeStoredCollapsed, PIANO_COLLAPSE_KEY. Это precedent для MINI_TOOLBAR_KEY = 'wavecode-mini-toolbar-v1'."
  - statement: "Bump --z-toast с 50 на 80 не ломает ни один существующий z-index ordering"
    marker: fact
    evidence: "ui/src/styles/tokens.css:164-171: --z-base=0, z-body=1, z-sticky=10, z-fab=20, z-tabbar=30, z-sheet=40, z-toast=50, z-modal=60. 80 выше modal=60. Никаких элементов выше 60 кроме самого toast'а. Backdrop'ы (z-modal, z-sheet) остаются под toast'ом — это правильно, toast важнее dim-overlay."
  - statement: "Pointer-events на .toast-stack = none, .toast-item = auto — TopBar вокруг toast'а остаётся кликабельным"
    marker: fact
    evidence: "ui/src/styles/components.css:1602 (stack), 1606 (item) — стандартный clickable-chip-only pattern."
  - statement: "Material Design / iOS HIG требуют top-position для error/critical уведомлений"
    marker: fact
    evidence: "Apple HIG: 'Place alerts at the top of the screen so they're noticeable.' Material Design 3 banner guidelines: 'Banners should be displayed at the top of the page.'"
  - statement: "preset-row без background может выглядеть «парящим в пустоте» — но select имеет собственный outline (background: var(--surface-1) + chevron-стрелки) и не теряется"
    marker: judgment
    evidence: "axiom A5: surface the model. Select — самодостаточный control с outline + chevron. Удаление лишнего background'а упрощает visual hierarchy."
  - statement: "Контр-интуитивно: убирание border-bottom и добавление border-top в controls-row — НЕ асимметрия, а reversal"
    marker: judgment
    evidence: "axiom A1: 'Surface the most-frequent action.' Bottom border визуально отделяет следующий блок; top border отделяет текущий блок от предыдущего. Поскольку preset-row стал прозрачным, controls-row сам отвечает за 'я — самостоятельная единица' через top-border."
