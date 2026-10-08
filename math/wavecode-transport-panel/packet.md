---
proposition: |
  В шапке wavecode, под `app-preset-row`, появляется slim «Transport» —
  CPS-слайдер (range 0.05–2.0, default 0.5, step 0.01), цифровой
  BPM-индикатор `120` (пересчёт 60·cps·2 при 4/4), кнопка swing (toggle
  шлёт `.swing(0.5, 1/3)` через preprocessor при следующем eval), и узкая
  RAF-playhead полоска под слайдером, бегущая за встроенным Cyclist
  scheduler через `queryAnimationFrame`. Top-row `▶ Запуск / ■ Стоп` уже
  есть и не трогается.
antithesis: |
  (1) Профи думают в BPM, не CPS — слайдер с BPM был бы естественнее, но
    тот же параметр меняет оба. Делаем CPS на слайдере + пересчёт в BPM
    рядом — профи видят «120 BPM», но крутят cps. (2) Swing через UI
    всегда выглядит одинаково — Strudel `.swing(root, offset)` принимает
    два аргумента (значение паттерна и доля бита). Фиксируем `.swing(0.5,
    1/3)` (стандартный shuffle 16ths) как единственный пресет — extended
    версия это отдельная задача. (3) Playhead через RAF полагается на
    Web-Audio clock и не учитывает что Strudel Cyclist сам считает
    `cyclePos` — двойная работа. Reuse: `webaudioRepl` создаёт
    controllable scheduler; добавляем accessor `getCycleProgress()` к
    `AudioEngine`-интерфейсу, не дублируем counter. (4) Swing ломает
    ИИ-edit: ИИ правит score, swing внезапно добавляет свой .swing() к
    правке — неконсистентно. Решается тем, что swing — отдельный
    side-effect через preprocessor (ИИ видит чистый score, swing
    применяется в `audio.eval` wrapper).
synthesis: |
  Три уровня разделения: (a) `transportState` живёт в `presentation/state`
  — cps, swing on/off; (b) `AudioEngine.setCps()` — новый метод
  интерфейса, реализация в `LiveAudioEngine` зовёт
  `webaudioRepl({cps: ...})` ИЛИ патчит существующий scheduler;
  (c) playhead — RAF-цикл, читает `AudioEngine.getCycleProgress()` →
  CSS-переменная `--playhead-x`, применяется transform без re-render.
  Swing-toggle не пишет в score — пишет в `transportState.swing`,
  применяется через `injectMix`-подобный preprocessor, идущий ПЕРЕД
  `eval()`. ИИ-edit работает с чистым score, swing —
  side-effect, прозрачен для LLM.
substrate: |
  + `domain/services.ts`: интерфейс `AudioEngine` расширяется двумя
    методами — `setCps(cps: number): Effect<void>` и
    `getCycleProgress(): Effect<number>` (последний синхронный
    accessor через closure, как `getDebug` уже работает).
  + `infrastructure/audio/LiveAudioEngine.ts`: реализация обоих —
    `setCps` дёргает `repl.setcps?.(cps)` или перезапускает
    `webaudioRepl({cps})` с текущим evaluator; `getCycleProgress`
    читает Cyclist внутреннее поле через Symbol-accessor.
  + `domain/types.ts`: новое поле `transportState: { cps: number,
    swing: boolean }` в AppState (initial `{cps: 0.5, swing: false}`).
  + `application/reducer.ts`: новые `AppEvent` — `setCps {cps:number}`,
    `toggleSwing`. `audio.eval`-эффект оборачивается в
    `application/useCases/evalWithTransport.ts`, применяющим
    `.swing(0.5, 1/3)` через Strudel-`Pattern.withValueIf` поверх
    `parsed.value`, если swing === true.
  + `presentation/state/transportState.ts` (new): сигналс `cps`,
    `swing`, debounced 100ms sync с reducer. Effect на изменения →
    `AudioEngine.setCps`.
  + `presentation/components/TransportPanel.tsx` (new): JSX-разметка,
    `<input type=range min=0.05 max=2 step=0.01>`, BPM-индикатор,
    swing-button, RAF-playhead как `<div class="playhead" />`.
  + `App.tsx`: рендер `<TransportPanel />` внутри `.app-controls-row`
    ПОСЛЕ кнопок play/stop.
  + `index.css`: `.transport-panel` (flex column, slim 28px height),
    `.bpm-indicator` (read-only, monospace), `.playhead` (height 2px,
    absolute, transition: transform 16ms linear).
  − ничего не удалено. `evalScore()` в `audioActions.ts` →
    retrofitted на `evalWithTransport()`.
status: draft
axiom: A1
epistemics:
  - statement: "CPS-slider удобнее BPM-slider потому что cps — это то,
      что реально меняет Strudel; BPM = 60·cps·2 при 4/4 — вывод
      для UX, не параметр runtime"
    marker: fact
    evidence: "Strudel docs `setcps()` — единица измерения cycles/sec;
      CPS=1.0 = 60 BPM при cycle=1/нота (1 нот/сек); CPS=0.5 = 120 BPM
      при типичной 4/4"
  - statement: "Cyclist scheduler имеет публичный/полу-публичный API
      для getter'а прогресса (через Symbol или internal field)"
    marker: hypothesis
    evidence: "Cyclist source — `state.startedAt`, `state.startCycle`,
      `state.endCycle`; сэмплируется через `now()` minus startedAt"
  - statement: "Strudel `.swing(rootValue, stepOffset)` — паттерн-
      оператор, добавляемый в chain, идёт ПОСЛЕ `.slow()`/`.fast()`;
      стандартный shuffle 16ths это `.swing(0.5, 1/3)`"
    marker: fact
    evidence: "Strudel docs Pattern API — `swing(value: pattern, skip:
      pattern)` мультиплицирует каждый step и group based on skip"
  - statement: "RAF + Web Audio clock дрифтуют если RAF задержан —
      визуальный drift ≤16ms на 60Hz, приемлемо для playhead"
    marker: fact
    evidence: "MDN `requestAnimationFrame` callbacks — связаны с refresh
      rate display; drift не накапливается, каждый frame пересчитывает
      абсолютную позицию через `audioCtx.currentTime`"
  - statement: "ИИ-edit видит raw score без transport-side-effects,
      swing/cps применяются в audio-eval wrapper, не через правку
      строки — иначе ИИ зацикливается на swing комментариях"
    marker: judgment
    evidence: "system-prompt в `application/useCases/llmEdit.ts` уже
      описывает score как Strudel-code; transport-обёртки —
      инфраструктурный слой, должен быть прозрачен для LLM"
  - statement: "CPS-swing через preprocessor не теряет score-validity
      для IDB-save: `replaceScore` сохраняет чистый score"
    marker: fact
    evidence: "App.tsx:80-92 `createEffect` autosave на
      `appStore.score` — score без swing, swing только runtime"
  - statement: "Swing-clobber: если ИИ edit приходит при включённом
      swing, score в IDB остаётся «.fast(2)», runtime инжектит
      .swing() на лету; на toggle swing → off, runtime eval всё
      тот же чистый score, swing пропадает — консистентно"
    marker: fact
    evidence: "Аналог `injectMix` (track-mixer пакет) — pure
      transform, idempotent, applied at eval-time only"
---
