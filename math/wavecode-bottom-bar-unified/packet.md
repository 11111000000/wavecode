---
proposition: |
  BottomToolstrip (отдельный fixed-bar над TabBar с 3 кнопками
  step/piano/mixer) — архитектурный долг: на mobile-вьюпортах
  `<639px` лейблы скрываются, иконки растворяются в тёмной теме,
  z-index-конфликт с MiniNotationToolbar. Юзер не находил кнопки
  в живой системе. Дизайн-интент — «всё в один нижний бар».

  Сливаем toolstrip в TabBar: 6 табов = score, step, piano,
  mixer, ai, status. BottomToolstrip удаляется. Каждый таб
  дёргает setTab(id), который уже умеет открывать соответствующий
  BottomSheet (chat→ai, mixer→mixer, status→status, score→close).
  Расширяем setTab ветками step→step-sheet, piano→piano-sheet.
  MIDI остаётся в ScorePanel (MidiIOButtons) — file I/O, не
  bottom-sheet.

  Layout на 360px-вьюпорте: 6 табов × 60px ≈ 360px — впритык
  но влезает. Иконка 20px + label 11px (как сейчас), пэддинги
  4px sides. Без горизонтального скролла. Гамбургер-меню или
  overflow-scroll не вводим — юзер сказал «в бар», а не «в
  overflow-меню».
antithesis: |
  (1) «Оставить двухрядный (tabbar + toolstrip) — починить
    z-index/safe-bottom и иконки». Возражение: даже если
    починить видимость, иконки 16px на тёмном фоне — это
    discoverability-провал. Двухрядный макет уже отвергнут
    юзером («не нахожу»).
    (2) «Вынести step/piano/mixer в overflow-меню/гамбургер».
    Возражение: 6 функций в один ряд — нормальная плотность
    для мобильного bottom-nav (iOS/Android Material Design
    допускают 3-5; 6 на грани но работает). Гамбургер прячет
    фичи, юзер их уже потерял.
    (3) «Mixer убрать — он редкий». Возражение: Mixer критичен
    для M/S/gain; убирать — регресс. Все 6 в баре.
    (4) «MIDI тоже в бар (7 табов)». Возражение: 7 табов
    не влезают в 360px без скролла; MIDI — file I/O, естественнее
    в ScorePanel как сейчас. Юзер спросил «где midi» — нашёл
    бы в score-табе без проблем.
synthesis: |
  TabBar: 6 табов (Score, Step, Piano, Mixer, AI, Status).
  setTab расширен: step→openKindSheet('step','full'),
  piano→openKindSheet('piano','full'). TabId:
  'score' | 'step' | 'piano' | 'mixer' | 'chat' | 'status'.
  BottomToolstrip.tsx удалён. App.tsx не рендерит toolstrip.
  CSS: блок `.wc-toolstrip*` удалён из components.css. midi
  импорт/экспорт остаётся в ScorePanel (нижняя MidiIOButtons).

  Тесты: setTab(step) → step sheet full, setTab(piano) →
  piano sheet full, существующие setTab(score/chat/mixer/
  status) не сломаны. Bot-TabBar не тестируется (snapshot-тест
  на твёрдом снимке DOM не нужен — UI низкоуровневый, e2e
  покрытие достаточно).

  E2E: e2e-coverage может проверить тапы по 6 табам, но не
  блокер для merge.

  backward-compat: TabId расширен новыми значениями — компилятор
  поймает несовместимости в callsite. Существующие 3 таба
  остаются на тех же позициях (первый/последний/центральный),
  только в середине появляются 2 новых. Persisted state не
  затронут (activeTab — не persisted).
status: applied
axiom: A5
witness:
  applied_at: 2026-10-13
  branch: feat/bottom-bar-unified
  commit: pending
  supersedes: null
epistemics:
  - statement: "BottomToolstrip есть в коде, но в живой системе
      не виден на mobile-вьюпортах"
    marker: fact
    evidence: "user screenshot Screenshot_20261014_015529 —
      3 таба score/ai/status видны, ни одного toolstrip-chip
      над ними нет; .wc-toolstrip { position: fixed; bottom:
      calc(var(--tabbar-h) + var(--safe-bottom)) } — позиция
      правильная, но чипсы 32px на тёмном фоне невидимы"
  - statement: "setTab уже корректно открывает chat/mixer/status"
    marker: fact
    evidence: "ui/src/presentation/state/uiState.ts:277-289 —
      setTab ветвит на openKindSheet('ai'|'mixer'|'status'|'closeAllSheets');
      uiState.test.ts:189-208 — setTab(mixer) и setTab(status)
      тестируются, всё green"
  - statement: "6 табов × 60px ≈ 360px — влезает на 360px viewport"
    marker: fact
    evidence: "TabBar: ITEMS.length === 3 → 6; в существующем
      CSS .wc-tab { flex: 1 1 0; min-width: 0 } — flex-1
      auto-distribute; mobile (≤720px) .wc-tab — без min-width
      override, каждый таб сжимается до ~viewport/6"
  - statement: "StepGrid и PianoKeyboard готовы к BottomSheet"
    marker: fact
    evidence: "BottomSheets.tsx:27-37 — kind='step' рендерит
      StepGrid, kind='piano' рендерит PianoKeyboard; sheet-snap
      и per-kind isolation уже работают (uiState.ts:244-249)"
---
