---
proposition: |
  Когда открыт любой bottom-sheet (AI / Step / Piano / Mixer /
  Status), транспорт-панель с Play/Stop уезжает из видимости —
  sheet перекрывает её, и юзер теряет возможность остановить
  воспроизведение.

  В компонентах уже есть mobile-only `position: sticky` на
  `.app-controls-row` (components.css:2776), но он не
  работает: родитель `.wc-app` имеет `height: 100%` без
  `overflow`, sticky pinning требует scroll-контекст. В
  результате rule — no-op, и при открытом sheet транспорт
  скрыт под ним.

  Решение: перевести `.app-controls-row` в `position: fixed`
  + `z-index` выше sheet-стэка + blur-фон. Фиксированное
  позиционирование гарантирует видимость независимо от
  scroll-контекста, blur-фон отделяет визуально от
  контента под ним.

  Поправка layout: убрать из flow + компенсировать
  padding-top на .app-body (или main), чтобы контент
  не уходил под транспорт.
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
  Три правки в components.css:

  1. **`.app-controls-row`** (replace existing rules):
     - `position: fixed; top: var(--header-h); left: 0; right: 0;`
     - `z-index: calc(var(--z-sheet) + 12);` (выше sheet, tabbar,
       toolstrip — все три < 12)
     - `background: rgba(10, 10, 14, 0.92);` + `backdrop-filter:
       blur(12px) saturate(160%);` (отделяет визуально)
     - `padding: var(--space-xs) var(--space-md);`
     - `border-bottom: 1px solid var(--border);`
     - убрать mobile @media — правило универсально

  2. **`.app-body`** (modify):
     - добавить `padding-top: var(--controls-h);` чтобы
       контент не уходил под фикс-транспорт.

  3. **`:root`** (modify, в tokens.css):
     - добавить `--controls-h: 52px;` (высота транспорта
       включая padding).

  Verification:
    - typecheck: clean
    - vitest: 632/632
    - build (vite): success
    - smoke test (playwright): открыть AI sheet через
      BottomToolstrip, проверить:
      - транспорт виден поверх sheet (z-index check)
      - Play button clickable когда sheet открыт
      - `document.elementFromPoint(play-x, play-y)` ==
        play button (не перекрыт)
    - visual: на desktop и mobile (resize viewport 360×640)
      транспорт не съезжает с контентом
status: draft
---