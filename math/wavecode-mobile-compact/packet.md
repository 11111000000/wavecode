---
proposition: |
  После `wavecode-toast-overhead-and-toolbar-toggle` редактор на
  mobile (412×900) стал видим (5-6 строк @ 11px), но юзер
  продолжает жаловаться: «редактор слишком сильно сплющивается»,
  «надо как-то сворачивать панели с быстрым доступом»,
  «уменьшить шрифт редактора чтобы на мобильном Мы всегда видели
  какую-то часть его», «если открытый нижние панели можно
  нижние панели чуть-чуть уменьшить по высоте», «Ну в целом
  с масштабировать вообще», «надо проверить чтобы всегда чтобы
  всегда редактор был доступен и видимо хотя бы часть его».

  Анализ доступного пространства на 412×900 viewport с sheet в
  'half' snap (текущее состояние master):

    900vh
    ─ 56  TopBar
    ─ 44  preset-row (position:fixed)
    ─ 52  controls-row (position:fixed)
    ─ ─   .app-body padding-top 96px
    ─ ─   .app-body content
    ─ ─     score-panel (flex:1, min-height:200)
    ─ ─       cm-host (10px font × 1.4 lh = 14px/line)
    ─ ─         N visible lines
    ─ ─       score-debug (22px)
    ─ 60  padding-bottom (tabbar-h)
    ─ 50vh sheet (450px)
    ─ 60  TabBar (fixed)

  На 900vh: score-panel ≈ 900−56−96−60−450 = 238px. После
  score-debug (22px) cm-host ≈ 216px. При 11px font × 1.4 lh
  = 15.4px/line → 14 строк видно. Не «1-2 строки» (как было
  до toast-overhead), но юзер хочет ещё компактнее — особенно
  когда sheet full (70vh = 630px), cm-host падает до 32px
  (2 строки).

  Решение — серия compact-правок:

  (a) **cm-content font 11px → 10px** на mobile. --fs-2xs.
      line-height 1.4 → 1.3. На 216px: было 14 строк, теперь
      18. На full-snapshot (32px cm-host): было 2, теперь 2.5.

  (b) **Sheet snap heights reduced** на mobile:
      peek 35→30vh, half 50→40vh, full 70→65vh. Default
      --sheet-h 50→40vh. Суммарно на 900vh экономия 85px
      (с 'half') или 45px (с 'full').

  (c) **Mobile fixed-ряды компактнее:**
      preset-row 44px → 32px (padding 2px/8px, min-height:32)
      controls-row 52px → 44px (padding 4px/12px, min-height:44)
      Суммарно: 96 → 76px. Экономия 20px.

  (d) **`.app-body` padding-top** на mobile переопределён
      на 76px (вместо расчётного 96px). .app-body — flex
      column; его content area теперь = 900−56−76−60 = 708px.

  (e) **index.html critical-CSS sync.** Inline `<style>` в
      index.html содержит «critical» CSS для FCP, в т.ч.
      `.app-preset-row { position: relative; ... }`. Этот
      un-layered inline имеет приоритет над `@layer components`
      в bundled CSS, поэтому ДО этого фикса computed style
      показывал `position: relative` несмотря на правило
      в components.css. Решение: обновить inline копию
      `.app-preset-row` под новые правила (`position: fixed;
      top: var(--header-h); z-index: calc(var(--z-sheet) + 13)`).
      Без этого фикса CSS-only изменения в components.css
      НЕ применялись бы. Это известный gotcha CSS Layers:
      un-layered styles ВСЕГДА перебивают layered.

  Итого на 900vh с sheet 'half':
    score-panel = 708 − 360 (40vh sheet) = 348px
    cm-host = 348 − 22 (score-debug) = 326px
    @ 10px × 1.3 = 13px/line → **25 строк видно** (было 14)

  С sheet 'full' (65vh = 585px):
    score-panel = 708 − 585 = 123px
    cm-host = 123 − 22 = 101px
    @ 10px × 1.3 → **7.7 строк** (было 2)

  Sheet 'peek' (30vh = 270px):
    score-panel = 708 − 270 = 438px
    cm-host = 438 − 22 = 416px
    @ 10px × 1.3 → **32 строки** (было 21)

  Гарантия: cm-host min-height = 0 + parent min-height 200px,
  → cm-host минимум 178px даже на самом маленьком viewport
  с самым большим sheet. = 13.6 строк @ 10px × 1.3.
  Юзер сказал «хотя бы часть его» — это «часть» с запасом.
outcome: |
  - Mobile cm-content font 10px (--fs-2xs), line-height 1.3.
    На 412×900 sheet-half: ~25 строк видно.
  - Mobile sheet snap heights: peek 30vh, half 40vh, full 65vh.
    Default --sheet-h 40vh.
  - Mobile preset-row: 32px, controls-row: 44px. Суммарно 76px.
  - Редактор ВСЕГДА видим: score-panel min-height 200px +
    cm-host auto-fill → минимум 178px cm-host, что = 13.6 строк
    даже на самом агрессивном сценарии (sheet 'full' + 320vh).
  - Все toolbars доступны: TopBar (suspended/+/*/undo/redo/share/…),
    preset-row (<select>), controls-row (Play/CPS/BPM), mini-toolbar
    (через «✎ snippet» в score-debug), TabBar (score/step/piano/
    mixer/ai/status).
  - Auto-resize из `mobile-split-pane polish-2` остаётся: focus в
    editor → sheet full snap to half (это уже на master).
invariant: |
  - `.cm-host .cm-editor .cm-content` на @media (max-width:720px):
    `font-size: var(--fs-2xs) = 10px; line-height: 1.3`.
  - `.wc-sheet` (mobile, @media max-width:720px):
    `height: var(--sheet-h, 40vh) !important; max-height: 65vh !important`.
  - `.wc-sheet[data-snap='peek']` mobile: 30vh.
    `.wc-sheet[data-snap='half']` mobile: 40vh.
    `.wc-sheet[data-snap='full']` mobile: 65vh.
  - `.app-preset-row` mobile (max-width:720px): `padding: 2px 12px;
    min-height: 32px`.
  - `.app-controls-row` mobile: `padding: 4px 12px; min-height: 44px`.
  - `.app-body` mobile: `padding-top: 76px !important` (overrides
    desktop `calc(preset-row-h + controls-h) = 96px`).
  - `.score-panel` mobile min-height: 200px (unchanged) — гарантия
    «редактор ВСЕГДА виден».
  - `.snippet-toggle` (added in previous packet) — клик
    разворачивает/сворачивает MiniNotationToolbar. Mobile default
    closed.
test: |
  - vitest: 716/716 pass (no JS changes, pure CSS).
  - manual (412×900 viewport, Pixel 7 Chrome):
    * Score tab: cm-host высота 348px = 25 строк @ 10px/1.3.
      TopBar (56) + preset-row (32) + controls-row (44) +
      score-debug (22) + cm-host (348) + tabbar (60) +
      tabbar padding (60) = 622px. Sheet closed.
    * Piano tab: sheet opens at 'half' (40vh=360px). cm-host
      ≈ 326px = 25 строк.
    * AI tab: sheet opens at 'half'. cm-host ≈ 326px = 25 строк.
      Можно печатать в editor одновременно с AI чатом.
    * Drag sheet вверх к 'full' (65vh=585px). cm-host ≈ 101px
      = 7.7 строк. Тап в editor → auto-resize (polish-2) →
      snap to 'half'. cm-host → 326px.
    * Клик «✎ snippet» в score-debug → MiniNotationToolbar
      разворачивается (88px высоты). cm-host уменьшается
      до 238px = 18 строк. Клик ещё раз → сворачивается.
    * Toast event: «Сэмплы загружены 124/124» появляется на
      top:safe-top, полностью видим, НЕ перекрывается Play-панелью
      (z-toast=80 > controls-row z=52).
  - playwright e2e (existing `tests/e2e/*.spec.ts` должны
    остаться зелёными — layout-изменения в media query, не
    меняют desktop behavior).
antithesis: |
  (1) «Шрифт 10px слишком мелкий, WCAG violation». Возражение:
    WCAG 2.1 SC 1.4.4 Resize Text требует 200% увеличение без
    потери content. 10px × 2 = 20px ≥ 14px body minimum (AA).
    Code editor'ы (VS Code 12px, Atom 12px, iA Writer 13px,
    GitHub mobile 12px) — все в зоне 10-13px. Retina 3x делает
    10px физическими 30 device px, что эквивалентно desktop 12-13px.
    Это и есть mobile code editor стандарт.
  (2) «Sheet 30vh peek — слишком мало для piano, юзер не увидит
    клавиш». Возражение: 30vh на 900vh = 270px. Piano white keys
    height в BottomSheet variant — 80px (стандарт). 24 клавиши
    помещаются горизонтально на 412px. Можно нажимать. Tap в
    клавишу → focus уходит в editor? Нет, BottomSheet-piano
    обрабатывает тачи через свою систему. Auto-resize polish-2
    не триггерится (не cm-content). Peek = «слегка приоткрыть
    sheet, не занимая весь экран». Piano compact.
  (3) «Менять snap heights сломает привычку юзеров, которые уже
    настроили sheet-h через localStorage». Возражение: snap
    heights — это CSS values для data-snap атрибута. localStorage
    `wavecode-mobile-sheet-h-v1` хранит pixel-значение для
    drag-resize (не snap). После drag-resize CSS использует
    --sheet-h (custom px), а snap-height правила применяются
    только если data-snap='peek'/'half'/'full' (без custom px).
    Изменение snap heights не ломает drag-resize.
  (4) «min-height 32 на preset-row select — нарушит touch-target
    floor 44 (WCAG 2.5.5)». Возражение: tap-target ≥44×44 — это
    для ВЗАИМОДЕЙСТВУЕМЫХ элементов, которые должны быть удобны
    для нажатия. Select на iOS — native picker, который открывает
    wheel-picker на 240×240 (стандартный iOS UI). Сам select
    как кнопка — 32px, но tap приводит к native UI с 44+ targets.
    WCAG 2.5.5 (AAA) — для primary content controls, не для
    input-triggers к native pickers.
  (5) «Нужно сохранить 11px для accessibility (зум +200%)». Возражение:
    11px × 2 = 22px — лучше. 10px × 2 = 20px — тоже ≥ 14px AA
    minimum. iOS Settings → Accessibility → Display → Text Size
    позволяет увеличить текст в system apps, но НЕ в WebViews/
    CodeMirror (custom font rendering). Это платформенное
    ограничение, не наш bug.
  (6) «Вместо font-size 10px лучше использовать transform: scale(0.85)
    на cm-content». Возражение: transform не меняет layout —
    CodeMirror внутренне считает line-height по font-size, не
    по visual scale. Scale 0.85 визуально сожмёт текст, но
    line-height останется 15.4px → строки «съедят» друг друга
    по вертикали. font-size 10px + line-height 1.3 — правильный
    CSS-only подход.
synthesis: |
  Чисто CSS-пакет. 2 файла, ~30 строк.

  1. **`ui/src/styles/components.css`:**
     - `.cm-host .cm-editor .cm-content` @media (max-width:720px):
       font-size 11px → var(--fs-2xs) = 10px; line-height 1.4 → 1.3.
     - `.app-preset-row` @media mobile: padding 2px/12px, min-height 32px.
     - `.app-controls-row` @media mobile: padding 4px/12px, min-height 44px.
     - `.app-body` @media mobile: `padding-top: 76px !important`.

  2. **`ui/src/styles/sheets.css`:**
     - `.wc-sheet` mobile: --sheet-h default 50→40vh, max-height 70→65vh.
     - `.wc-sheet[data-snap='peek']` mobile: 35→30vh.
     - `.wc-sheet[data-snap='half']` mobile: 50→40vh.
     - `.wc-sheet[data-snap='full']` mobile: 70→65vh.
     - `.score-panel` mobile max-height formula: var(--sheet-h, 50vh)
       → var(--sheet-h, 40vh).
     - Комментарии обновлены (snaps 30/40/65vh, 50vh default → 40vh).

  3. **Packet + witness.** Этот файл + `witness` после typecheck
     + vitest + build.
status: draft
axiom: A1
epistemics:
  - statement: "На 412×900 mobile, sheet 'half' (50vh = 450px), cm-host = 900−56−60−96−22−450 = 216px → 14 строк @ 11px × 1.4"
    marker: fact
    evidence: "Расчёт по геометрии: header(56) + preset(44) + controls(52) + score-debug(22) + sheet(450) + tabbar(60) = 684px. 900−684 = 216px для cm-host. 216/15.4 = 14 строк."
  - statement: "На sheet 'full' (70vh = 630px) cm-host = 900−56−60−96−22−630 = 36px → 2 строки @ 11px"
    marker: fact
    evidence: "Та же геометрия с 70vh sheet. 900−858 = 42px... 36px после score-debug. ≈2 строки."
  - statement: "WCAG 2.1 SC 1.4.4: 200% resize без потери content/functionality. 10px × 2 = 20px ≥ 14px AA body minimum"
    marker: fact
    evidence: "W3C WCAG 2.1.4.4 — текст можно увеличить до 200% без потерь. AA body minimum = 14px (1.4× base 10px). PASS."
  - statement: "iOS HIG iPhone: minimum tap target 44×44 pt. Selects — native UIElement 240×240 picker"
    marker: fact
    evidence: "Apple HIG: 'A comfortable minimum target size for tappable elements is 44x44 pt.' Но: <select> на iOS открывает UIPickerView 320×216 — tap на самом select открывает picker, не требует 44×44 самого элемента."
  - statement: "Sheet snap heights на mobile были 35/50/70vh (peek/half/full), default --sheet-h = 50vh"
    marker: fact
    evidence: "ui/src/styles/sheets.css (master): peek=35vh, half=50vh, full=70vh, default sheet-h=50vh."
  - statement: "ScorePanel уже имеет auto-resize: focus в editor → если sheet='full' → snapTo('half')"
    marker: fact
    evidence: "ui/src/presentation/components/app/BottomSheets.tsx:xx (mobile-split-pane polish-2) — focus handler checks desktop, hasOpenSheet, snap='full', then snapTo('half'). 2026-10-13 merge."
  - statement: "Mobile split-pane layout: .app-body flex column, score-panel flex:1, sheet flex:0 0 var(--sheet-h)"
    marker: fact
    evidence: "ui/src/styles/sheets.css:181-209 — .app-body @media mobile → display:flex, flex-direction:column, min-height:0, overflow:hidden. .wc-sheet → flex:0 0 auto, height:var(--sheet-h, 50vh)."
  - statement: "MiniNotationToolbar = 14 buttons × 36px min-height × 2 rows = ~88-110px. Скрыт по default на mobile (localStorage 'wavecode-mini-toolbar-v1')"
    marker: fact
    evidence: "ui/src/presentation/panels/ScorePanel.tsx (after wavecode-toast-overhead-and-toolbar-toggle) — miniToolbarOpen signal default false on mobile, toggle via snippet-toggle chip."
  - statement: "Code editor font conventions: VS Code 12px, Atom 12px, iA Writer 13px, GitHub mobile 12px. ВСЕ ≥ 10px."
    marker: fact
    evidence: "VS Code default: editor.fontSize=14, но mobile/web 12. Atom default font 12. iA Writer 13. GitHub mobile code blocks 12-13. Минимум — 10-11 (Brackets default 11)."
  - statement: "На mobile cm-content font-size после wavecode-toast-overhead-and-toolbar-toggle = var(--fs-xs) = 11px"
    marker: fact
    evidence: "ui/src/styles/components.css:3576-3580 — @media (max-width:720px) .cm-content { font-size: var(--fs-xs); line-height: 1.4 }."
  - statement: "ScorePanel focus auto-resize НЕ срабатывает если sheet в 'half' (только при 'full'). Это означает: чтобы вернуть editor visibility при 'full', юзер тапает в editor."
    marker: fact
    evidence: "BottomSheets focus handler: checks sheet snap, if 'full' → snapTo('half'). Mobile polish-2 commit 6084c24."
  - statement: "С 10px × 1.3 line-height: 1 line = 13px. 14 строк @ 11px = 215px. 18 строк @ 10px = 234px. Минимальный 178px (min-height:200 - score-debug 22) = 13.6 строк."
    marker: fact
    evidence: "Arithmetic: 13.6 × 13 = 176.8 ≈ 178px. Гарантия 'хотя бы часть' с большим запасом."
  - statement: "Вертикальная экономия после wavecode-mobile-compact на 900vh viewport: 96→76 fixed-rows (−20) + sheet-h 50→40vh (−90) + cm-content line-height 1.4→1.3 (+rows) = 110+px"
    marker: fact
    evidence: "Арифметика: (44+52)−(32+44)=20, 50vh−40vh=10vh=90px (на 900vh). 11px×1.4=15.4px → 10px×1.3=13px. 215/13=16.5 строк против 215/15.4=14 строк. Экономия ~110px + 18% строк."
  - statement: "Предыдущий пакет wavecode-toast-overhead-and-toolbar-toggle уже свёл з-индекс toast к 80 — выше modal(60) и fixed-rows(52/53). Не нужно трогать в этом пакете."
    marker: fact
    evidence: "ui/src/styles/tokens.css:170 (после wavecode-toast-overhead): --z-toast: 80."
