---
proposition: |
  В Score-панели под редактором — collapsible `<details>` «🎛 Mixer»
  со списком слоёв партитуры. Каждый слой — строка `[M] [S] ──── ○ ── 0.5`
  (mute / solo / gain slider 0..1.5). Mixer side-state хранится в
  `appStore.layerMix: LayerMix[]` (отдельно от score, чтобы ИИ-edit
  не задевал mixer), при `audio.eval` слои прокидываются через
  preprocessor `application/useCases/injectMix.ts` (pure): парсит
  score в `stack(l1, l2, ...)` через `@strudel/transpiler.transpiler`,
  заменяет каждый `.gain(X)` → `.gain(layerMix[i].gain ?? X)`, к
  muted добавляет `.mul(0)`, soloed-only-passes через
  `.set pattern value with mask`.
antithesis: |
  (1) Парсинг `stack(l1, l2, ...)` через transpiler — нет гарантии
    что score это ровно stack. Альтернатива: regex split на `,\n`
    наивный — ломает вложенные `stack`, вложенные скобки.
    Решение: транспилер.parse (из `@strudel/transpiler`), затем
    walk AST. (2) Mixer state меняет score каждый раз → tripит
    `replaceScore`, blow up history undo. Решение: mixer state
    ОТДЕЛЬНО от score (вне reducer), `replaceScore` срабатывает
    только от manual edit / ИИ / preset (mixer-side-effect в
    audio.eval wrapper). (3) `.mul(0)` vs `.gain(0)` — `gain` → amplitude
    scalar in pattern value, `mul` — global pattern mask.
    Для mute: правильнее `.gain(0)` чтобы не ломать downstream
    chain (e.g. `.mul(0)` убивает envelope). (4) Solo нескольких
    треков одновременно — должно mute'ить все остальные. Решение:
    `gain = soloed ? gain : 0` для каждого слоя. Solo of NONE →
    bypass. (5) Layer indexing: один stack с 6 слоями — 6 строк
    mixer; но юзер добавляет новый layer — mixer должен
    auto-resize. Решение: на каждый `audio.eval` парсер обновляет
    `layerMix.length` через reducer event `setLayerCount`.
synthesis: |
  Mixer side-state живёт параллельно score. На каждый `audio.eval` мы
  (1) parse snippet AST → top-level layer count, (2) reconcile
  `layerMix.length` (add empty entries / drop extras), (3) inject
  per-layer `.gain()` и mute logic. Муте/соло — runtime effect,
  не меняют score, ИИ-edit игнорируют mixer. UI рисует актуальный
  state, с номерами слоёв 0..N. На iPhone — vertical scroll,
  большой слайдер (44px tall), tap target M/S квадрат 36px.
  Snapshot учится sync'ить `cps`-slider (через
  transportState/Swing — пакет transport-panel).
substrate: |
  + `domain/types.ts`: `AppState.layerMix: LayerMix[]` (initial
    пуст, resize в `audio.eval` reducer flow); type LayerMix =
    `{ layerIndex: number; gain: number; muted: boolean;
    soloed: boolean }`.
  + `application/useCases/injectMix.ts` (new): pure fn —
    `injectMix(score: string, layerMix: LayerMix[]): string` —
    parse via `@strudel/transpiler.transpiler`, walk AST,
    оборачивает top-level expressions в `gen`-функцию
    `.gain(injected).`. Mute → `.gain(0)`. Solo → if any soloed,
    else noop.
  + `application/reducer.ts`: новые `AppEvent` —
    `setLayerGain {index, gain: 0..1.5}`, `toggleLayerMute
    {index}`, `toggleLayerSolo {index}`, `setLayerCount {count}`
    (reconcile mixer state size with parsed stack count).
  + `presentation/state/transportState.ts` (общий или new): mixer
    signals, debounced sync с reducer (как cps-signal).
  + `presentation/components/MixerPanel.tsx` (new): вертикальный
    список rows с mute/solo checkbox + gain slider,
    с inline label «Layer 0 — bass», label auto-name через
    `n(` / `note(` / `s(` detection.
  + `presentation/state/audioActions.ts`: `evalScore()` →
    `evalWithTransport()` (chain), теперь идёт ПОСЛЕ mix
    injection: `injectMix(score, layerMix) → eval`.
  + `ScorePanel.tsx`: рендер `<MixerPanel />` под
    `<MidiIOButtons />` (collapsible `<details>` блок).
  + `index.css`: `.mixer-row` (flex row, 44px height);
    `.mixer-mute` (toggle 24px square checkbox); `.mixer-solo`
    (yellow accent); `.mixer-gain` (range input).
  + `domain/layers/parseStack.ts` (new): pure fn
    `parseStackTopLayers(score: string): LayerDescriptor[]`
    через transpiler (или fall-back regex split, документируем
    как less accurate).
  − ничего не удалено.
status: applied
axiom: A1
epistemics:
  - statement: "Strudel `.gain()` chain operator — accepts scalar or
      pattern; ставится перед другими chain операторами в правильном
      порядке для chorus/reverb downstream"
    marker: fact
    evidence: "Strudel Pattern docs — `.gain(value)` — multiplicative
      scalar on amplitude; chain order неважен для gain (последний
      выигрывает), но для envelope — порядок важен"
  - statement: "`@strudel/transpiler.transpiler()` парсит строку →
      pattern AST, позволяет inspect top-level expressions"
    marker: judgment
    evidence: "midi-io package (sha 2745586) уже зовёт
      `transpilerMod.evaluate`; pattern.queryArc — runtime
      эффект, но `.parse()` / `.parseSync()` — sync AST"
  - statement: "Mixer меняет runtime audio НЕ score — undo-history
      НЕ заделан (replaceScore не дёргается на slider change)"
    marker: fact
    evidence: "App.tsx:80-92 createEffect на appStore.score — mixer
      триггерит только audio.eval, не score mutation"
  - statement: "Layer names auto-detected по first token: `note(...)`
      → «Bass/Piano» heuristically, `n(...)` → «Arp», `s(...)` →
      «Samples», всё остальное → «Layer N»"
    marker: judgment
    evidence: "практика DAW-mixers (Logic, Reaper) — auto-name по
      track number, manual rename opt-in"
  - statement: "Solo group semantics: if any soloed, only soloed
      audible; else all audible (per-mute). Это universal DAW rule"
    marker: fact
    evidence: "Logic Pro, Ableton, ProTools — solo = exclusive mute
      cascade"
  - statement: "iOS Safari `<input type=range>` thumb 30px+ для
      пальца; CSS `-webkit-appearance: none` + pseudo-element
      `::-webkit-slider-thumb` позволяет увеличить до 44px"
    marker: fact
    evidence: "Apple HIG — tap targets ≥44pt; CSS slider-thumb size
      controls via `appearance: none` + thumb width"
  - statement: "Stack с вложенными `stack()` (layer 2 = sub-stack
      of 3 voices) — top-level mixer sees 1 layer; sub-mixer
      видит только этот layer. Documented limitation: sub-mixing
      not supported in v1 (future packet)"
    marker: fact
    evidence: "Strudel mini-notation упрощает вложенность — встречается
      редко в коротких preset'ах (8 presets — все flat stack)"
  - statement: "Mixer UI layout: row = [M] [S] [name] [─────○────]
      [gain-value]; шаблон flexbox 5 columns, slider flex-grow 1"
    marker: fact
    evidence: "стандартное desktop mixer layout; mobile — vertical
      (1 column)"
---
