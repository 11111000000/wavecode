---
proposition: |
  В шапке wavecode, рядом с `▶ Запуск`, появляется toggle `🎹 Step`. В on —
  над `CodeMirrorEditor` в `ScorePanel` рендерится `<StepGrid />` —
  8-колоночный × 4-строчный pad-grid (kick / snare / hat / clap →
  строки; 8 step'ов → колонки). Tap на ячейку = toggle ноты в паттерне.
  Активные step'ы имеют CSS-анимацию pulse. Кнопка `↻ clear` сбрасывает.
  Кнопка `↑ load` подменяет score на синтезированный `stack(...)` из
  активных ячеек (4 строки × `s("bd sd ... ...")`); в URL-share и
  ИИ-edit отправляется ЭТОТ score (не `<StepGrid/>`-внутренний state).
  При tap проигрывается sample через `AudioEngine.eval` (мини-eval
  с одним тактом) — пользователь слышит результат немедленно.
antithesis: |
  (1) Step sequencer — это «не для профи, профи кодят». Возражение:
    профи хотят СРАЗУ слышать результат, а не печатать Strudel-код,
    потом eval'ить, потом фиксить. Pad-grid даёт немедленный sonic
    feedback. (2) 8×4 слишком крупно для мобила. Решение: 8×4 на
    desktop, на mobile scroll horizontally до 16 step'ов через `overflow-x`.
    (3) Конфликт с CodeMirror input. Решение: `<details>` блок,
    collapsed by default. (4) tap-conflict с CodeMirror focus. Решение:
    tap на pad — preventDefault + stopPropagation. (5) Не сразу
    понятно, какая нота играет. Решение: row label (kick / snare / hat /
    clap) подсвечивается при tap + sample-им'я в title-атрибуте.
synthesis: |
  Step sequencer — это второй input mode в wavecode. Два режима
  сосуществуют: text-editor (код) и pad-grid (тапы). Score остаётся
  текстом Strudel (single source of truth), grid state — derived
  state в `presentation/state/gridState.ts`. Tap на pad = `gridState`
  toggle + emit-synthesized-score + auto-eval (если audio уже
  started). Кнопка `↑ load` копирует синтезированный score в основной
  editor (dispatch replaceScore). Это позволяет:
    - tap-and-go workflow на мобиле
    - визуальный «beat sketch» для профи
    - и экспорт ИИ-редактируемого кода (Score = string)
  Не конкурирует с mixer/transport/record — все эти работают
  поверх того, что в score. Т.е. stack = grid + mixer + transport wrap.
substrate: |
  + `domain/music/gridTypes.ts` (new): `GridCell`, `GridRow` types.
  + `presentation/state/gridState.ts` (new): signal `grid: GridRow[]`,
    `toggleCell(row, col)`, `clearGrid()`, `gridToScore(grid)` →
    синтезированный Strudel string.
  + `presentation/components/StepGrid.tsx` (new): 4×8 grid, tap=toggle,
    pulse animation, row labels, `↻ clear` + `↑ load` buttons.
  + `presentation/components/StepGrid.test.ts` (new): grid toggle,
    clear, gridToScore synthesis (8 columns = 1/8 каждый).
  + `App.tsx`: добавить `🔲 Step` toggle в `.app-controls-row` рядом
    с `▶ Запуск`. Active → `<StepGrid />` рендерится в `<ScorePanel>`
    поверх editor.
  + `ScorePanel.tsx`: `<Show when={showStepGrid}><StepGrid/></Show>`
    перед `<CodeMirrorEditor>`.
  + `index.css`: `.step-grid`, `.step-cell`, `.step-cell.active`
    (pulse animation), `.step-cell.tap-flash` (200ms yellow flash).
  + `presentation/state/audioActions.ts`: helper `evalOneCycle(score)` —
    быстрый `audio.eval` для tap-preview.
  + e2e spec: `tests/e2e/step-grid.spec.mjs` — toggle 4 cells, expect
    `?s=` содержит score с правильным mini-notation.
status: applied
axiom: A1
witness:
  applied_at: 2026-10-09
  commit: 39e7c28
  supersedes: null
epistemics:
  - statement: "Strudel samples по умолчанию: `s('bd sd hh cp')` работают
      из коробки через superdough — drum samples встроены в Strudel"
    marker: fact
    evidence: "Strudel docs: `s('bd sd hh cp')` = bass drum, snare,
      hi-hat, clap — все встроенные samples через Tone.js drum-machines"
  - statement: "mini-notation `*8` распределяет 1 элемент на 1/8 цикла"
    marker: fact
    evidence: "Strudel docs Pattern operators: `*8` (slowcat) повторяет
      каждый элемент 8 раз на равные доли"
  - statement: "CSS pulse animation через @keyframes работает
      в браузерах; tap-flash можно сделать через `animationend` event"
    marker: fact
    evidence: "MDN CSS Animations: `@keyframes pulse { 0%, 100% { opacity: 1; }
      50% { opacity: 0.6; } }` — standard"
  - statement: "8-бит drum grid = 1 cycle / 8 = 1 step per 1/8"
    marker: judgment
    evidence: "DAW convention: 16-step grid = 2 cycles of 8th notes;
      для 1-cycle pattern 8 step'ов покрывает 1/8 каждый — достаточно
      для sketch"
  - statement: "Tap-target ≥ 44px Apple HIG; на 320px viewport 8 columns
      = 40px каждый (без padding); на 720px = 90px каждый"
    marker: fact
    evidence: "Apple HIG 44pt minimum tap target; CSS `width: calc(100% / 8)`
      с padding 2px = 38-88px column width"
---
