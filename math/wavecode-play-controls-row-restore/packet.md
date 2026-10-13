---
proposition: |
  Play/Stop-кнопка в текущем master регрессировала визуально
  относительно synthesis пакета `math/wavecode-play-in-control`:

  - Реализация `74fb853 feat(play-control): Play/Stop moved from
    FAB to TransportPanel` оставила `<TransportPanel>` внутри
    `<PresetRow>` (`ui/src/presentation/components/app/PresetRow.tsx:69-74`),
    хотя packet прямо требовал: «sibling **ПОСЛЕ** `<PresetRow />`,
    чтобы Play был отдельно от пресет-chips»
    (`packet.md substrate:86-88`).
  - До этого была либо крупная FAB 56px (`019e9f6`, Oct 10), либо
    отдельная строка `.app-controls-row` с текстовыми «▶ Запуск / ■ Стоп»
    (`378736d refactor(ui): restructure header`, Oct 1). Обе были
    визуально заметны с первого взгляда.
  - Сейчас: маленькая иконка 32×32px последним child'ом в `.app-preset-row`,
    легко пропускается взглядом. Юзер жалуется «Play была наверху —
    теперь её нет».

  Корень проблемы — отступление от synthesis без обоснования. CSS уже
  содержит `.app-controls-row` (`ui/src/styles/legacy.css:76-83`), то есть
  layout-инфраструктура готова.

  Решение: вернуть `<TransportPanel>` отдельной строкой `.app-controls-row`
  сразу после `<PresetRow />`, как требовал synthesis. На мобиле —
  sticky `.app-controls-row` (там живёт Play, без него юзер не сможет
  остановить композицию при открытом AI-BottomSheet).
antithesis: |
  (1) «Вынести TransportPanel из PresetRow — лишнее визуальное
  усложнение; toolbar должен быть одним блоком». Возражение:
  synthesis packet уже выбрал это решение осознанно: «транспорт-row
  отделён от .app-preset-row чтобы иметь свой z-index». Разные
  z-index — это разный layout-контекст. PresetRow = пресеты (низкий
  приоритет), ControlsRow = управление (высокий приоритет).
  (2) «Сейчас TransportPanel внутри PresetRow + sticky на мобиле
  работает». Возражение: работает, но Play мелкая и в глаза не
  бросается. Sticky помогает доступности, но не visibility. UX —
  архитектура (axiom A4).
  (3) «Это отступление от packet synthesis — должен быть новый
  packet». Возражение: этот packet именно это и фиксирует.
  (4) «Зачем менять layout если функционально работает?». Возражение:
  функционально — да. Визуально — регрессия к худшей версии.
  Юзер жалуется. Возврат к synthesis packet — единственный
  обоснованный путь.
synthesis: |
  Четыре правки:

  1. **`ui/src/App.tsx`** (modify): вынести `<TransportPanel>` из
     `<PresetRow>`, добавить новый `<div class="app-controls-row">`
     с `<TransportPanel ... />` сразу после `<PresetRow />`. Props
     `audioRunning`/`audioStarting`/`onPlay`/`onStop` поднимаются
     на уровень AppShell и пробрасываются напрямую в TransportPanel.

  2. **`ui/src/presentation/components/app/PresetRow.tsx`**
     (modify): удалить импорт `TransportPanel` и props
     `audioRunning`/`audioStarting`/`onPlay`/`onStop`. JSX упрощается
     — остаются только preset-select, spacer, chips (Step/Piano/440/220).

  3. **`ui/src/styles/legacy.css`** (modify):
     - Удалить `position: sticky` у `.app-preset-row` (mobile ≤720px).
       Больше не нужен — Play ушёл из PresetRow.
     - Добавить `.app-controls-row` mobile-sticky:
       `top: var(--header-h);` (та же позиция, где раньше был PresetRow).
     - Padding/background/backdrop-filter как у старого `.app-preset-row`
       sticky (rgba(10,10,14,0.92) + blur).

  4. **Тесты**: e2e-селекторы остаются прежними
     (`[data-testid="transport-play-btn"]`),
     расположение в DOM меняется — Play теперь на одну строку ниже
     пресет-chips, не внутри них. Существующий `play-control.spec.ts`
     (если есть) и `TransportPanel.test.tsx` остаются валидными.
     В vitest TransportPanel.test.tsx — props не зависят от
     позиции в DOM, тесты остаются.

  Visual (desktop ≥720px):
    ┌─────────────────────────────────────────────┐
    │ TopBar                                       │
    ├─────────────────────────────────────────────┤
    │ preset-select  · Step · Piano · 440 · 220    │
    ├─────────────────────────────────────────────┤
    │ [▶] cps──── 0.50  · 60 BPM · swing─ 0.00 1/8 │
    │ 60 120 240                                   │
    └─────────────────────────────────────────────┘
    Play — самый левый sub-control в `.app-controls-row`,
    не теряется среди пресет-chips.

  Visual (mobile ≤720px):
    TopBar — sticky top:0.
    .app-preset-row — обычная строка (без sticky).
    .app-controls-row — sticky top: var(--header-h), backdrop blur.
    При открытом AI-BottomSheet — Play остаётся виден (sticky).
status: draft
witness:
  applied_at: pending
  commit: pending
  notes: |
    To be populated after implementation.
    Verification:
      - Play видна в `.app-controls-row` отдельной строкой
      - На мобиле Play sticky под TopBar
      - E2E test "click play → bpm-indicator moves" проходит
      - vitest TransportPanel.test.tsx все 7 кейсов проходят
      - typecheck clean
---