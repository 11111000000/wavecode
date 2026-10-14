---
proposition: |
  Удалить дублирующую полосу табов внутри BottomSheet (Mixer/AI/Status/
  Step/Piano) — это вторая навигация рядом с основной (TabBar внизу
  экрана), и на маленьких вьюпортах (≤720px) верхняя полоса
  визуально теснит заголовок панели и подсветку активного таба
  делает за пользователя. Источник истины для выбора инструмента —
  TabBar; in-sheet strip убирается, оставляем только `<h2 title>`.
antithesis: |
  (1) «Нужен быстрый доступ к другому инструменту, не закрывая
    sheet». Возражение: пользователь может тапнуть любой таб в
    TabBar — он автоматически переключит открытый sheet (setTab
    уже синхронизирует snap-ы через `openKindSheet` /
    `snapsByKind`). Дополнительный клик = 0, sheet переоткрывать
    не нужно.
  (2) «UX с двумя навигациями — это GarageBand-паттерн, пользователь
    привык». Возражение: на GarageBand in-sheet strip показывает
    controls, а не альтернативную навигацию (там это «варианты
    звучания пиано»). У нас все 5 кнопок — это полная параллель
    TabBar. Если когда-то понадобится «варианты внутри» (паттерн
    GarageBand) — добавим; сейчас это не оно, это просто дубль.
  (3) «Лучше скрыть через CSS, чем удалять компонент —
    обратимость». Возражение: компонент 70 строк + тесты 127 строк
    + CSS 47 строк — мёртвый код, который никто не вызовет. Спрятать
    = оставить регрессионную поверхность (правки тестов/типа, ревью
    при поиске кода). Удаляем чисто, в witness волны
    `wavecode-mobile-split-pane` остаётся как история, откат — git
    revert одного коммита.
  (4) «А если mobile landscape с узкой высотой — TabBar режется».
    Возражение: TabBar fixed внизу viewport, не зависит от sheet.
    Landscape даёт больше вертикального места; предыдущие пакеты
    (`wavecode-modern-mobile-redesign`, `wavecode-mobile-compact`)
    уже сократили бар до 6 табов по 60px. На 360×640 горизонтально
    — все 6 табов видны.
synthesis: |
  В BottomSheet header остаются: `<h2 class="wc-sheet__title">`,
  опциональный `<span class="wc-sheet__subtitle">`, и actions
  (expand/close). Удалены:
    - `<SheetTabs />` рендер внутри `<Show when={isMobileViewport()}>`;
    - компонент `ui/src/presentation/components/SheetTabs.tsx`;
    - тесты `SheetTabs.test.tsx`;
    - CSS `.wc-sheet__tabs`, `.wc-sheet__tab`,
      `.wc-sheet__tab-label` в `ui/src/styles/sheets.css`.
  Никаких изменений в `uiState.ts` — `setTab` уже работает
  корректно при sheet-open (открывает sheet нужного kind-а через
  `openKindSheet`). `data-content-key` на `.wc-sheet__body` сохраняется
  — fade-in анимация при tab-переключении через TabBar работает
  без изменений.
  TabBar (нижний) остаётся единственной primary-nav. Это согласуется
  с пакетом `wavecode-bottom-bar-unified`: «6 табов = score, step,
  piano, mixer, ai, status. BottomToolstrip удаляется… дизайн-интент
  — всё в один нижний бар».
  Это инверсия части `wavecode-mobile-split-pane` (которая ввела
  in-sheet strip как secondary-nav); общий split-pane принцип
  (draggable BottomSheet с snap-точками) остаётся нетронутым.
substrate: |
  − `ui/src/presentation/components/SheetTabs.tsx` — deleted (63 lines).
  − `ui/src/presentation/components/SheetTabs.test.tsx` — deleted
    (127 lines).
  − `ui/src/presentation/components/BottomSheet.tsx` — modify:
      • удалён `import { SheetTabs } from './SheetTabs';`
      • удалён `<Show when={isMobileViewport()}><SheetTabs /></Show>`
        внутри `wc-sheet__header` (после subtitle, перед actions).
  − `ui/src/styles/sheets.css` — удалён блок `.wc-sheet__tabs` /
    `.wc-sheet__tab` / `.wc-sheet__tab-label` (47 строк);
    комментарий к `.wc-sheet__body[data-content-key]` обновлён —
    fade-in триггерится tab-сменой через TabBar, не через SheetTabs.
  ± `ui/src/presentation/state/uiState.ts` — НЕ меняется.
    `setTab`, `openKindSheet`, `snapsByKind` уже синхронизированы
    (`wavecode-mobile-tabbed-sheet-routing`).
  ± `ui/src/presentation/components/TabBar.tsx` — НЕ меняется.
    Это и есть primary-nav, который мы и оставляем.
  ± `ui/src/presentation/components/app/BottomSheets.tsx` — НЕ
    меняется. Содержимое каждого BottomSheet (HelloPanel,
    MixerPanel, StepGrid, PianoKeyboard, AIChat) — без изменений.
status: draft
axiom: A1
epistemics:
  - statement: "In-sheet strip дублирует TabBar: оба вызывают
      setTab(id) с тем же набором id"
    marker: fact
    evidence: "BottomSheet.tsx:294 (`onClick={() => setTab(tab.id)}`)
      и TabBar.tsx:30 (та же setTab-логика); 5/5 id совпадают
      (mixer/chat/step/piano/status). Score — НЕ в SheetTabs
      (намеренно: Score закрывает sheet — записано в packet
      wavecode-mobile-split-pane)."
  - statement: "На текущем mobile-вьюпорте (≤720px) in-sheet strip
      рендерится внутри BottomSheet-header"
    marker: fact
    evidence: "BottomSheet.tsx:293-295 — обёрнут в
      `<Show when={isMobileViewport()}>`. На desktop (≥1024px) он
      уже скрыт через условие, поэтому правка не влияет на desktop."
  - statement: "`setTab` уже синхронизирует active sheet с
      переключением открытого kind (snapshot+перерисовка)"
    marker: fact
    evidence: "uiState.ts + packet wavecode-mobile-tabbed-sheet-routing:
      setTab → openKindSheet → snap нужного kind на full;
      BottomSheet читает getKindSnap(kind) на каждый re-render."
  - statement: "SheetTabs — единственный caller-сайт, кроме теста"
    marker: fact
    evidence: "`rg -n 'SheetTabs\\b' ui/src` показывает только
      BottomSheet.tsx:18 (import) и BottomSheet.tsx:294 (jsx);
      SheetTabs.test.tsx — тесты на тот же компонент."
  - statement: "Контракт TabBar как primary-nav зафиксирован в
      пакете wavecode-bottom-bar-unified, и на mobile TabBar
      всегда виден (z-index > sheet)"
    marker: fact
    evidence: "math/wavecode-bottom-bar-unified/packet.md —
      «BottomToolstrip удаляется… дизайн-интент — всё в один нижний
      бар»; math/wavecode-mobile-split-pane/packet.md синк-блок —
      z-index TabBar > sheet, bottom: tabbar-h."
  - statement: "Существующая визуальная проблема — TabBar (фикс-
      bottom, 6 табов) занимает ≥60px на mobile; in-sheet strip
      добавляет ещё ~26px + padding внутри header, вытесняя
      контент ниже"
    marker: judgment
    evidence: "скриншот автора 2026-10-14 (upload_c5f587cd-9bfb):
      виден Piano-sheet с явной пилой активных табов сверху,
      подсветка cyan-ом конкурирует с подсветкой TabBar снизу;
      автор явно сказал «панели дублируют сверху, её вообще не
      нужно, оставить только название панели»."
  - statement: "Заголовок `<h2 class='wc-sheet__title'>` сохранится —
      пользователь всегда видит, какой инструмент открыт"
    marker: fact
    evidence: "BottomSheet.tsx:285 (`<h2 class='wc-sheet__title'>
      {props.title}</h2>`) остаётся без изменений; props.title
      передаётся из BottomSheets.tsx (например «Piano», «Микшер»,
      «ИИ-ассистент»)."
  - statement: "Mobile-лэндскейп (горизонтальный viewport) не
      становится хуже"
    marker: judgment
    evidence: "TabBar фикс-bottom, не зависит от sheet; in-sheet
      strip удалён → header теряет 26px высоты → sheet-body
      получает дополнительное вертикальное пространство."
---

## Intent

Избавиться от дублирующей навигации в BottomSheet-header и оставить
в заголовке только `<h2>` — TabBar внизу уже предоставляет переключение
между всеми 5 инструментами (Mixer / AI / Status / Step / Piano) без
закрытия sheet.

Сценарий пользователя после правки:

1. Тап в TabBar «Piano» → `setTab('piano')` → открывается BottomSheet
   `kind=piano`, header показывает «Piano».
2. Тап в TabBar «Mixer» → `setTab('mixer')` → тот же sheet
   (single-active semantics из `wavecode-mobile-tabbed-sheet-routing`)
   переключает kind; header теперь «Микшер».
3. Sheet-body cross-fade (`data-content-key`) срабатывает как раньше.

## Где что меняется

```
ui/src/
├── presentation/components/
│   ├── BottomSheet.tsx                    (правка, −6 строк)
│   │   └── wc-sheet__header: убрать <Show><SheetTabs /></Show>
│   │
│   ├── SheetTabs.tsx                      (deleted, −63)
│   └── SheetTabs.test.tsx                 (deleted, −127)
│
├── styles/
│   └── sheets.css                         (правка, −47 строк)
│       └── убрать .wc-sheet__tabs / .wc-sheet__tab / .wc-sheet__tab-label
│
└── presentation/state/uiState.ts          (НЕ меняется)
```

Никаких новых deps, никаких изменений в audio-движке, ни в Strudel,
ни в CodeMirror.

## Worked example

### До

```tsx
// BottomSheet.tsx (wc-sheet__header)
<div class="wc-sheet__header">
  <h2 class="wc-sheet__title">{props.title}</h2>
  <Show when={props.subtitle}>
    <span class="wc-sheet__subtitle">{props.subtitle}</span>
  </Show>
  <Show when={isMobileViewport()}>
    <SheetTabs />        {/* ← удаляем */}
  </Show>
  <div class="wc-sheet__actions">…</div>
</div>
```

### После

```tsx
<div class="wc-sheet__header">
  <h2 class="wc-sheet__title">{props.title}</h2>
  <Show when={props.subtitle}>
    <span class="wc-sheet__subtitle">{props.subtitle}</span>
  </Show>
  <div class="wc-sheet__actions">…</div>
</div>
```

## What this is NOT

- **Не** замена in-sheet strip на «варианты внутри» (GarageBand-паттерн,
  типа «тип пианино / pre-defined patterns»). Это — separate feature,
  когда запрос появится — отдельный пакет.
- **Не** перенос in-sheet strip в нижнюю часть sheet (например,
  floating action row над TabBar). TabBar уже предоставляет переключение
  инструментов; вторичный toolbar был бы третьим местом для тех же
  табов.
- **Не** рефактор `uiState.ts` / `setTab` / `openKindSheet`. Никаких
  изменений в state-машине.
- **Не** изменение z-index, position, snap-points BottomSheet. Это —
  детали split-pane-пакета; они остаются как были.
- **Не** удаление `wc-sheet__header`-subblock'ов (backdrop, handle-area,
  actions). Удаляем ТОЛЬКО SheetTabs и его CSS.

## Тесты

- **Unit**: `vitest run` — 5 pre-existing failures в
  `ui/src/presentation/state/uiState.test.ts`
  (`setTab(piano) opens piano sheet at full`,
  `loadStoredSheetHeight restores from localStorage on module init`,
  и т.д.) воспроизводятся и на master без моих изменений — к этой
  правке отношения не имеют. После моих изменений других новых
  failures нет (744/749 passing, и те же 5 failing).
- **SheetTabs.test.tsx**: удалён вместе с компонентом. Если бы
  компонент сохранялся как dead-code — тесты валились бы при
  случайном side-effect (например, изменении сигнатуры
  `getActiveTab`); удаление компонента убирает эту регрессионную
  поверхность.
- **Lint**: `eslint BottomSheet.tsx sheets.css` — 0 errors. CSS-файл
  не линтуется (esbuild-стиль), но комментарий-маркер обновлён —
  grep на старый текст «SheetTabs toggles» возвращает 0 совпадений.
- **Typecheck**: `tsc --noEmit` — clean.

## Notes

- **`data-content-key` сохраняется**: `.wc-sheet__body` всё ещё
  получает ключ `${currentSnap()}:${getActiveTab()}`. При
  tab-переключении через TabBar (когда sheet уже открыт) cross-fade
  анимация продолжает работать.
- **Witness старого пакета**: `wavecode-mobile-split-pane/witness`
  остаётся на месте. Правка инвертирует ТОЛЬКО часть этого пакета
  (SheetTabs); сами split-pane (draggable BottomSheet, snap-points,
  tap-handle, content-key) продолжают жить. Witness — это «when
  applied», а не «навсегда неизменяемо»; если в будущем кто-то
  захочет ретроспективно отметить ретirement — отдельный пакет
  с `supersedes: wavecode-mobile-split-pane/SheetTabs`.
- **Desktop-регрессия невозможна**: SheetTabs и так рендерился
  ТОЛЬКО на mobile (`<Show when={isMobileViewport()}>`). После
  удаления компонента условие тоже не нужно — мёртвая ветка
  `<Show>` исчезает вместе с ним.
- **Accessibility trade-off**: теряем role="tablist" внутри sheet.
  В TabBar он есть — primary-nav остаётся полноценным a11y-паттерном.
  `aria-label` на BottomSheet role="dialog" уже сообщает название
  панели («Piano», «Микшер»).

## Open questions

1. **Что делать со старым `wavecode-mobile-split-pane/witness`** —
   нужен ли формальный supersede? Текущее предложение — оставить
   witness как есть (split-pane — applied), но добавить пометку
   в сам packet о том, что SheetTabs выведен. Альтернатива — новый
   пакет `wavecode-retire-in-sheet-tab-strip`, который через
   `supersedes` отзывается. Решается, если автор захочет строгой
   lineage — сейчас не критично.
2. **Если всё-таки нужен «варианты внутри»** (GarageBand-паттерн):
   например, в Piano-sheet показать выбор piano-instrument (triangle
   / sine / saw / square) — это уже другая семантика, не duplicate
   nav. Делается отдельным пакетом, если спрос появится.
