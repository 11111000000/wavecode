---
proposition: |
  **Два связанных дефекта от недавней работы:**

  1. **Play panel исчезает под bottom-sheet.** Mobile-only
     `position: sticky` на `.app-controls-row` (legacy rule)
     не работает: `.wc-app` — `height: 100%` без `overflow`,
     sticky требует scroll-контекст. В результате sheet
     (AI/Step/Piano/Mixer/Status) перекрывает транспорт,
     юзер теряет возможность остановить воспроизведение.

  2. **Legacy duplicate CSS rules silently override modern.**
     Пакет `wavecode-legacy-eat-all` перенёс секцию PIANO &
     STEP GRID из `legacy.css` в конец `components.css`. Но
     `.step-grid*` (8 классов) и `.piano-key` уже были в
     components.css раньше! Из-за source-order cascade
     legacy-стили (с другими значениями gap, padding, grid
     template) ПОБЕЖДАЮТ современные. Step Grid сейчас
     рендерится с legacy visual design вместо нового.
     `.piano-keyboard` container — dead code (DOM использует
     `.piano-keys`, не `.piano-keyboard`).

  Решение для #1: `position: fixed; top: var(--header-h);
  z-index: calc(var(--z-sheet) + 12)` + blur фон. Гарантирует
  видимость независимо от scroll-контекста.

  Решение для #2: удалить legacy duplicate секцию (строки
  3360-3485 в components.css) — это PIANO & STEP GRID
  секция, перенесённая из legacy-eat-all. Modern секции
  (строки 837-908 step-grid, 1196-1232 piano-key) уже в файле
  и теперь снова выигрывают cascade.
antithesis: |
  (1) «Sticky должен работать в современных браузерах даже
  без overflow на parent». Возражение: да, но элемент
  приклеивается к top of nearest scrollable ancestor. Если
  ancestor не scrollable, sticky элемент остаётся в flow, не
  pinned. Текущее поведение — ровно это.
  (2) «Position fixed сожмёт layout — куда денется место?».
  Возражение: добавим `padding-top: var(--controls-h)` на
  .app-body (или main), чтобы контент не уехал под фикс.
  Height фиксирован (~52px), content compact.
  (3) «Лучше добавить Play в BottomToolstrip — он уже fixed,
  всегда виден». Возражение: BottomToolstrip — для «tools»,
  Step/Piano/Mixer. Play — это не tool, это primary
  action. Смешение ломает mental model. Отдельный
  transport row с правильным z-index — точнее.
  (4) «Регрессия на desktop?». Возражение: на desktop
  sheets не используются активно (max-height covers full
  panel). Фикс-стиль универсален, применяется на всех
  breakpoints. Bottom-sheet mode — mobile-first, но Play
  нужен везде.
synthesis: |
  Два коммита:

  1. **`fix(ui): TransportPanel position:fixed below TopBar —
     always accessible`** (committed):
     - `.app-controls-row` → `position: fixed; top: var(--header-h);
       left: 0; right: 0; z-index: calc(var(--z-sheet) + 12);` +
       blur фон.
     - `.app-body` → `padding-top: var(--controls-h);`
     - tokens.css → `--controls-h: 52px;`
     - mobile @media (max-width: 720px) удалён — правило
       универсально.

  2. **`fix(ui): drop legacy duplicate PIANO & STEP GRID section
     from components.css`** (this commit):
     - delete lines 3360-3485: duplicate `.piano-key` (8
       occurrences), `.step-grid`, `.step-grid-toolbar`,
       `.step-grid-rows`, `.step-grid-row`, `.step-grid-row-label`,
       `.step-grid-row-sample`, `.step-grid-row-name`,
       `.step-grid-btn`, plus dead `.piano-keyboard` container.
     - Modern definitions (lines 837-908 for step-grid, 1196-1232
       for piano-key) remain and now correctly win cascade.

  Verification:
    - typecheck: clean
    - vitest: 632/632
    - lint: 2 errors (preexisting, unchanged)
    - build (vite): success
    - smoke test (playwright):
      * Open AI dialog (via TabBar AI button) — verify
        `document.elementFromPoint(play-x, play-y)` returns
        the play button (z-index 52 effective).
      * Open Step Grid bottom-sheet — verify .step-grid*
        rendered with modern styles (smaller buttons, line-height
        tweak, grid-template 56px col not 64px).
      * Open Piano dialog — verify .piano-key.white has CSS-var
        based width/height (80px / 220px) not legacy 96px
        height.
status: applied
---