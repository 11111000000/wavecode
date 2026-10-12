---
proposition: |
  UI-design overhaul wavecode: устранить рассогласование legacy.css с
  components.css (чёрные клавиши выпадают из piano), починить неработающие
  кнопки MiniNotationToolbar (editorApi — не-signal), вытащить toolbar из-под
  bottom-sheet (sticky к score-panel), перевернуть приоритет видимости
  (AI-чат как главный экран, код как вторичная панель), и провести единый
  визуальный pass (inline-styles → CSS, dedup legacy, унификация spacing).
  Делается в 4 инкрементальных фазах, каждая — отдельный коммит + пакет.
outcome: |
  После применения пакета: piano 24-клавишный рисуется как W-B-W-B-…
  (без «сбоку прилепленных»); MiniNotationToolbar виден и кнопки
  вставляют snippets в CodeMirror; AI-чат занимает доминирующую
  площадь viewport (≥50%), редактор уходит в collapsed drawer/sheet;
  CSS dedup-нут (legacy.css оставлен только для не-piano классов);
  ни одного inline style-объекта в App.tsx кроме критичных динамических.
invariant: |
  - .piano-key.black { position: absolute; z-index: 2 } — все 10 чёрных
    клавиш позиционируются абсолютно поверх whites по left = (wIdx+1)*wW - bW/2.
  - MiniNotationToolbar получает editor через Solid accessor (function),
    не через прямой let-binding. Click → dispatchInsertSnippet всегда
    находит view.
  - MiniNotationToolbar.bottom-никее приклеен к низу score-panel через
    position: sticky (bottom: 0 внутри flex-column) и НЕ закрывается
    bottom-sheet (sheet имеет top: var(--header-h), toolbar в score-panel
    выше этого top, поэтому не пересекаются).
  - При ≥1024px AI-panel занимает flex: 1 1 60% (доминантная), ScorePanel —
    flex: 0 0 360px collapsed drawer справа. На mobile — AI выезжает по
    табу «AI», по умолчанию Score виден (inverse к текущему compact).
  - В App.tsx нет inline-style объектов длиннее 1 свойства кроме
    динамических (resize-derived, keyframes-substitute).
test: |
  - playwright snapshot /wavecode.kosov.online при viewport 412×900:
    тап «Piano» chip → bottom-sheet full → piano keys видны полностью,
    скриншот содержит 14 whites + 10 blacks в шахматном порядке, никаких
    overflow-x полос прокрутки.
  - тап любой кнопки в MiniNotationToolbar (e.g. 'note(') → CodeMirror
    получает 'note(' в позиции курсора (verify через editor.state.doc).
  - viewport 1440×900 → AI-панель занимает ≥60% высоты, score drawer
    справа 360px. Toggle «Score» header → drawer закрывается, AI на full.
  - vitest: PianoKeyboard layout test (white-index + black-position
    invariants); MiniNotationToolbar click-test с реальным EditorView
    через create-test-editor helper.
antithesis: |
  (1) «CSS-conflict в piano — минор, можно просто удалить 3 строки из
  legacy.css». Возражение: удаление сломает другие классы, которые
  legacy.css ещё держит (.ai-panel, .status-panel, .app-preset-row и
  т.д.). Правильный путь — точечно отключить ТОЛЬКО .piano-key.black,
  через @layer / specificity bump, не снося файл целиком.
  (2) «Toolbar editorApi — пусть ScorePanel передаёт сигнал, и точка».
  Возражение: Solid-правильный путь — accessor `editor={() => api}`,
  который перевычисляется при mount. Это лечит и текущий, и любой
  будущий сценарий где editor пересоздаётся (preset load).
  (3) «AI как главный экран — спорное UX-решение, юзер привык кода».
  Возражение: юзер сам сказал «AI должен быть на самом видном месте».
  Делаем по запросу; если потом передумает — toggle в TopBar даёт
  flip в одно нажатие. Стоимость = 0.
  (4) «Inline styles — это нормально, не over-engineering убирать».
  Возражение: inline-style в JSX ломает hot-reload diff (Vite не может
  инкрементально обновить), мешает темизации (--space-md в style-string
  не реактивен на prefers-color-scheme), и при рефакторе spacing-rules
  разъезжаются с токенами. Перенос в CSS = чистый выигрыш.
synthesis: |
  4 фазы, каждая ≤200 строк diff, каждая рендерибельна независимо:

  F1. Piano CSS-conflict fix (1 файл, ~10 строк):
    либо `.piano-key.black { position: absolute !important }` в
    components.css (специфичность выигрывает у legacy.css), либо
    переименовать селектор legacy на `.piano-keyboard .piano-key.black`
    (scope legacy к старой разметке). Первый — быстрее; второй — чище.
    Выбираем второй: legacy.css остаётся для ещё-рабочих классов,
    новые компоненты не получают случайных override-ов.

  F2. MiniNotationToolbar reactivity + sticky positioning:
    - ScorePanel: `editor={() => editorApi}` (accessor), не `editor={editorApi}`.
    - MiniNotationToolbar: `const view = editor?.().getView()`.
    - CSS: `.mini-toolbar { position: sticky; bottom: 0; z-index: 5 }` —
      прилипает к низу score-panel-inner, выше cm-host с overflow.
    - ScorePanel layout: `flex-direction: column; height: 100%`,
      cm-host `flex: 1 1 auto; min-height: 0`, toolbar `flex: 0 0 auto`.

  F3. AI-primary layout flip:
    - App.tsx body: на ≥1024px добавить class `.app-body--ai-primary` →
      CSS: `.ai-panel { flex: 1 1 60%; min-height: 0 } .score-panel
      { flex: 0 0 360px; overflow-y: auto }`. Mobile — без изменений
      (BottomSheet-ы уже инвертированы: Score виден по умолчанию, AI
      по табу).
    - Toggle-кнопка в TopBar (icon: layout-switch) переключает
      uiState.layout = 'code-primary' | 'ai-primary'. Persisted.

  F4. Design consistency pass:
    - App.tsx: вынести 4 inline style-блока в .app-preset-row,
      .save-preset-bar, .app-body wrapper — все в classes.
    - legacy.css audit: оставить только классы, которые ещё
      используются (rg -l .classname ui/src). Удалить dead rules.
    - Токены: добавить --touch-target-comfortable (52px), --gap-grid
      (8px), --panel-min-h (240px) для унификации spacing.

  Каждая фаза = 1 коммит + 1 мини-пакет (или дополнение к этому).
  После F1+F2 пользователь видит конкретный фикс двух багов;
  F3 — UX-инверсия (заметно сразу); F4 — превентивный рефакторинг.
status: draft
axiom: A1
---

## Диагностика (корни трёх багов)

### Баг 1: «чёрные клавиши прилеплены сбоку»

Корень — CSS-cascade conflict:

`ui/src/index.css:25` — порядок загрузки:
```
tokens → base → components → sheets → icons → legacy
```
`legacy.css` загружается **последним**, при равной специфичности
выигрывает.

`ui/src/styles/legacy.css:1257-1265`:
```css
.piano-key.black {
  flex: 0 0 22px;
  position: relative;          /* ← win */
  margin: 0 -11px;
}
```

`ui/src/styles/components.css:985-992`:
```css
.piano-key.black {
  position: absolute;          /* ← lose */
  z-index: 2;
}
```

Итог: чёрные клавиши — flex children (inline-flow), идут после 14
белых. Отрицательный margin -11px подтягивает их на 22px влево, но
всё равно они визуально приклеены к правому краю.

Дополнительный нюанс: `PianoKeyboard.tsx:117-176` для каждой чёрной
клавиши считает `left = (wIdx + 1) * wW - bW/2` — это для absolute.
При `position: relative` это свойство игнорируется, клавиши
выстраиваются по flex-direction: row в конце потока.

### Баг 2: «кнопки toolbar ничего не делают»

Корень — broken Solid reactivity:

`ui/src/presentation/panels/ScorePanel.tsx:46`:
```jsx
let editorApi: CodeMirrorEditorApi | undefined;
// ...
<MiniNotationToolbar editor={editorApi} />   // ← let-binding
```

В Solid JSX-выражение `editor={editorApi}` отслеживается только если
`editorApi` — это signal/getter. Обычный `let` reassigned в onMount
**не запускает re-render**. На момент первого рендера toolbar
`editor === undefined`, потом `editorApi` присваивается, но toolbar
об этом не знает.

`MiniNotationToolbar.tsx:61-66`:
```ts
const view = props.editor?.getView();   // undefined на момент клика
if (!view) return;                       // silent no-op
```

### Баг 3: «toolbar скрыт панелью»

`ui/src/styles/legacy.css:485-498`:
```css
.score-panel-inner {
  display: flex; flex-direction: column;
  flex: 1 1 auto; min-height: 0;
  overflow: hidden;
}
.score-panel-inner > .cm-host {
  flex: 1 1 auto; min-height: 0; height: auto;   /* ← съедает всё */
}
```

cm-host с `flex: 1 1 auto` заполняет всю высоту; toolbar ниже —
за пределами видимой области (panel overflow: hidden). MiniNotationToolbar
рендерится **в DOM**, но **за нижней границей** score-panel-inner.

Когда пользователь открывает Piano/Step bottom-sheet (`bottom: tabbar-h +
safe-bottom`, max-height: 100vh - tabbar - safe - header), sheet
занимает нижнюю часть viewport. Score panel внутри `.app-body` имеет
`overflow: hidden` — не скроллится. Toolbar физически недоступен
без resize/scroll. На mobile bottom-sheet закрывает нижнюю треть —
toolbar именно там.

### Баг 4: «AI не на видном месте»

`ui/src/styles/legacy.css:500-505`:
```css
.ai-panel[data-open='true'] {
  flex: 0 0 auto;
  min-height: 200px;
  max-height: 40vh;
}
```

`.score-panel { flex: 1 1 auto }` — ScorePanel забирает всё
оставшееся место. AI-панель — 40vh максимум, внизу стека.
ScorePanel → CodeMirror занимает ~60-80vh. Юзер видит код
доминантно, AI как нижнюю ленту. Это **обратное** тому, что юзер
хочет.

Mobile (BottomSheet) — по умолчанию `compactState` (`aiOpen: false`),
AI вообще закрыт. Юзер должен тапнуть таб «AI» → выезжает sheet.
Score виден сразу, AI — по запросу. **Инверсия на mobile тоже**.

### Баг 5 (доп.): общее качество дизайна

- `ui/src/App.tsx` — 530 строк, 8 импортов state-модулей, 4 inline
  style-блока (`App.tsx:392`, `App.tsx:512`, `App.tsx:519`). Должен
  быть чисто layout + delegation, не presentation logic.
- `legacy.css` (33 KB) — shim, оставшийся от migration на «wc-*»
  класс-систему. Содержит правила для уже-не-используемых классов
  (.midi-io-bar, .mixer-panel из старого ScorePanel). 30%+ правил —
  dead code, но удалить вслепую нельзя (CSS audit нужен).
- 2 системы классов: `.wc-*` (новая, components.css) и legacy
  (`.score-panel`, `.ai-panel`, `.app-body`, `.cm-host`). Акт
  переноса не завершён → дизайн «между двух стульев».
- z-index scale (--z-sheet=40, --z-modal, --z-tabbar=+10 от sheet)
  — 3 разных baseline-а. Высокий риск случайных столкновений.
- Spacing: используются `--space-xs/sm/md/lg/xl`, но 4 места
  имеют inline `padding: 'var(--space-md)'` — не реактивно на
  prefers-color-scheme (теоретически) и невидимо для design-tokens
  grep.

## Verification

### Auto (vitest + playwright)

- `PianoKeyboard.test.ts` дополнен: layout-invariants — для каждой
  black-клавиши `getBoundingClientRect().left` строго между
  предыдущего white.right и следующего white.left (или overlap).
- `MiniNotationToolbar.test.ts` дополнен: реальный EditorView
  через `create-test-editor` (in-memory CodeMirror state) → клик
  'note(' → doc содержит 'note(' в позиции cursor.
- Playwright e2e: snapshot `/wavecode.kosov.online` при
  viewport 412×900 → click Piano chip → sheet full →
  piano keys snapshot содержит `[role=button][aria-label="C3"],
  [aria-label="C#3"], [aria-label="D3"], [aria-label="D#3"]…` —
  24 шт. в правильном z-order.
- Toggle AI-primary layout → snapshot DOM `.ai-panel` ≥50% высоты
  viewport, `.score-panel` collapsed drawer справа.

### Manual

1. Piano chip открыт → sheet full → 2 октавы видны без scroll.
   Чёрные клавиши над белыми в правильных интервалах.
2. ScorePanel тап любой кнопки в mini-toolbar (e.g. 'note(') →
   в редакторе появляется 'note(' в позиции курсора. Курсор после.
3. Toolbar виден при открытом Piano sheet (sheet закрывает bottom,
   но toolbar в score-panel-inner sticky → виден выше).
4. AI-primary layout: на desktop AI-чат — главный, ScorePanel —
   360px drawer справа. Toggle в TopBar возвращает обратно.

## Sequence (commit order)

| # | Scope | Files | Diff ~ | Risk |
|---|-------|-------|--------|------|
| F1 | Piano CSS conflict | legacy.css | -5 / +3 | low |
| F2 | Toolbar reactivity + sticky | ScorePanel, MiniNotationToolbar, components.css | +20/-10 | low |
| F3 | AI-primary layout | App.tsx, components.css, uiState | +60/-20 | medium (UX reversal) |
| F4 | Design consistency pass | App.tsx, legacy.css, tokens.css | +40/-80 | medium |

F1+F2 — обязательные bug-fix. F3 — UX-inversion по запросу юзера.
F4 — после F3 design-system cleanup.

## Supersedes / relates

- `math/wavecode-piano-input/packet.md` (2026-10-09) — original
  piano design. Этот пакет supersede-ит CSS-часть (absolute →
  relative из-за legacy conflict), логика tap/MIDI остаётся.
- `math/wavecode-mobile-tabbed-sheet-routing/packet.md` (2026-10-11) —
  BottomSheet routing. Этот пакет зависит от него (sheet geometry
  не меняется), но добавляет правило: при AI-primary на desktop
  AI-панель — НЕ BottomSheet, а inline flex-pane.