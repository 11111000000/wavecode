---
proposition: |
  Play/Stop-кнопка больше НЕ является fixed FAB — она
  живёт в `TransportPanel` (рядом с cps/BPM/swing) и
  семантически «принадлежит» Control-row. FAB полностью
  удаляется из `App.tsx`. Кнопка всегда видна в шапке
  (поверх preset-row), но НИКОГДА не перекрывает AI-ввод,
  BottomSheet или любой другой controls-блок.
antithesis: |
  (1) «FAB-парадигма — стандарт мобильных приложений
  (Material/Android)». Возражение: wavecode — desktop-first
  coding IDE с BottomSheet для мобилы, не медиаплеер. На
  desktop FAB сидит над правым нижним углом viewport и
  перекрывает AI-чат (где у нас `ai-apply-btn` + textarea).
  На mobile BottomSheet `ai` открывается через TabBar —
  FAB оказывается над `ai-footer`, ровно там, где Apply-
  кнопка. Это нарушение A4 «UX — архитектура»: юзер не
  может нажать «Применить» или достучаться до textarea,
  не свернув BottomSheet. (2) «Play должен быть large и
  заметный — FAB это даёт». Возражение: в TopBar есть
  LED-индикатор (`▶ ${ctxState}`), а в TransportPanel
  кнопка ставится первой — самая левая = самая заметная
  в Control-зоне. Размер кнопки не уменьшается (28-32px
  height вместо 56px FAB — компромисс в пользу того, чтобы
  controls были видны полностью). (3) «Мы теряем
  floating-position на mobile». Возражение: mobile-юзер
  открывает Control через BottomSheet `kind="transport"`
  (отдельный snap-point); TabBar остаётся на месте.
  (4) «Если убрать FAB — сломаются тесты». Возражение: FAB
  нигде не тестируется (см. `grep -rn 'FAB' ui/src/` — нет
  тестов на компонент; все e2e используют `[data-testid]`
  селекторы).
synthesis: |
  Четыре правки: (a) TransportPanel.tsx принимает props
  `audioRunning: () => boolean`, `audioStarting: () =>
  boolean`, `onPlay: () => void`, `onStop: () => void` —
  рендерит большую кнопку первым элементом в
  `.transport-controls`. Тон кнопки: amber=`running` →
  cyan `stop`, иконка PlayIcon/StopIcon. ARIA:
  `aria-label="Запуск" | "Стоп"`, `aria-pressed`. (b)
  App.tsx: блок `<FAB ... />` (строки 196-203) удаляется,
  FAB-импорт удаляется. Хендлер переносится в виде props
  в `<TransportPanel />`. (c) App.tsx: `<TransportPanel />`
  переезжает с позиции «внутри PresetRow» (строка 65) на
  собственную строку СРАЗУ ПОД `<PresetRow />`, или —
  лучше — становится первым sub-control внутри
  `.transport-row`. Транспорт-row отделён от
  `.app-preset-row` чтобы иметь свой z-index. (d)
  components.css: `.wc-fab` стили оставляем (компонент
  FAB остаётся в коде на случай будущего использования;
  visual dead-code — не bug). Альтернатива: удалить и FAB-
  компонент, и его стили — single source of truth.

  В TopBar LED-индикатор (`▶ ${ctxState().state}` /
  `● ${ctxState().state}`) остаётся как прежде.

  Tests:
    - vitest: TransportPanel.test.tsx (новый, 6 кейсов):
      * audioRunning=false → отрендерена amber-кнопка с
        PlayIcon, aria-label='Запуск'.
      * audioRunning=true → отрендерена cyan-кнопка с
        StopIcon, aria-label='Стоп'.
      * click в running=false → onPlay called 1×,
        onStop NOT called.
      * click в running=true → onStop called 1×,
        onPlay NOT called.
      * audioStarting=true + running=false → aria-busy
        на кнопке, pointer-events: none.
      * aria-pressed отражает audioRunning.
    - vitest: e2e-class: при отсутствии onPlay/onStop prop
      рендер не падает (default = noop fn).
    - playwright e2e (preexisting infra + 1 new spec):
      * `tests/e2e/play-control.spec.ts`: на 1280×720
        клик в PresetRow Play → assert
        `[data-testid="bpm-indicator"]` обновляется
        (`bpm-indicator` тикает по RAF); кнопка стала
        Stop-варианта; AI-ввод (`[data-ai-textarea]`)
        остался видимым и доступным.
substrate: |
  + `ui/src/presentation/components/TransportPanel.tsx`
    (modify, ~30 line additions): props + кнопка первым
    элементом в `.transport-controls`.
  + `ui/src/App.tsx` (modify, ~10 line changes):
    импорт FAB удаляется, <FAB ... /> JSX-блок удаляется,
    TransportPanel рендерится как sibling (или остаётся
    в PresetRow с пробросом props — выбираем sibling
    через `<TransportPanel />` ПОСЛЕ `<PresetRow />`,
    чтобы Play был отдельно от пресет-chips).
  + `ui/src/presentation/components/TransportPanel.test.tsx`
    (new, ~120 lines, 6 cases).
  + `ui/tests/e2e/play-control.spec.ts` (new, ~80 lines).
  + `math/wavecode-play-in-control/{packet.md,witness}`
    (this packet).
  − ничего не удаляется из CSS/UI кода; FAB-компонент и
    его стили сохраняются как потенциально полезные.
status: draft
witness:
  applied_at: TBD
  commit: TBD
  supersedes: null
  notes: |
    SHA + applied_at будут заполнены subagent'ом после
    имплементации и зелёных тестов.
axiom: A4
epistemics:
  - statement: "FAB на текущем мастер-коде перекрывает AI-
      input при BottomSheet `kind=ai` и при desktop layout
      `data-layout='ai-primary'`."
    marker: fact
    evidence: "ui/src/styles/components.css:454-491 определяет
      `.wc-fab { position: fixed; right: var(--space-lg);
      bottom: calc(var(--tabbar-h) + var(--space-lg) +
      var(--safe-bottom)); z-index: calc(var(--z-sheet) + 5);
      }`. `.ai-footer` (legacy.css:642) идёт от низа
      AI-панели; FAB сидит над этой зоной. z-fab > z-sheet
      значит FAB рендерится поверх BottomSheet-backdrop."
  - statement: "В TopBar уже есть LED-индикатор `▶ running`
      / `● stopped`, дополнительный Play не нужен в TopBar."
    marker: fact
    evidence: "ui/src/presentation/components/app/TopBar.tsx:53-57
      — `<span class='wc-led' data-tone={...}>{$running ?
      `▶ ${ctxState().state}` : `● ${ctxState().state}`}</span>`."
  - statement: "В TransportPanel нет тестов (new), но
      Props.test паттерн используется в других
      presentation-компонентах."
    marker: fact
    evidence: "ui/src/presentation/components/StepGrid.test.ts,
      PianoKeyboard.test.ts, MixerPanel.test.tsx (если есть)
      — соседи по слою используют @solidjs/testing-library."
  - statement: "Решение axiom A4 — UX = архитектура. Кнопка
      Play должна быть видна и не закрывать ничего важного;
      перенос в TransportPanel = top-of-Control = no"
      overlap, потому что глобальная шапка статична, а
      BottomSheet/AI-input живут под ней."
    marker: judgment
    evidence: "axiom A4 (math-coding docs/axioms.md): 'The
      user-observable contract is the architecture. Optimize
      the visible surface first; the implementation is
      derivable from the surface.' Удаление FAB = derivable
      от UX-контракта; реализация следует за surface."
---