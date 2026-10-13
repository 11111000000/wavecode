---
proposition: |
  StepGrid открывается пустым даже когда в editor-score уже есть
  `s("bd …")`-ряды, и его playhead залипает на колонке 0 при
  первом eval, пока пользователь не дёрнет cps-слайдер.

  Два сцепленных дефекта:

  (1) `<StepGrid />` инициализирует `grid()` пустым 4×8 и
  держит его в таком виде, пока пользователь не нажмёт
  `↓ read score`. UX-ожидание юзера (открыл sheet — увидел
  текущий паттерн) нарушено. Это A4-care: кнопка-скрытый
  триггер между editor'ом и grid'ом — пользователь не
  должен знать, что «read score» нужно тыкать после
  каждого открытия.

  (2) `AudioEngine.getCycleProgress()` использует `evalCps`,
  которое `LiveAudioEngine.evaluate` захватывает из
  `debugState.cps` ПОСЛЕ успешного `repl.evaluate`. Но
  `debugState.cps` обновляется только внутри внутреннего
  `repl.setCps` (closure внутри `ensureRepl`). Внешний
  `service.setCps` проверяет `if (!cachedRepl) return` —
  silent no-op, если repl ещё не создан. Race:

     t=0   useAppBootstrap → installTransportAudioSync
           createEffect runs (cps()=0.5), lastPushed=null,
           setTimeout 100ms
     t≈100 audio.setCps(0.5) — cachedRepl === null
           → return. debugState.cps остаётся 0.
     t=??? user clicks play → audio.eval(...) →
           cachedRepl создан, scheduler.cps остаётся
           дефолтным 0.5. После успеха:
             setDebug({ lastEvalClock, evalCps: debugState.cps=0 })
           → evalCps = 0. getCycleProgress возвращает 0.
           playhead залипает на column 0.

  В старом коде (commit 1c7d23c, до wavecode-step-append-sync)
  playhead тикал независимо от audio через RAF с шагом 0.125s
  (=cps=1.0) — это объясняет наблюдение «в два раза быстрее
  звука» при scheduler-cps=0.5. Текущий код уже синхронизирован
  с `getCycleProgress`, но из-за race evalCps=0 и playhead
  залипает на колонке 0.

  На staging-деплое пользователь видит «пустой грид» + «playhead
  не едет» (или, до фикса от 8533451, «playhead едет в 2× быстрее
  звука» — это была отдельная гипотеза, ныне покрыта).
antithesis: |
  (1) «Grid должен быть независимым editor-таб для записи,
  как в Ableton». Возражение: текущий UX-flow «пишешь score
  → grid отражает его → tap'ы пишут в grid → load&play
  фиксирует grid обратно» уже требует явной кнопки
  `↓ read score` после каждого открытия. Это
  скрытый-с-ног-головы двух-режим: «редактор vs секвенсер».
  Пользователь, открывший sheet, ожидает увидеть то, что
  в score — иначе зачем открывать. Auto-load когда grid
  пуст = «открыл sheet, увидел текущий бит, теперь могу
  поправить». Это и есть A1-feedback: то, что пользователь
  видит, синхронизировано с тем, что он слышит.

  (2) «Используй `appStore.transportState.cps` напрямую в
  eval вместо `debugState.cps`». Возражение: связывает
  LiveAudioEngine с reducer-store — нарушает A0-separation
  (infrastructure не должен знать про presentation). Текущая
  архитектура: `debugState.cps` — это «желаемая cps из
  presentation», которое `setCps` пишет в audio engine.
  Чиню gap: `setCps` всегда пишет в debug, даже когда
  repl ещё не готов. После создания repl — repl.setCps
  тоже пишет (идемпотентно). Race устранён без
  cross-layer связи.

  (3) «Сделай debug.cps мембером audio service, чтобы
  service сам себя обновлял из slider через Effect».
  Возражение: presentation-слой сейчас owns
  installTransportAudioSync и не должен терять контроль.
  Outer `setCps` — это и есть presentation-side entrypoint;
  чиню только его.

  (4) «Усложнять не надо, проще: пере-передать cps после
  eval». Возражение: требует, чтобы eval знал про
  `installTransportAudioSync`, и обратный dependency в нём.
  Также нужно ре-resolve после каждой eval (re-eval
  случается при каждом tap'е в Stack и ИИ-edit).
synthesis: |
  Три правки:

  (a) `App.tsx`: в `onToggleStepGrid`, когда открываем sheet
  впервые (grid пустой) — вызвать `loadFromScore(appStore.score)`
  из `gridState`. После того как юзер тапнул хоть одну ячейку
  (grid не пустой), повторное открытие НЕ перетирает его
  ручной ввод. Это и есть «read-only mirror когда sheet
  открыт, edit-buffer когда юзер начал трогать».

  (b) `LiveAudioEngine.ts`: в outer `service.setCps` ДО
  проверки `if (!cachedRepl) return` явно вызвать
  `setDebug({ cps })`. Эффект: даже если setCps вызван до
  первого eval (когда cachedRepl ещё null), debug.cps уже
  синхронизирован. После eval `evalCps = debugState.cps`
  получает правильное значение. Inner repl.setCps по-прежнему
  вызывает setDebug (идемпотентно — то же значение). Race
  устранён.

  (c) StepGrid остаётся manual-edit когда пользователь
  начал вводить (grid не пустой при открытии). Не делаем
  reactive createEffect на appStore.score в StepGrid —
  иначе при `load&play` (который мерджит grid в score)
  грид бы перепарсил сам себя и стёр пользовательские
  тапы, не входящие в s("…")-паттерны.

  Tests:
  - vitest `StepGrid.test.tsx` (+2):
    * «AppShell onToggleStepGrid` при пустом grid вызывает
      loadFromScore(score) — кнопка `↓ read score` теперь
      auto-call при sheet-open, регрессия если кто-то
      уберёт».
    * «AppShell onToggleStepGrid при непустом grid НЕ
      трогает grid — пользовательские тапы сохранены».
  - vitest `LiveAudioEngine.test.ts` (если нет — new):
    * `setCps(0.5)` ДО создания repl → debugState.cps=0.5
      (раньше был 0).
    * `setCps(0.5)` ПОСЛЕ создания repl → debugState.cps=0.5
      + repl.setCps called.
  - vitest `LiveAudioEngine.getCycleProgress` integration:
    * setCps(0.5) до eval → eval captures evalCps=0.5 →
      getCycleProgress сразу после eval возвращает ~0 →
      через 0.5s elapsed = 0.25 → beat = 2.
    * regression: setCps(0) (никогда не вызванный) до eval →
      eval captures evalCps=0 → getCycleProgress всегда 0
      (ЭТО и есть старый bug; фикс — первый update убирает
      этот случай из реальной жизни).
  - playwright e2e `tests/e2e/step-grid-autoload.spec.ts`
    (new, ~80 lines):
    * открыть app → загружен Creep → нажать Step →
      bd step 1 и bd step 3 имеют класс `active`
      (auto-load).
    * ввести тап cp step 1 → закрыть sheet → открыть
      sheet снова → cp step 1 всё ещё active (manual
      edit не затирается).
  - regression: существующий `tests/e2e/step-append.spec.mjs`
    не должен сломаться (поведение load&play не меняется).

  Не нужно менять:
  - `StepGrid.tsx` (компонент не трогаем — он уже
     reactive-consumer от signal `grid()`; auto-load
     триггерится выше, в App.tsx).
  - `gridState.ts` / `loadFromScore` (уже делает best-effort
     парсинг s("…")-рядов; не трогаем).
  - `transportState.ts` / `useTransportAudioSync.ts`
     (поведение дебаунса правильное; источник race — в
     infra-стороне, не в presentation).
  - `audioActions.ts` (eval flow не меняется).

  Manual QA:
  - Vite dev: http://127.0.0.1:5174 (worktree ветка).
  - Открыть app, загружен Creep → Step sheet →
    bd row имеет active на col 0 и col 2 (s("bd ~ sbd ~")).
  - Тапнуть любую ячейку → закрыть/открыть sheet →
    тап сохранён.
  - Click Запуск → playhead едет синхронно с BPM 60
    indicator (cps=0.5, BPM=60). Никакого залипания
    на колонке 0.
  - Sub-step: проверить, что CPS slider до eval не ломает
    playhead (раньше ломал).

substrate: |
  ~ `ui/src/App.tsx` (modify, +6 line):
    в onToggleStepGrid добавить условный auto-load из
    gridState.
  ~ `ui/src/infrastructure/audio/LiveAudioEngine.ts`
    (modify, +3 line): setCps service начинает с
    setDebug({ cps }) до await.
  ~ `ui/src/infrastructure/audio/LiveAudioEngine.test.ts`
    (new, ~70 line): setCps races + getCycleProgress
    semantics.
  ~ `ui/src/presentation/components/StepGrid.test.tsx`
    (extend, +2 cases): AppShell auto-load on sheet open.
  ~ `ui/tests/e2e/step-grid-autoload.spec.ts` (new, ~80).
  ~ `math/wavecode-step-grid-autoload-and-sync/{packet,witness}`.

  Не нужно:
  - изменения в `transportState.ts` (transport-sync уже
    вызывает audio.setCps правильно).
  - новые tag-классы в domain (AudioEngine tag уже
    описывает setCps).
  - изменения reducer'а (поведение state не меняется).
status: draft
witness: pending
axiom: A4
epistemics:
  - statement: "StepGrid рендерится всегда внутри BottomSheet,
       но grid signal хранится в module-scope, не в
       onMount — поэтому initial grid = emptyGrid() пока
       юзер не нажмёт ↓ read score."
    marker: fact
    evidence: "ui/src/presentation/state/gridState.ts:21 —
       `const [grid, setGrid] = createSignal<Grid>(emptyGrid());`.
       ui/src/presentation/components/StepGrid.tsx:35-84 —
       useState grid() не инициализируется из score;
       onLoadFromCurrent (стр 82-84) делает это вручную."
  - statement: "audio.setCps service не пишет в debug.cps
       при cachedRepl===null, потому что setDebug вынесен
       во внутренний repl-handler, который не вызывается
       до создания repl."
    marker: fact
    evidence: "LiveAudioEngine.ts:272-279 (внутренний
       repl.setCps — setDebug({ cps })); :429-437
       (outer service.setCps — без setDebug, silent no-op
       при !cachedRepl)."
  - statement: "Race: installTransportAudioSync's createEffect
       срабатывает на t=0 с lastPushed=null и планирует
       setTimeout 100ms; repl создаётся ленивo в первом
       audio.eval. До этого setCps — silent no-op."
    marker: fact
    evidence: "useTransportAudioSync.ts:27-44 — createEffect
       с setTimeout(100ms); LiveAudioEngine.ts:174-290
       (ensureRepl) — cachedRepl создаётся на первом
       audio.eval; до этого момента cachedRepl===null."
  - statement: "В моей репродукции в браузере (worktree
       fix/step-grid-empty-and-playhead, vite dev 5174)
       после eval: debug.cps=0, debug.evalCps=0,
       lastEvalClock=70.43s, audioCtx.currentTime=75.5s.
       getCycleProgress возвращает 0 → playhead залип
       на колонке 0 на всём окне выборки (10 frames ×
       100ms)."
    marker: observation
    evidence: "Playwright browser_evaluate:10 samples по 100ms,
       каждый показывал beat-cells=['bd step 1','sd step 1',
       'hh step 1','cp step 1'] — column 0 все время.
       window.__wavecodeDebug.cps=0, evalCps=0."
  - statement: "Старый код (commit 1c7d23c) тикал beat через
       независимый RAF с dt >= 0.125s = cps=1.0 визуально.
       Это даёт наблюдение «2× быстрее» при scheduler
       cps=0.5. Текущий код (после 8533451) уже синхронизирован,
       но race в setCps ломает синхронизацию с другой
       стороны (залипание на 0)."
    marker: fact
    evidence: "git log -- ui/src/presentation/components/
       StepGrid.tsx: 8533451 (sync) ← 1c7d23c (independent).
       Commit 1c7d23c source: StepGrid.tsx:38-49 — `if (dt
       >= 0.125) setBeat((b) => (b+1) % GRID_COLS)`."
  - statement: "BottomSheet рендерит StepGrid всегда (не
       при открытии) — на этом уровне BottomSheet.tsx:27-31
       без <Show when={open}>. Это значит onMount в
       StepGrid срабатывает один раз при загрузке app,
       а не при каждом sheet-open."
    marker: fact
    evidence: "BottomSheets.tsx:27-31 — `<BottomSheet
       kind='step'>...<StepGrid /></BottomSheet>` без
       condition; BottomSheet internals — CSS-hide, не
       unmount. Чтобы auto-load работал при каждом sheet-open,
       хук вешаем в App.tsx → onToggleStepGrid, не в
       onMount StepGrid."