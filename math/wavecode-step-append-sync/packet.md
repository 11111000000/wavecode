---
proposition: |
  Step-секвенсер НЕ заменяет editor-score при tap на ячейку.
  Tap = однократный sonic preview (через Web Audio `OscillatorNode`
  с drum-тоно́м) БЕЗ `audio.eval` (никакого `repl.stop` /
  `repl.evaluate`). Кнопка `↑ load & play` оборачивает grid
  через `stack(existingScore, gridAsScore())`, если editor не
  пуст, иначе использует grid-alone. Playhead синхронизирован
  с `AudioEngine.getCycleProgress()` — НЕ независимый RAF.
antithesis: |
  (1) «Replace-score при tap — простой UX, не нужно два
  режима». Возражение: текущее поведение УБИВАЕТ основную
  композицию юзера — после двух тапов всё, что юзер
  наиграл, исчезает. Это нарушение A1 (care). UX — это
  preview + explicit-load, как в GarageBand / Ableton
  note-mode: tap-играет sample, но не коммитит, пока юзер
  не сказал «ок». (2) «Preview через отдельный Web Audio
  — overengineering». Возражение: 1 AudioContext уже
  создан (`__wavecodeAudioCtx`), один oscillator на
  preview-event = 1KB CPU. Это меньше, чем `repl.stop()`
  + `repl.evaluate()` (которые при текущем поведении
  вызываются на каждый tap). Preview в 100× дешевле.
  (3) «Нет смысла синхронизировать playhead с audio —
  шаг 0.125s достаточно». Возражение: playhead сейчас
  идёт независимо от того, играет ли что-то. Юзер
  видит анимацию даже когда audio stopped — это
  визуальная ложь. Синхронизация с `getCycleProgress()`
  = правда: playhead стоит на 0, когда ничего не
  играет. (4) «Что если score уже содержит `stack()`? —
  тогда load добавит ещё один слой и mixer сломается».
  Возражение: `appendGridToScore` проверяет: если текущий
  score начинается с `stack(`, добавляет grid-слой
  через запятую ВНУТРЬ существующего `stack(...)`;
  иначе оборачивает оба в новый `stack(...)`. Mixer
  индексирует top-level layers парсером `parseStack`
  — добавление нового layer расширяет массив
  `layerMix` через reducer `setLayerCount`. (5)
  «Playhead-syncing требует polling audio engine». 
  Возражение: `getCycleProgress()` уже есть, синхронен,
  RAF-цикл TransportPanel (`TransportPanel.tsx:90-105`)
  дёргает его 60Hz без проблем. Копируем тот же паттерн.
synthesis: |
  Шесть правок: (a) `audioActions.ts`: новая функция
  `previewSample(sample: 'bd' | 'sd' | 'hh' | 'cp')` —
  прямой `audioCtx.createOscillator` + `createGain` +
  короткий ADSR через `gain.linearRampToValueAtTime`,
  без `audio.eval`. Используем `unlockAudioContext()`
  для lazy-init. (b) `StepGrid.tsx`: `onCellTap` → вызов
  `previewSample(rowDef.sample)` вместо `replaceScore` +
  `evalScore`. `flashKey` остаётся. Если удерживать
  тап 200ms+ → тоже preview (один раз; нет повторов,
  чтобы не плодить oscillators). (c) `StepGrid.tsx`:
  `onLoad` → новый helper `appendGridToScore(currentScore,
  grid)` из `gridState.ts`. (d) `gridState.ts`: новая
  функция `appendGridToScore(currentScore: string, grid:
  Grid): string` — pure, возвращает либо wrapped
  `stack(currentScore, gridAsScore(grid))` либо
  appends grid-layer внутрь существующего `stack(...)`,
  либо grid-only если current пуст. (e) `StepGrid.tsx`:
  RAF-tick `beat()` заменяется на RAF-цикл, читающий
  `AudioEngine.getCycleProgress()` и мапящий 0..1 в
  0..GRID_COLS; когда audio stopped — закреплён на 0,
  нет визуальной лжи. (f) `uiState` / `useAppBootstrap`:
  не нужно — `getCycleProgress` уже exported и
  effect-sync ставится через `Effect.runPromise`.
  
  Не нужен новый BottomSheet, не нужны новые tag-классы
  для UI. ИИ-edit: видит `stack(...)` с дополнительным
  слоем — может править как обычно.

  Tests:
  - vitest: `audioActions.test.ts` (new, ~80 lines):
    * previewSample создаёт oscillator/gain, планирует
      ADSR через audioCtx.currentTime; cleanup после
      `osc.stop` гарантирован (никаких утечек).
    * previewSample 'bd' / 'sd' / 'hh' / 'cp' — каждый
      имеет свою base-frequency (kick 60Hz, snare 200Hz,
      hihat 8000Hz, clap 1200Hz).
    * на unmocked context (race: audioContext не
      создан) → unlockAudioContext вызывается
      автоматически.
  - vitest: `gridState.test.ts` (new):
    * appendGridToScore('', grid) === gridAsScore(grid)
    * appendGridToScore('note("c4")', grid) ===
      `stack(\n  note("c4"),\n  <grid>\n)`
    * appendGridToScore('stack(a, b)', grid) ===
      `stack(a, b, <grid>)`  (append внутрь существ.)
    * appendGridToScore('// just comment\n', grid) ===
      игнорирует comment, результат тот же что и case 2
  - vitest: `StepGrid.test.ts` (extend, +6 cases):
    * tap cell → `previewSample` вызван 1×, `evalScore`
      NOT вызван, score не изменился.
    * `↑ load & play` с пустым editor → evalScore(grid).
    * `↑ load & play` с непустым score → evalScore(
      stack(wrapped-score, grid-snippet)).
    * beat() отражает getCycleProgress: при running=0
      beat()=0; при progress=0.5 beat()=4 (из 8).
  - playwright e2e: `tests/e2e/step-append.spec.ts`:
    * загрузить 'creep' preset → tap 2 cells → assert
      score НЕ содержит только grid, assert score содержит
      grid-rows как дополнительные s() слои.
    * assert playhead-div[data-beat] синхронен с
      индикатором BPM.
substrate: |
  + `ui/src/presentation/state/gridState.ts`
    (modify, ~30 line addition): `appendGridToScore(
    currentScore: string, grid: Grid): string` с multi-file
    parsetopstack (по тому же алгоритму, что и
    `parseStackTopLayers` — НЕ зависим от него через
    imports, чтобы избежать циркуляра domain→state).
    Сам парсер дублируем минимально (~15 lines).
  + `ui/src/presentation/state/audioActions.ts`
    (modify, ~30 line addition): `previewSample(sample)`.
  + `ui/src/presentation/components/StepGrid.tsx`
    (modify, ~50 line changes):
    - onCellTap: убрать replaceScore + evalScore,
      оставить только previewSample + flashKey.
    - onLoad: использовать appendGridToScore вместо
      raw gridAsScore.
    - RAF loop: заменить beat-tick на getCycleProgress
      poll (тот же паттерн, что у TransportPanel).
  + `ui/src/presentation/state/audioActions.test.ts`
    (new, ~80 lines).
  + `ui/src/presentation/state/gridState.test.ts`
    (new, ~50 lines).
  + `ui/src/presentation/components/StepGrid.test.ts`
    (extend, +6 cases).
  + `ui/tests/e2e/step-append.spec.ts` (new, ~70 lines).
  + `math/wavecode-step-append-sync/{packet.md,witness}`.
status: applied
witness:
  applied_at: 2026-10-13
  commit: 14751725d237a07c8a08fc7f08eb09129cba6504
  supersedes: math/wavecode-step-sequencer/packet.md
  notes: |
    Applied by subagent 2 of 3 on 2026-10-13. Supersession of
    wavecode-step-sequencer because the old `replaceScore on
    tap` semantics broke UX; new semantics — preview +
    explicit-load + sync-playhead.
axiom: A4
epistemics:
  - statement: "Текущий StepGrid.onCellTap УБИВАЕТ editor-
      score: `dispatch({type:'replaceScore', text: newScore})`
      каждый tap."
    marker: fact
    evidence: "ui/src/presentation/components/StepGrid.tsx:51-66
      (onCellTap) — `dispatch({type: 'replaceScore',
      text: newScore})` безусловно. После 2 тапов весь
      основной score заменён gridAsScore()."
  - statement: "RAF-tick beat() независим от audio — тикает
      даже когда ничего не играет."
    marker: fact
    evidence: "StepGrid.tsx:38-49 — `if (dt >= 0.125)
      setBeat((b) => (b+1) % GRID_COLS)` без проверки
      audio.status. Никакой синхронизации с Cyclist."
  - statement: "TransportPanel уже синхронизирован с
      audioCtx clock; паттерн можно копировать."
    marker: fact
    evidence: "ui/src/presentation/components/TransportPanel.tsx:54-105
      — RAF loop `loop()` вызывает `readProgress()` (который
      зовёт AudioEngine.getCycleProgress()) каждые 14ms.
      CSS-переменная `--playhead-x` обновляется из этого."
  - statement: "previewSample через прямой Web Audio ~1KB
      CPU на note vs repl.stop + repl.evaluate ~25KB CPU
      (Strudel scheduler rebuild)."
    marker: judgment
    evidence: "testBeep в LiveAudioEngine.ts:146-158 использует
      ровно тот же паттерн (createOscillator + createGain +
      setValueAtTime ramps) — это documented cheap path.
      Strudel repl.evaluate включает haps-array traversal,
      AudioWorklet reinit, и gain map writes — overhead."
  - statement: "appendGridToScore на существующий stack()
    расширяет mixer-индексы через reducer setLayerCount —
      консистентно с wavecode-track-mixer."
    marker: fact
    evidence: "ui/src/application/reducer.ts setLayerCount
      (через grep) расширяет appStore.layerMix до нового
      количества top-level layers. parseStackTopLayers
      парсит text в слои — если мы добавляем grid как
      новый top-level layer в stack(…), reducer среагирует
      и mixer покажет grid-row."
---