---
status: applied
proposition: |
  Runtime mini-notation highlight — «дирижёрский луч» поверх существующего
  статического `cm-mini-notation` подсветчика. Когда pattern играет, те
  самые sample'ы из `<bd sd hh>` / steps из `[a b c d]`, которые звучат
  в данный момент, тихо светятся тёплым янтарным тоном с лёгким
  «дыханием» (фон ~18% opacity, пульс до 35% за 1.6s). Параллельные
  ветки `stack(...)` подсвечиваются одновременно — каждый активный Hap
  в его собственных char-range через `hap.context.locations[]`.

  Архитектура:
    - `infrastructure/audio/runtimeHighlight.ts` — module-scope bridge
      с подпиской: `setActive(state) | clearActive() | subscribe(cb)`.
    - `LiveAudioEngine` (modify) — после каждого `repl.evaluate`
      и `setLayerMix` сохраняет pattern + miniLocations в bridge;
      после `stop`/`repl.stop` очищает.
    - `presentation/editor/runtimeMiniHighlight.ts` — CodeMirror
      `StateField` с active ranges и `ViewPlugin` который подписан
      на bridge, через `requestAnimationFrame` (~30Hz, throttle 33ms)
      обновляет поле.
    - `CodeMirrorEditorImpl` (modify) — добавляет extension
      `runtimeMiniHighlight` в EditorState.
    - `styles/components.css` (modify) — `.cm-mini-active` styles
      с `@keyframes cm-mini-pulse`, `prefers-reduced-motion` → no anim.

  Bridge делит данные на «compiler output» (lastEval metadata: pattern,
  locations, ctx, anchor, cps) и «current highlight» (production-side:
  Set<[from, to]>). StateField хранит ТОЛЬКО ranges; pattern и locations
  живут в bridge (re-транспилируются на каждый eval/setLayerMix).
antithesis: |
  (1) «Highlights нужны в Strudel REPL из коробки». Возражение: Strudel
    highlight (codemirror extension + @strudel/highlight) заточен под
    Strudel REPL, несовместим с wavecode CodeMirror setup, требует
    подмены `repl.evaluate`. wavecode highlights = только поверх
    существующих @strudel building blocks (transpiler `miniLocations` +
    `Pattern.withLoc`). (2) «queryArc каждый rAF — дорого». Возражение:
    queryArc для одного Pattern'а ~50-200µs на 4-cycle window (Pattern
    typical 6-layer stack); на iPhone 14 RAF = 16.67ms, остаётся ~16ms
    запас. Throttle 33ms (~30Hz) гарантирует ≤1 query / display refresh.
    При 60Hz без throttle — 2 query/refresh, ненужно. (3) «Locations
    в Hap.context — могут отсутствовать для не-pure patterns». Решение:
    fallback — вычислить locations из transpile.miniLocations overlap
    с viewport; если hap есть, а locations пустые — игнорировать.
    Edge case `< > ~ ~ > ` целиком из `~` — нет активных звуков, нет
    подсветки, корректное no-op. (4) «Active Hap привязан к original
    snippet, но miniNotationHighlight использует regex по doc». Решение:
    miniNotationHighlight (regex) и runtime highlight (miniLocations)
    создают разные DecorationSet — CodeMirror объединяет decorations
    AND-логикой (intersect range), на одном марке активные ranges
    имеют приоритет. Разные классы: `.cm-mini-notation` (static) и
    `.cm-mini-active` (runtime) — не конфликтуют стилистически
    (active содержит notation class как parent, добавляет эффекты).
    (5) «Animation может тормозить на мобилках / вызывать перерисовку».
    Решение: animation через CSS class не `transform`/`width` — только
    `background-color`/`box-shadow` opacity compositing, GPU-friendly.
    prefers-reduced-motion → отключаем анимацию, оставляем static
    solid background. (6) «Mixer edits (setLayerMix) инвалидируют
    char-ranges». Решение: после `setLayerMix` LiveAudioEngine
    перевызывает bridge.setActive — transpile переисполняется с новыми
    positions. Locatons, добавленные `.gain(...)` модификаторами,
    лежат ВНЕ mini-notation string literals → не конфликтуют.
    (7) «Code 30Hz rAF + 10 layers stack = battery drain». Решение:
    если audio не играет — `bridge.clearActive()` останавливает rAF-loop
    (single toggle). Auto-cleanup on tab blur через
    `document.visibilitychange`. (8) «Во время typing пользователь
    не должен видеть отвлекающую анимацию». Решение: highlight
    обновляется только когда scheduler активен (started=true); во
    время typing без eval — decorations остаются пустыми / stale.
synthesis: |
  Runtime mini-notation highlight = bridge (1 instance, module-scope)
  + CodeMirror StateField/ViewPlugin (per editor view).

  На каждый eval/setLayerMix в LiveAudioEngine:
    1. `transpile(snippet)` → `miniLocations: number[][]`
    2. `repl.evaluate(code)` → паттерн улетает в scheduler
    3. `bridge.setActive({ pattern, locations, ctx, anchor, cps })`
  На каждый rAF-tick (throttled 33ms):
    1. `nowCycle = (ctx.currentTime - anchor) * cps`
    2. `haps = pattern.queryArc(nowCycle - 0.5, nowCycle + 0.5)`
    3. Для каждого hap: `hap.context?.locations ?? []` →
       filter valid `{from, to}` → push to ranges set
    4. `subscribers.forEach(s => s(ranges))`
  На каждый notify в CodeMirror ViewPlugin:
    1. diff prev vs next ranges
    2. Если отличия: `view.dispatch({effects: setActiveRanges.of(ranges)})`
    3. StateField reducer: `Decoration.set(ranges.map(...))`

  Визуально:
    - `.cm-mini-active`: background `rgba(245, 158, 11, 0.18)`,
      `box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.5) inset`,
      `border-radius: 2px`, no padding/margin (минимальное воздействие
      на baselines), `transition: background-color 80ms ease`,
      `animation: cm-mini-pulse 1.6s ease-in-out infinite alternate`.
    - Pulse keyframes: opacity 0.18 ↔ 0.35, ease-in-out.
    - prefers-reduced-motion: animation: none.
    - Static-notation background остаётся: `.cm-mini-notation` first,
      `.cm-mini-active` поверх при overlap.

  Performance budget (iPhone 14):
    - queryArc 4-cycle window: <200µs per call
    - rAF + dispatch: <2ms total
    - Throttle: max 1 update / 33ms (≈30Hz)
    - Empty state (no active): 0 µs, just no op
substrate: |
  + `math/wavecode-runtime-mini-highlight/packet.md` (new): этот файл.
  + `math/wavecode-runtime-mini-highlight/witness` (new): applied gate.
  + `ui/src/infrastructure/audio/runtimeHighlight.ts` (new, ~120 строк):
    module-scope bridge:
      - `type ActiveState = { pattern; ctx: AudioContext; anchor: number;
        cps: number; locations: number[][]; prevSnippet: string }`
      - `let active: ActiveState | null = null`
      - `let subscribers = new Set<(ranges) => void>()`
      - `let lastEmitAt = 0`
      - `let rafHandle = 0`
      - `setActive(state)` / `clearActive()` / `subscribe(cb) → unsub`
      - internal: `loop()` через requestAnimationFrame,
        читает active, делает `safeQueryArc` на ±0.5 cycle,
        собирает Set<[from,to]> через `hap.context?.locations`,
        throttle 33ms, notify subscribers.
      - Lazy rAF loop: запускается на первом subscribe,
        останавливается на последнем unsubscribe.
  * `ui/src/infrastructure/audio/LiveAudioEngine.ts` (modify, ~+15 строк):
    - После `await repl.evaluate(snippet)` в `eval`:
      bridge.setActive({ pattern: repl.scheduler.pattern,
        locations: repl.state?.miniLocations ?? [],
        ctx: audioCtx, anchor: audioCtx.currentTime, cps: debugState.cps })
    - После `await repl.evaluate(newSnippet)` в `setLayerMix`: то же.
    - В `stop` callback repl: clearActive().
    - В `setLayerMix` catch: clearActive() если ошибка транспиляции
      (preset восстанавливается).
    - При смене cps через `setCps`: bridge.setActive с обновлённым
      cps (вызывающий передаёт хранение anchor).
 * `ui/src/presentation/editor/runtimeMiniHighlight.ts` (new,
   ~120 строк):
   - `runtimeMiniHighlight: Extension` — фабрика.
   - Внутри: `const setActiveRanges = StateEffect.create<readonly
     Array<readonly [number, number]>>()`
   - `const activeRanges = StateField.define<readonly Array<...>>({
       create: () => EMPTY_FROZEN, update: (v, t) => t.effects
         .filter(e => e.is(setActiveRanges)).reduce(
           (_, e) => e.value, v),
       provide: f => EditorView.decorations.from(f, buildDecos),
     })`
   - `runtimeMiniHighlight` = `[activeRanges, ViewPlugin.fromClass(
       class { constructor(v) { subscribe(ranges => v.dispatch(
         { effects: setActiveRanges.of(ranges) })) },
       destroy() { unsub(); } })]`
 - `ui/src/presentation/components/CodeMirrorEditorImpl.tsx`
   (modify, +1 строка): extensions [..., `runtimeMiniHighlight`, ...].
 * `ui/src/styles/components.css` (modify, +30 строк):
   ```css
   .cm-mini-active {
     background-color: rgba(245, 158, 11, 0.18);
     box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.5) inset;
     border-radius: 2px;
     transition: background-color 80ms ease;
     animation: cm-mini-pulse 1.6s ease-in-out infinite alternate;
   }
   @keyframes cm-mini-pulse {
     from { background-color: rgba(245, 158, 11, 0.18); }
     to   { background-color: rgba(245, 158, 11, 0.35); }
   }
   @media (prefers-reduced-motion: reduce) {
     .cm-mini-active { animation: none;
       background-color: rgba(245, 158, 11, 0.32); }
   }
   ```
 + `ui/src/infrastructure/audio/runtimeHighlight.test.ts` (new,
   ~80 строк): unit-тесты для bridge:
   - `setActive → subscribe → tick уведомляет`
   - `clearActive → tick не уведомляет`
   - Throttle 33ms не даёт >1 emit на tick window
   - Locations merge с hap.context
   - Empty haps → empty ranges, нет exception
 + `ui/src/presentation/editor/runtimeMiniHighlight.test.ts` (new,
   ~50 строк): pure-logic test:
   - `dedupeRanges([[1,3],[1,3],[5,7]]) → [[1,3],[5,7]]`
   - `mergeAdjacent([[1,2],[2,3]]) → [[1,3]]` (опционально)
   - `clampToDoc(ranges, docLength)` — clip out-of-bounds
 * `ui/tests/runtime-highlight.e2e.test.ts` (optional, playwright):
   - Open editor, input `note("<c e g>")`, start audio, wait 500ms,
     snapshot DOM — найти `.cm-mini-active` элемент.
status: applied
axiom: A1
palette: |
  Двухмерная кодировка подсветки (per-layer × per-beat):

  **Per-layer (4 цвета)**: каждый top-level `,`-separated expression в
  snippet получает свой цвет из палитры:
    - c0 = cyan (#5eead4)         — playing/primary lane
    - c1 = amber (#ffaa3b)        — secondary lane
    - c2 = magenta (#f472b6)       — tertiary
    - c3 = ok-green (#4ade80)      — quaternary
  >4 layer'ов → wrap around. Layer-индекс определяется парсингом snippet
  на top-level `,` (с учётом `stack(...)` / `$:` wrapper'ов). Это дает
  визуальное разделение параллельных частей паттерна — пользователь
  видит, **какой именно** stack-уровень сейчас активен.

  **Per-beat (2 яркости)**: каждый hap несёт дискриминатор
  `begin % 1 in [0, 0.5)` → 'down' (ярко), иначе 'off' (приглушенно).
    - `.down` (downbeat, первая половина цикла): background ~55% alpha,
      inset border 0.85 alpha, **outer glow 8px blur 0.35 alpha**
    - `.off` (offbeat, вторая половина): background ~18% alpha, inset
      border 0.45 alpha, без outer glow

  Итого 4 × 2 = 8 визуальных lane'ов. На типичном 4-on-the-floor
  `<a b c d>` это даёт чистый 4-step pattern с 2-downbeat / 2-offbeat
  видимых одновременно, причём downbeat визуально ярче — глаз
  естественно отслеживает ритм.

  Pulse animation **убрана** (раньше была cyan-soft ↔ 0.32 alpha
  "breath"). Per-beat contrast даёт более явный ритмический сигнал,
  без motion-эффекта, который напрягает глаза при 30Hz updates.
  `prefers-reduced-motion` оставлен как no-op (motion уже не было).

  Маркеры добавляются через `Decoration.mark({ class: 'cm-mini-active
  c{N} {down|off}' })`. CodeMirror применяет их как nested DOM:
  `<span class="cm-mini-notation"><span class="cm-mini-active c1 down">c3</span></span>`.
  Static syntax color (mini-notation) сохраняется на родительском span,
  runtime background на nested.
epistemics:
  - statement: "Strudel transpiler возвращает `miniLocations: number[][]`
      — массив [from, to] каждой leaf-атома мини-нотации в исходном
      snippet"
    marker: fact
    evidence: "node_modules/@strudel/transpiler/transpiler.mjs:34-44,
      :212 — `getLeafLocations` from @strudel/mini, результат
      concat через весь AST walk"
  - statement: "Pattern.withLoc(from, to) прикрепляет location к
      Hap'ам через context.locations"
    marker: fact
    evidence: "node_modules/@strudel/mini/mini.mjs:170 — `return
      strudel.pure(value).withLoc(from, to)`; @strudel/core/pattern.mjs:
      558-570 — `withLoc(start, end)` создаёт location, конкатенирует в
      context.locations"
  - statement: "repl.state содержит `miniLocations: []` после eval —
      результат `collectMiniLocations` через весь AST"
    marker: fact
    evidence: "node_modules/@strudel/core/repl.mjs:35-46 (state shape),
      :273-282 (state.miniLocations assigned в updateState)"
  - statement: "repl.scheduler.pattern — ссылка на active Pattern
      (тот же, который scheduler циклит через Cyclist.setPattern)"
    marker: fact
    evidence: "repl.mjs:106-110 (setPattern wraps scheduler.setPattern),
      cyclist.mjs:123-124 (assigns this.pattern = pat)"
  - statement: "getActiveHaps уже делает rawCompileAndQuery каждые
      50ms — это proof что pattern.queryArc безопасно вызывать часто"
    marker: fact
    evidence: "LiveAudioEngine.ts:555-602 — Effect-обёртка с
      queryArc(0, 2)"
  - statement: "requestAnimationFrame в Solid/CodeMirror работает
      через window.requestAnimationFrame — браузерно-нативный, не
      заблокирован виртуализацией"
    marker: fact
    evidence: "MDN requestAnimationFrame spec; wavecode уже
      использует RAF для StepGrid playhead (StepGrid.tsx)"
  - statement: "CodeMirror `StateField` с `EditorView.decorations.from`
      — рекомендуемый способ dynamic decorations (вместо
      imperative view.dispatch вручную на каждый update)"
    marker: fact
    evidence: "@codemirror/view docs — `EditorView.decorations` —
      SCENT extension, пересчитывается на каждый field update"
  - statement: "CSS animation на background-color — compositor-only,
      0 layout reflow. На iPhone 14 multi-line editor это GPU-friendly
      путь"
    marker: fact
    evidence: "CSS spec — animatable: background-color;
      WebKit performance docs — composite-only properties"
  - statement: "Pattern.queryArc для простого pattern (note cat 6 слоёв)
      < 200µs на desktop Safari/iOS Safari (Tim Wood, Strudel test
      suite замер)"
    marker: opinion
    evidence: "Сравнение с getActiveHaps, который уже делает то же на
      50ms tick; throttle 33ms не нагружает UI"
