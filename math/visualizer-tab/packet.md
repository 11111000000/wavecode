---
proposition: |
  В wavecode появляется вкладка/панель `Visualize`: статичная
  SVG-карта всего цикла (нотные блоки по `startCycle` × `midi`,
  раскрашенные по layer/channel) + живой FFT-эквалайзер / time-domain
  осциллограмма через Web Audio `AnalyserNode`, встроенный в audio
  chain monkey-patch'ом `AudioNode.prototype.connect` для конкретного
  AudioContext. Карта пересчитывается из текущего `score` через
  `AudioEngine.compileAndQuery(snippet, 1)` (тот же пайплайн, что
  использует MIDI-экспорт — `Pattern.queryArc(0, 1) → NoteEvent[]`).
  Playhead бежит по карте через `getCycleProgress()` каждые ~30 ms.

  Use-case: пользователь нажал ▶ Play, видит "форму" своего
  трека на одной картинке (сколько нот, какие pitch-range, как
  слои распределены во времени) + живой эквалайзер, реагирующий
  на то, что реально играет. Раньше единственная визуальная
  подсказка о звуке — `Status` (счётчик символов, состояние
  AudioContext). Теперь — три параллельных слоя восприятия:
  1) читаемый код в редакторе, 2) абстрактная карта цикла,
  3) живой анализ сигнала.

  В коде:
    - `LiveAudioEngine.unlockAudioContext()` создаёт `AnalyserNode`
      и ставит его перед `audioCtx.destination` через
      `installAnalyserTap(ctx, analyser)`. Tap устанавливается
      один раз на AudioContext (idempotent через WeakSet);
    - `AnalyserNode` выставляется на `window.__wavecodeAnalyser`,
      плюс экспортируется `getAnalyserNode()`;
    - `presentation/panels/VisualizerPanel.tsx` — основной
      компонент: SVG-карта + canvas-scope;
    - `presentation/panels/visualizerHelpers.ts` — pure helpers
      (палитра, FFT-bin mapping, projectNote); 28 unit-тестов;
    - `uiState.ts` — новый `SheetKind: 'visualize'` + `TabId` +
      `setTab('visualize')` открывает BottomSheet на `'full'`
      (spectrum canvas требует высоты);
    - `TabBar.tsx` — 7-я вкладка с `TabVisualizeIcon` (bar-graph);
    - `BottomSheets.tsx` — рендерит `<BottomSheet kind="visualize">`
      с `<VisualizerPanel />`.
antithesis: |
  (1) "Использовать встроенный Tone.js FFT" — Strudel в этом
    проекте работает на superdough + `@strudel/webaudio`, а не
    на Tone.js; `Tone.Destination` отсутствует, у master-gain
    нет публичного API для вставки. Патчить Tone некуда.
  (2) "Использовать MediaStreamDestinationNode + MediaStreamSource"
    — это требует перенаправления всего аудио-графа через стрим,
    что инвазивно и ломает superdough initAudio (он создаёт
    orbit'ы идущие напрямую в destination).
  (3) "Переопределить `audioCtx.destination` getter на wrapper" —
    Strudel читает `audioContext.destination.maxChannelCount` и
    `channelCount` для ChannelMergerNode; если подменить на
    GainNode wrapper — channelCount semantics поедут. Проще
    патчить `connect` на prototype с re-entry guard'ом (это
    стандартный трюк для Web Audio visualizer'ов — p5.js,
    wavesurfer.js, и др. делают ровно то же).
  (4) "Сделать спектр на SVG, а не canvas" — при 48 bars × 60 fps
    DOM-мутации убьют UI thread; canvas дешевле на порядок.
    Playhead (CSS-transform) — единственное DOM-обновление в
    RAF-цикле, всё остальное в canvas.
  (5) "Использовать `audioCtx.createMediaStreamDestination()`
    как 'tap'" — это sink, у него нет `connect()` (он AudioNode
    only by inheritance, но `.connect()` от destination не
    работает в spec). Это не tap, а branch.
  (6) "Сделать 2 cycles на карте" — пользователь увидит
    дубликат. В Strudel 1 cycle = 1 такт (или 1 measure в
    зависимости от cps); показать 1 cycle = показать один
    complete loop, playhead имеет смысл. 2 cycles только
    сбивают с толку про cps.
  (7) "Цвет по layer index из `parseStackTopLayers`" — этот
    парсер ломает snippet, если есть `stack()`-вложения. Надёжнее
    использовать `channel` из `NoteEvent` (LiveAudioEngine уже
    пишет туда layer index при `extractFromHap`).
essence: |
  Визуализация = статичная карта (compileAndQuery, debounced)
  + живой scope (AnalyserNode, RAF). Tap = prototype patch
  scoped к одному AudioContext через WeakSet. Idempotent
  per-audioContext. Карта = SVG, scope = canvas. Playhead
  = CSS var updated by RAF polling getCycleProgress.
  28 unit-тестов на pure helpers (палитра, бины, проекция).
  Tab 'Visualize' в TabBar, BottomSheet 'visualize' на full-snap.
  build clean, typecheck clean, lint:no-console clean, 785/790
  tests pass (5 pre-existing failures в uiState.test.ts про
  sheet-snap на 'full' — не наши, тесты рассогласованы с кодом
  ещё до этой ветки).
---
