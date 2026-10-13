---
proposition: |
  Mixer changes (gain / mute / solo) пушатся в живой Strudel-паттерн
  без ручного рестарта. На каждый `setLayerGain/toggleLayerMute/
  toggleLayerSolo` UI дёргает `AudioEngine.setLayerMix(layerMix)`,
  который пересобирает snippet через `injectMix`, парсит его
  в Pattern и зовёт `repl.setPattern(parsedPattern, autostart=false)`
  — scheduler подхватывает новый паттерн на ближайшем lookahead-окне,
  уже звучащая нота не обрывается, evaluate-цикл side-effects
  (sample-init, beforeEval/afterEval, state-reset) не дёргаются.
  Без пакета — слайдер должен ждать ручного ▶ Play; с пакетом —
  реакция слышна через ~50 ms (один lookahead), как в DAW.
antithesis: |
  (1) "Push gain напрямую в Pattern" — Strudel Pattern API не
    предоставляет мутабельного `.setGain(i, g)`. Patterns immutable.
    Самый дешёвый hot-swap — `setPattern(newPat, false)`, но
    `newPat` всё равно требует перепарсинга (а Pattern мы из
    `stack(...)` целиком не разбираем обратно по слоям — Stack
    использует internal lazy-query contract, нет `.layers`).
    Решение: пересобрать snippet через `injectMix` (он у нас уже
    есть в application/useCases/) → `transpiler.evaluate` → pattern.
    Полностью skip нельзя; skip можно ТОЛЬКО post-eval side-effects
    (`repl.evaluate` внутри делает: parse → evalScope →
    `beforeEval` → `setPattern(autostart=true)` → register runtime
    hooks — мы вызываем `setPattern` напрямую и пропускаем всё
    остальное). (2) Solo/mute cascade через `.gain(0)` vs `.mul(0)`
    — proposition остаётся той же что и в wavecode-track-mixer,
    injectMix не меняется. (3) Race на быстрый drag слайдера —
    60Hz mousemove = 60 setLayerMix вызовов/сек. Без дебаунса
    каждый тянет парсинг snippet (~30 ms на 6 layers на iPhone SE).
    Решение: 50 ms debounce в presentation-слое, НЕ в AudioEngine
    (engine остаётся idempotent и synchronous-safe). (4) Конфликт
    с уже идущим `setCps` (debounce 100 ms в
    useTransportAudioSync). Если оба debounce'ятся одновременно
    в одном тике — Strudel scheduler ставит `this.pattern = newPat`
    атомарно, не теряем состояния. Confirmed через
    `@strudel/core/cyclist.mjs:3171-3173`. (5) A11y / откат при
    ошибке парсинга — если перепарсинг фейлится (юзер сохранил
    кривой snippet через undo между eval и mix), старый pattern
    всё ещё в `repl.scheduler.pattern`, мы его НЕ трогаем. Failure
    mode — silent retry на следующем изменении миксера, юзер слышит
    что ничего не меняется (degraded, но не crash). (6) Зависимость
    от внутреннего API — `repl.setPattern` экспортирован публично
    в `@strudel/core/repl.mjs:105-110`, через `@strudel/webaudio`
    d.ts-обёртку уже доступен. Никакого хака внутренних модулей.
synthesis: |
  AudioEngine получает capability `setLayerMix(layerMix: LayerMix[])`,
  симметричную существующему `setCps`. MixerPanel на каждый
  dispatch вызывает (debounce 50 ms) `audio.setLayerMix(layerMix)`.
  Под капотом: кеш последнего snippet (`audioActions.evalScore`
  сохраняет его в `debugState.lastEvaluatedSnippet`, уже там),
  `injectMix(snippet, layerMix)` → строка → `repl.setPattern(
  parseOnly(newSnippet), autostart=false)`. Layer-mix state
  остаётся в `appStore.layerMix`, как раньше — single source of
  truth. Ручной ▶ Play перестаёт быть обязательным, но остаётся
  валидным (для случая «юзер хочет форсировать full re-init
  после preset-load, который и так зовёт evalScore сейчас»).
  Effect-architecture не ломается: capability пишется в domain/
  interface, реализуется в infrastructure/audio/, MixerPanel +
  audioActions зовут её через DI AppLayer. Тесты: новый unit на
  AudioEngine.setLayerMix с mock repl (verify setPattern called
  с autos tart=false), новый e2e «drag slider → audio changes
  без ▶ Play» в tests/e2e/.
substrate: |
  + `ui/src/domain/services.ts`: новая capability
    `AudioEngine.setLayerMix(layerMix): Effect<void, never, never>`.
  + `ui/src/infrastructure/audio/LiveAudioEngine.ts`: реализация —
    `setLayerMix` дёргает `cachedRepl.then(repl => repl.setPattern(parsed, false))`,
    `parsed` берём из `transpiler` evaluate на `injectMix(lastEvaluatedSnippet, layerMix)`.
    Debounce НЕ внутри, debounce снаружи (presentation).
  + `ui/src/application/useCases/injectMix.ts`: NO CHANGE — функция
    уже pure и idempotent, hot-swap переиспользует её без модификаций.
  + `ui/src/presentation/state/audioActions.ts`: добавить
    `applyMixLive = debounce((mix) => Effect.runPromise(AudioEngine.setLayerMix(mix)),
    50)`; `evalScore()` после инжекта сохраняет snippet в `debugState`
    (уже есть lastEvaluatedSnippet, перепроверить alias).
  + `ui/src/presentation/components/MixerPanel.tsx`: на
    `setLayerGain/toggleLayerMute/toggleLayerSolo` — дёргать
    `applyMixLive(appStore.layerMix)` ПЛЮС текущий dispatch.
    Dispatch остаётся (state-of-truth), debounced sync отвечает за
    audible response.
  + `ui/src/presentation/state/audioActions.test.ts` (new): unit
    на `applyMixLive` debounce timing — 3 быстрых вызова = 1
    фактический setLayerMix.
  + `ui/tests/e2e/mixer-live.spec.ts` (new): пресет drum-machine →
    ▶ Play → drag mute на layer 0 → expect sound меняется в
    течение 200 ms без повторного ▶ Play. Замер через Web Audio
    analyser (RMS) или stub на audio engine.
  − ничего не удалено.
status: draft
axiom: A1
epistemics:
  - statement: "Strudel `repl.setPattern(pattern, autostart=false)`
      атомарно подменяет `scheduler.pattern` без stop/start; ближайший
      lookahead-query (~50 ms) уже играет новый паттерн"
    marker: fact
    evidence: "@strudel/core/repl.mjs:105-110 + cyclist.mjs:3171-3173
      `setPattern(e, n) { this.pattern = e; n && !started && start(); }`;
      TypeScript d.ts в нашем strudel.d.ts:53-71 уже экспортирует
      setPattern через webaudioRepl handle"
  - statement: "Парсинг snippet → Pattern без side-effects возможен
      через ту же `repl.evaluate`, но в нашем случае мы хотим skip
      beforeEval/afterEval/evalScope-context; для первой итерации
      принимаем полный re-eval internal — измерим cost на iPhone SE
      и при необходимости уберём через cache-parse"
    marker: judgment
    evidence: "нет публичного `repl.parse(code, transpiler)` в
      @strudel/core/repl.mjs, только `setCode` который и есть
      evaluate + beforeEval. Budget на re-parse 6-layer stack
      ~5-10 ms по аналогии с wavecode-stack-performance"
  - statement: "Debounce 50 ms на setLayerMix — компромисс между
      perceived-latency (юзер хочет слышать slider в реальном
      времени) и CPU cost (3-4 re-eval подряд без debounce
      утопят iPhone scheduler). Параллель — ProTools HW-controller
      latency 30 ms; Ableton Push 60 ms"
    marker: judgment
    evidence: "эмпирический trade-off без жёстких данных;
      нужно tunе'ить, оставить константу в одном месте
      (audioActions.ts: экспортируемая MIX_DEBOUNCE_MS)"
  - statement: "При ошибке парсинга setter молча роллбэкает
      (старый pattern остаётся в scheduler), юзер слышит
      «mixer не реагирует» — degraded UX, но не crash. На catch
      пишем console.warn, не dispatch error event (audio не в
      error-состоянии, продолжает играть)"
    marker: fact
    evidence: "Strudel repl.evaluate throws при синтаксической
      ошибке; catch на нашей стороне = no-op, паттерн не мутируем"
  - statement: "Mixer edits остаются в `appStore.layerMix` —
      single source of truth. AudioEngine.setLayerMix получает
      полный layerMix array на каждый вызов, не делает diff;
      дедупликация — забота дебаунсера"
    marker: fact
    evidence: "прецедент setCps в useTransportAudioSync.ts:35-43 —
      не diff'ит, просто пушит текущее значение каждый раз"
  - statement: "Sound changes слышны через ~1 lookahead cycle
      (50 ms @ cps=1, 25 ms @ cps=2). Acceptable latency для
      DAW-подобного UX; в typed-code DAW (Cubase) typ-feedback
      latency 5-20 ms, но у нас JS-parse-step overhead ~10 ms"
    marker: judgment
    evidence: "Strudel docs по scheduler lookbehind/lookahead,
      + математика: lookahead = 0.5 cycle в дефолте"
  - statement: "Тестируемый проброс через AudioEngine DI-слой —
      у нас уже есть AudioEngine Tag в domain/services.ts:40, AppLayer
      в infrastructure/composition.ts provides mock в тестах. Добавить
      мок в существующий AppLayer test config"
    marker: fact
    evidence: "LiveAudioEngine.test.ts + StepGrid.test.ts уже
      мокают audioActions; precedent pattern is established"
witness: missing — packet в статусе draft, ждёт peer-review + live test на дев-сборке
---
