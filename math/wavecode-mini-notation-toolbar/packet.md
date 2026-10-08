---
proposition: |
  В Score-панели между `.cm-host` и редактором — sticky toolbar
  `<div class="mini-toolbar">` с 14 крупными кнопок (button min 44×36px,
  font 16px monospace): `note(`, `s(`, `stack(`, `n(`, `<`, `>`,
  `[`, `]`, `*`, `?`, `.gain(`, `.lpf(`, `,`, ` ` (space). Tap =
  view.dispatch с insert snippet в cursor position, focus
  возвращается в editor. Toolbar позиционируется через
  `visualViewport` API — listening resize, ставит `bottom` так,
  чтобы toolbar был над vkb. На desktop toolbar НЕ показывается
  (window.innerWidth ≥ 720 OR визуальная vkb скрыта).
antithesis: |
  (1) iOS Safari иногда меняет visual viewport async, toolbar
    «прыгает». Решение: debounce 100ms на resize listener +
    use `visualViewport.offsetTop` (стабильно). (2) Custom keyboards
    нельзя сделать (Apple блокирует). Toolbar не custom keyboard
    — это strip поверх native vkb, что Apple разрешает. (3) На
    desktop toolbar полезен (mouse-snipping), но window space
    критичен. Решение: только mobile breakpoint OR `inputmode=vkb`
    when editor focused. (4) Редактор keyboard shortcut (Tab) для
    autocomplete конфликтует с toolbar buttons. Решение: toolbar
    buttons живут ВНЕ editor focus context, не conflict. (5)
    `view.dispatch` от вставки toolbar теряет undo history
    отдельно от typing. — нет: dispatch проходит через тот же
    updateListener, undo path стандартный. (6) На multi-line
    editor cursor должен быть visible ПОСЛЕ insert — view.scrollIntoView
    необходим если cursor вне viewport.
synthesis: |
  Sticky strip ВЫШЕ vkb на mobile, tabbed показатель OFF по
  breakpoint. Используем `visualViewport.offsetTop + .height` для
  desktop-like bottom-positioning; pure CSS `@media (max-width:720px)`
  для show/hide. Каждая кнопка = маленькая команда из 4-7 chars,
  соответствует ровно одной вставке в cursor. Selection replace
  если есть selected range; insert в cursor иначе. Это replacement
  для vkb-typing боли при написании Strudel mini-notation на iPhone.
substrate: |
  + `presentation/components/MiniNotationToolbar.tsx` (new):
    Solid компонент, render buttons grid, mobile-only через
    `matchMedia('(max-width: 720px)')`.
  + `presentation/components/CodeMirrorEditor.tsx`: рефактор
    — expose `viewRef` через callback prop, чтобы toolbar
    мог `dispatch` через `view.dispatch`. Существующий
    `view` остается in-closure, дополнительный
    `getView(): EditorView` для imperative API.
  + `ScorePanel.tsx`: рендер `<MiniNotationToolbar />` СРАЗУ
    ПОД `<CodeMirrorEditor />` в DOM, но `display: flex` +
    `order` через media query (на mobile — выше editor, на
    desktop — none).
  + `index.css`: `.mini-toolbar` (flex wrap, padding 4px,
    overflow-x auto); `.mini-toolbar-btn` (44px tall, 36px wide);
    `@media (max-width: 720px)` — show,
    `@media (min-width: 721px)` — display: none.
    `.mini-toolbar[data-vkb-visible="true"]` — fixed positioning
    над vkb через `inset-block-end: calc(100vh -
    var(--visual-viewport-height))`.
  + `MiniNotationToolbar.tsx`: приём `getView` prop от
    CodeMirrorEditor через imperative handle. Listener
    `window.visualViewport.addEventListener('resize')` →
    set CSS-var `--visual-viewport-height`.
  − ничего не удалено. CodeMirror dispatch — additive к
    `updateListener`.
status: draft
axiom: A1
epistemics:
  - statement: "iOS Safari `visualViewport` API поддерживается
      с iOS 13+, дает `offsetTop/offsetLeft/width/height` для
      visual region (выше vkb)"
    marker: fact
    evidence: "Apple WebKit docs — `VisualViewport` API;
      Stable в iOS Safari 13 (2019); standard W3C spec"
  - statement: "Toolbar height ≈ 50px, 14 buttons в 2-3 rows;
      visual viewport height typical iPhone 14 = 692pt portrait
      (vkb hidden), ~388pt landscape — toolbar занимает 50pt = ~5%"
    marker: fact
    evidence: "iPhone 14 device-pixel = 390×844; portrait
      visualViewport height ≈ 692pt когда vkb hidden (844 - 152
      top bar/safe area)"
  - statement: "CodeMirror 6 `view.dispatch({changes: ...})` —
      единственный путь mutate doc; tap-button → instant insert
      без потери history state"
    marker: fact
    evidence: "@codemirror/view docs — `EditorView.dispatch`
      принимает `TransactionSpec` с `changes`/`selection`/`effects`"
  - statement: "Custom keyboards (Apple `inputViewController`)
      НЕ возможны в web; custom actions в vkb (like space
      replacement) — НЕ возможны. Toolbar — workaround"
    marker: fact
    evidence: "Apple WebKit docs — стандартные vkb input modes
      keyword/text/numeric/etc., не customizable в iOS Safari"
  - statement: "14 buttons маленькие — каждая вставляет ≤7 chars;
      у Strudel mini-notation короткие примитивы: `<a b c>` —
      7 chars ровно удобно tap-insert"
    marker: fact
    evidence: "Strudel docs — mini-notation operators `<>[]*?`
      1-2 chars; function syntax `note(` 5 chars — все в toolbar
      buttons"
  - statement: "На desktop toolbar НЕ нужен: физическая клавиатура
      быстрее; mobile breakpoint — `@media (max-width:720px)`"
    marker: fact
    evidence: "iPad Air portrait = 820pt = above 720; iPhone
      Pro Max = 430pt < 720. Логика breakpoint covers iPhone"
  - statement: "vscode.dev / replit.com mobile UI — тоже использует
      sticky toolbar поверх vkb для кодинга; pattern known"
    marker: fact
    evidence: "github.dev mobile views — code-strip below editor,
      sticky to viewport"
  - statement: "CodeMirror dispatch через toolbar buttons проходит
      через тот же `updateListener` — `replaceScore` срабатывает,
      IDB сохраняется автоматически; undo stack видит вставку"
    marker: fact
    evidence: "CodeMirrorEditor.tsx:44-46 — `EditorView.updateListener.
      of` callback говорит `props.onChange(...)` on every doc change"
---
