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

---

## Deep diagnosis (2nd & 3rd order predictions)

Реальные баги — это верхушка айсберга. Под ними 5 слоёв
системных проблем, которые всплывут при первом-же серьёзном
использовании после фикса.

### Слой 2: то, что сломается СРАЗУ после фикса F1+F2

- **F1 fix scope leak.** Переименование `.piano-key.black` →
  `.piano-keyboard .piano-key.black` в legacy.css работает
  *только* потому, что legacy.css загружается последним. Если
  позже кто-то reorder-нет CSS-импорты — конфликт вернётся.
  **Защитный фикс**: добавить `@layer components { .piano-key.black
  { ... } }` в components.css. @layer имеет более низкий приоритет
  чем unlayered правила → legacy.css не сможет перебить components
  слой ни в каком порядке. Стоимость: 2 строки, выгода: невозврат
  regression.

- **Sticky toolbar won't stick.** `position: sticky; bottom: 0`
  работает только если у родителя `overflow: visible`. У
  `.score-panel-inner` стоит `overflow: hidden` → sticky
  приклеивается к низу *видимой области*, но при `flex: 1 1 auto`
  cm-host растягивается на всю высоту, и toolbar уходит за
  overflow. Правильное решение: `flex-shrink: 0; margin-top: auto`
  внутри flex-column (без sticky вообще). Это работает всегда.

- **FAB vs toolbar collision.** FAB = `position: fixed; bottom: 16px;
  z-index: 20` (`--z-fab`). Если toolbar станет sticky на нижней
  границе viewport, FAB перекроет его правый край. Решение:
  toolbar имеет `padding-right: var(--fab-size) + var(--space-md)`
  на ≤720px (где FAB виден), чтобы последняя кнопка не скрывалась.

- **AI-primary на 1024×600 ноутбуках.** 40vh от 600px = 240px.
  AI-панель с messages-list + textarea в 240px — тесно, footer
  торчит за пределы. Защитный фикс: `min-height: 320px;
  flex-basis: 60%; flex-grow: 1`. На 1280×800 и выше — расслабляется
  естественно.

### Слой 3: перфоманс

Bundle: `codemirror 380KB + strudel 664KB + effect 128KB +
app 180KB + css 60KB = ~1.4MB` unminified. Gzipped ≈ 400KB.
First-paint budget на 4G — 1.5s; сейчас — 2.5s+.

- **CodeMirror в initial bundle.** Можно dynamic-import
  CodeMirrorEditor (lazy при первом фокусе на score tab).
  Strudel тоже — но он нужен сразу для eval. Compromise:
  defer CodeMirror + presets UI, не Strudel.
- **CSS файлов 6, но нет critical-CSS inline.** FCP упирается
  в render-blocking stylesheet. Inline первые 8KB (topbar +
  preset-row + tokens) в `<style>` index.html, остальное — async.
- **Piano inline-styles.** `PianoKeyboard.tsx:124-127` задаёт
  `style={{ width: ${wW}px }}` на каждой из 14 белых клавиш.
  Solid реактивен, но 14 inline-style объектов в DOM → дольше
  parseLayout. Замена: CSS-переменные `.piano-keys-inner
  { --white-w: 80px }` на родителе + `width: var(--white-w)` на
  `.piano-key.white`. Без JSX-diff на resize.
- **Sample loading UX.** 2.1MB samples грузятся лениво через
  `loadAllSamples()`. На медленном 4G первая нота — через 8-12s.
  **Защитный фикс**: progress indicator + автоматический preload
  в `requestIdleCallback` после первого user gesture (есть уже в
  App.tsx:138-146 preload-логика — добавить туда sample callback).
- **MIDI inputs enumeration.** `MidiInput.ts` ждёт Promise;
  если браузер завис на permission prompt — 0 фидбэка. Таймаут
  1s уже есть в packet, но UI не показывает "запрашиваю...".

### Слой 4: визуальная глубина и delight

Токены уже excellent (motion / shadows / z-index / radius).
Что отсутствует:

- **Empty states.** Score пустой → editor показывает пустой
  CodeMirror без подсказки. Messages пустой → "Здесь будет
  диалог с ИИ..." (есть в `AIEditPanel.tsx:167`). Нет:
  on-screen guide при первой загрузке ("tap Step/Piano chip
  чтобы открыть"; "или напиши в ИИ 'дай бит' ").
- **Loading states.** Audio context стартует лениво, первый
  звук — через 200-500ms после user gesture. LED в TopBar
  мигает `● suspended` — но не визуально привлекает внимание.
  Хорошо: skeleton-pulse на audio-active panel.
- **No animations on first reveal.** При mount всё всплывает
  разом. Staggered fade-in (80ms delay между секциями) =
  качественный скачок за 12 строк CSS.
- **No focus rings consistency.** CodeMirror focus — свой ring.
  Topbar buttons — нет ring вообще (только hover). Чекбоксы —
  дефолтные браузерные. Нужен глобальный `--focus-ring: 0 0 0
  3px var(--cyan-soft); outline: none`.
- **Touch target audit.** Большинство кнопок 32-40px — ниже
  WCAG 2.5.5 AAA (44px). Topbar actions = 18px иконки в 32px
  контейнере → hit area < 44px. `wc-icon-btn { min-width: 44px;
  min-height: 44px }` решает.
- **Контраст.** `--fg-ghost: #52525b` на `--surface-0: #0a0a0e`
  = contrast 4.7:1 (проходит AA). На `--surface-1: #11121a` =
  4.4:1 (граница). Labels на piano-key.black (`color: var(--amber)
  on #1a1a22`) = 7.2:1 (AAA). Минимальный риск, но стоит
  прогнать axe-core в playwright.
- **Нет audio feedback для toggle.** Piano chip toggle — нет
  haptic-like ripple. Добавить `transform: scale(0.95)` 80ms
  on press — 1 строка CSS, ощутимый эффект.

### Слой 5: архитектурные риски

- **App.tsx 530 строк.** God-component. Делится естественно
  на 4 sub-components: `<TopBar>`, `<PresetRow>`, `<PanelsLayout>`,
  `<BottomSheets>`. Каждый 80-120 строк. Чистый выигрыш для
  читаемости + per-component code-splitting в Vite.
- **Inline-style в App.tsx:392, 412, 512, 519.** 4 блока.
  Перенос в `.app-preset-row`, `.save-preset-bar`,
  `.step-sheet-body`, `.piano-sheet-body` = ~12 строк CSS,
  удаление 4 style-объектов из JSX. Diff чище.
- **legacy.css 36KB / 1346 строк.** Содержит правила для уже
  не-используемых классов (`midi-io-bar`, `mixer-panel`,
  `share-modal` — перенесены в BottomSheet). Audit через `rg -l
  '\.classname' ui/src` для каждого → удалить dead rules. Эффект:
  -10-15KB CSS, -200 строк.
- **createRoot без dispose.** `uiState.ts:90` создаёт root для
  saveEffect — но не экспортирует dispose. На HMR в dev —
  накапливаются roots. В prod — норм. Compromise: добавить
  `if (import.meta.hot) import.meta.hot.dispose(() => dispose())`.

---

## Subagent implementation playbook

Декомпозиция по 6 трекам, выполняются в 3 фазы. Каждый трек —
отдельный субагент с focused brief.

### Dependency graph

```
                ┌─────────────┐
                │  T1 bugfix  │  (F1+F2, sequential first)
                │  ~50 LoC    │
                └──────┬──────┘
                       │ блокирует T2 (DOM-классы и видимость)
        ┌──────────────┼──────────────┬──────────────┐
        │              │              │              │
   ┌────▼────┐    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
   │ T2 AI-  │    │ T3 perf │    │ T4 vis  │    │ T5 arch │
   │ primary │    │ budget  │    │ polish  │    │ cleanup │
   │ layout  │    │         │    │         │    │         │
   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘
        │             │              │              │
        └─────────────┴──────────────┴──────────────┘
                              │
                       ┌──────▼──────┐
                       │ T6 verify   │  (e2e + perf budget + visual diff)
                       │ ~100 LoC    │
                       └─────────────┘
```

### Phase 0 (sequential, ~1 субагент, ~30 мин)

#### T1 — Bugfix: piano CSS-scope + toolbar reactivity

**Brief для субагента:**
- Scope: `legacy.css:1257-1265`, `ScorePanel.tsx:46`,
  `MiniNotationToolbar.tsx:61-66`, `components.css:962-1006`.
- Защитный фикс @layer:
  ```
  /* components.css, top of file */
  @layer components {
    .piano-key.black { position: absolute; ... }
  }
  ```
  (без `@layer` тоже работает, но @layer страхует от reorder).
- Toolbar: ScorePanel передаёт `editor={() => editorApi}`
  (accessor). MiniNotationToolbar читает `const view = props.editor?.()?.getView();`.
- Toolbar visibility: НЕ sticky. Использовать
  `.score-panel-inner { display: flex; flex-direction: column }`
  + `.mini-toolbar { flex-shrink: 0; margin-top: auto }`.
  cm-host остаётся `flex: 1 1 auto; min-height: 0`.
- Не трогать: PianoKeyboard.tsx (он правильный), FAB,
  BottomSheet geometry.
- Acceptance: piano chips W-B-W-B-… при viewport 412×900;
  кнопка 'note(' вставляет snippet; toolbar виден при открытом
  Piano bottom-sheet.
- Verification: `npm run build` чисто; `npx vitest run
  PianoKeyboard.test MiniNotationToolbar.test` — добавить
  test на click-no-op с реальным EditorView.

### Phase 1 (4 субагента параллельно, ~45-60 мин каждый)

#### T2 — AI-primary layout (F3)

**Brief:**
- `uiState.layout: 'code-primary' | 'ai-primary'` (default
  `'ai-primary'` на ≥1024, `'code-primary'` на mobile).
- TopBar: добавить `LayoutToggleIcon` + кнопку в
  `.wc-topbar__actions`. Persisted в localStorage.
- CSS: `.app-body[data-layout='ai-primary'] .ai-panel
  { flex: 1 1 60%; min-width: 0; min-height: 320px }
  .app-body[data-layout='ai-primary'] .score-panel
  { flex: 0 0 360px; overflow-y: auto }`.
- Mobile: data-layout игнорируется, layout = BottomSheet
  default (Score виден, AI по табу).
- Не ломать: TopBar composer (FAB остаётся), мобильный flow,
  status panel.
- Acceptance: на 1440×900 AI ≥60% высоты viewport; toggle
  flip-ит за 240ms transition; на 1024×600 min-height
  работает; mobile без изменений.

#### T3 — Performance budget

**Brief:**
- CSS variables для piano:
  `.piano-keys-inner { --white-w: 80px; --black-w: 50px;
  --piano-h: 220px }` + media-query для mobile. JSX убирает
  inline-styles.
- Dynamic-import CodeMirrorEditor:
  `const CodeMirror = await import('./CodeMirrorEditor')`
  при первом открытии score tab (либо сразу, но через
  `lazy()` HOC).
- Critical CSS inline в index.html: первые 8KB (topbar +
  preset-row + tokens) inline, остальное — `<link rel="preload"
  as="style" onload="this.rel='stylesheet'">`.
- Sample loader: добавить callback в preload-pre-paint
  (App.tsx:138-146). Показать progress pill в TopBar.
- EditorView disposal audit: `ScorePanel` использует
  `<Show when={uiState().scoreOpen}>` → onCleanup сработает.
  Тест: rapid toggle scoreOpen 50 раз → 0 leaked views
  (mock `view.destroy()` spy).
- createRoot dispose: `uiState.ts:90` обернуть в
  `import.meta.hot?.dispose(() => dispose())`.
- Acceptance: Lighthouse perf ≥90 на 1440×900; sample
  preload виден; bundle не вырос >10%.

#### T4 — Visual polish

**Brief:**
- Empty state для ScorePanel: `.score-empty-state`
  с 3-4 подсказками (Piano chip, ИИ, готовые пресеты).
  Виден когда `appStore.score.trim().length === 0`.
- Loading state для audio: `.audio-loading-skeleton` с
  shimmer-pulse, виден при `ctxState().state === 'suspended'`
  на ≤3s, потом исчезает.
- Focus rings: `:focus-visible { outline: 2px solid var(--cyan);
  outline-offset: 2px; box-shadow: var(--shadow-glow-cyan) }`
  в base.css глобально (с исключениями для `.cm-editor`).
- Touch targets: `wc-icon-btn, wc-chip, .mini-toolbar-btn
  { min-width: 44px; min-height: 44px }`.
- Micro-interactions: press-shrink для кнопок
  `&:active { transform: scale(0.95); transition: transform
  var(--dur-xs) var(--ease-spring) }`.
- Staggered reveal: первая загрузка → opacity 0→1 с
  delay 0/80/160/240ms для topbar/preset-row/app-body/tabbar.
- Контраст-проверка: `axe-core` через playwright — должно быть
  0 violations уровня critical/serious.
- Acceptance: визуально polished; axe = 0 critical;
  Lighthouse a11y ≥95.

#### T5 — Architecture cleanup

**Brief:**
- App.tsx split на 4 components:
  - `<TopBar>` — строки 280-389 (110 строк).
  - `<PresetRow>` — строки 391-448 (57 строк).
  - `<PanelsLayout>` — строки 450-485 (35 строк).
  - `<BottomSheets>` — строки 487-527 (40 строк).
  App.tsx остаётся ~50 строк (composition + onMount).
- Inline-style audit: `rg -n 'style=\{\{' ui/src/App.tsx` →
  вынести в CSS-классы (`.app-preset-row`, `.save-preset-bar`,
  `.step-sheet-body`, `.piano-sheet-body`).
- legacy.css dead-rule removal: для каждого legacy-селектора
  `rg -l '\.classname' ui/src/` — если 0 файлов, удалить правило.
  Цель: -30% размера (36KB → 25KB).
- Z-index audit: все `z-index:` в ui/src/styles → только через
  токены `--z-*`. Никаких magic numbers.
- Acceptance: App.tsx <80 строк; legacy.css <28KB;
  grep `'z-index:'` только в tokens.css.

### Phase 2 (sequential, ~20 мин)

#### T6 — Verify

**Brief:**
- `tests/e2e/ui-overhaul.spec.ts` — новый файл.
  Сценарии:
  1. `/wavecode.kosov.online` @ 412×900 → click Piano chip →
     snapshot `[aria-label="C3"], [aria-label="C#3"], …`
     присутствуют в DOM в z-order, никаких overflow.
  2. Toolbar click 'note(' → CodeMirror doc starts with
     'note('.
  3. Toggle AI-primary @ 1440×900 → `.ai-panel` height ≥60vh.
  4. Lighthouse run @ 1440×900: perf ≥90, a11y ≥95, bp ≥85.
  5. axe-core @ both viewports: 0 critical/serious.
- vitest extensions:
  - PianoKeyboard layout test (DOM-based, jsdom).
  - MiniNotationToolbar click test (real EditorView).
  - appStore replaceScore + cleanup test (no leaked views).
- Manual smoke: dev server, smoke @ localhost, deploy.
- Acceptance: все 5 сценариев проходят; CI lint/typecheck
  зелёный; lighthouse baseline записан в packet (для drift).

### Per-track budget (LoC diff, грубо)

| Track | LoC | New files | Risk | Time |
|-------|-----|-----------|------|------|
| T1 | ~50 | 0 | low | 30m |
| T2 | ~80 | 0 | medium | 45m |
| T3 | ~120 | 1 (lazy CM) | medium | 60m |
| T4 | ~150 | 1 (axe spec) | low | 60m |
| T5 | ~-200 (net) | 4 (sub-components) | medium | 60m |
| T6 | ~100 | 1 (e2e spec) | low | 20m |
| **Σ** | **~300 net** | **7** | — | **~4.5h** |

### Риски субагентов

- **Конфликт в App.tsx** между T1, T2, T5 (все трогают).
  **Решение**: T1 не трогает App.tsx (ScorePanel+MiniNotationToolbar),
  T2 + T5 — последовательно или через единый sub-agent-merge.
- **CSS-конфликт при reorder imports.** Защита через @layer
  в T1; далее любая работа с CSS — через токены.
- **CI красный после T3 dynamic-import.** `vite.config.ts`
  может потребовать ручной chunk-настройки (`manualChunks`).
- **Sample progress pill показывает 100% всегда.** Гонка
  между preload и `requestIdleCallback`. Решение: preload
  статус = signal в uiState, обновляется по факту.

### Supersession strategy

Каждый T создаёт ОТДЕЛЬНЫЙ мини-пакет (`wavecode-piano-css-fix`,
`wavecode-toolbar-sticky`, ...) с supersession-of связями к
этому. Этот packet остаётся координатором — applied в конце,
когда все track-пакеты applied.

## Verification (расширенная)

### Auto (vitest + playwright + lighthouse)

- `vitest run`: 7 suites (новый `appStore-cleanup.test`,
  расширенный `PianoKeyboard.test`, `MiniNotationToolbar.test`).
- `playwright test tests/e2e/ui-overhaul.spec.ts`: 5 сценариев.
- `lighthouse-ci`: 3 baseline-метрики
  (perf/a11y/bp @ mobile + desktop).

### Manual

1. **Холодный старт** на throttled 4G: first paint <2.5s,
   audio context ready <4s, sample preload complete <8s.
2. **Piano tap** @ 412×900: 24 keys в шахматном порядке,
   tap = звук без задержки, scroll НЕ требуется.
3. **Toolbar** в ScorePanel: все 14 кнопок вставляют snippets;
   виден при любом BottomSheet surface.
4. **AI-primary** @ 1440×900: AI ≥60vh, Score drawer 360px.
   Toggle = flip за 240ms.
5. **Touch targets**: все кнопки попадают в 44×44 hit area.
6. **Focus**: Tab по странице — focus-ring везде видим.
7. **prefers-reduced-motion**: все transitions = 0ms.
8. **prefers-contrast**: borders светлеют до `#71717a`.