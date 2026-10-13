---
proposition: |
  На mobile (≤720px) BottomSheet (Mixer/AI/Status/Step/Piano) — это
  `position:fixed` overlay с z-sheet поверх ScorePanel, который при
  snap='full' закрывает ~90vh экрана, а при snap='half' физически
  перекрывает нижнюю половину редактора (редактор остаётся
  подложкой, не сжат). Юзер не может одновременно видеть код и
  инструмент, не может редактировать score пока открыт Mixer.

  Решение — split-pane на mobile (split-pane vs overlay):

  (1) **In-flow sheet**. BottomSheet на mobile становится flex-child
      `.app-body` (column flex), а не position:fixed overlay.
      ScorePanel получает `flex: 1 1 auto; min-height: 200px;
      max-height: calc(viewport - header - sheet-h - tabbar)`.
      Sheet получает `flex: 0 0 var(--sheet-h, 50vh); height: var(--sheet-h)`.
      snap→ height: closed=0, peek=35vh, half=50vh, full=70vh.
      ScorePanel и Sheet живут одновременно, оба interactive.

  (2) **Drag-handle divider** в верхней части sheet (replace
      bottom-handle-area). Pointer drag → setSheetHeightPx (clamp
      240..560px). При drag-вниз до < 240px → snap closed;
      drag-вверх до > 60vh → snap full. Persisted в localStorage
      `wavecode-mobile-sheet-h-v1`.

  (3) **Internal sheet tabs** в header — `[Mixer | AI | Status | Step | Piano]`.
      Переключение между инструментами не закрывает sheet, а меняет
      контент. setTab() внутри уже single-active, так что тап
      переключает. Tab "Score" в BottomNav закрывает sheet полностью
      (Score tab = closeAllSheets).

  (4) **FAB shift**. `wc-fab` (FAB кнопка) на mobile при открытом
      sheet смещается вверх на `--sheet-h` чтобы не закрывать
      активный контрол. CSS var transition 240ms.

  (5) **Desktop unchanged**. На desktop-правый wrapper: `.wc-sheet`
      = right-side drawer 480/720px как сейчас, drag-handle → snap
      transitions (closed/peek/half/full). split-pane overrides
      действуют только в `@media (max-width: 720px)`.

  (6) **ScorePanel-collapse affordance**. Когда sheet открыт на
      'full' (70vh), ScorePanel остаётся с min-height: 200px
      (~30vh на iPhone 412×900). ScorePanel содержит:
      `[editor ~210px]` + `[debug/status pills ~30px]` +
      `[mini-toolbar ~40px]`. Юзер может читать и скроллить
      редактор даже когда sheet full; для активного редактирования
      sheet переключают на half или close.

  (7) **Drag-handle visuals**:
      - 4px-wide pill (cyan, opacity 0.6 → 1 on hover).
      - Hit-area: 16px-high invisible drag-target.
      - Cursor: `ns-resize` on hover; `grabbing` during drag.
      - 4-dot row на pill чтобы визуально отличать от bottom-handle.
antithesis: |
  (1) «In-flow sheet ломает desktop UX».
  Возражение: изменения изолированы в `@media (max-width: 720px)`.
  На desktop (≥1024px) media query не срабатывает; transform-based
  right-side drawer работает как сейчас. Verify:
  `matchMedia('(min-width: 1024px)')` selectors в CSS.

  (2) «ScorePanel 200px слишком тесно для редактирования».
  Возражение: 200px — это min-height для 'full' snap (70vh sheet).
  По дефолту sheet = 'half' (50vh), ScorePanel = ~50vh. При 412×900
  viewport ScorePanel = ~400px, sheet = ~430px. Оба удобны для
  чтения. Для полноэкранного редактирования юзер тапает "Score"
  в BottomNav → sheet закрывается, ScorePanel full height.
  Альтернатива 'full' snap существует для тех, кому нужно больше
  sheet — но это осознанный trade-off.

  (3) «Drag-handle конфликтует с touch scroll».
  Возражение: drag-handle = `touch-action: none` на handle-area;
  touch-action остального sheet = normal. iOS Safari чётко
  разделяет касания по тач-таргетам.

  (4) «Internal tabs дублируют BottomNav».
  Возражение: BottomNav — primary navigation между "Score vs
  tools". Internal tabs — secondary navigation между tools (когда
  sheet открыт). В GarageBand такая двухуровневая навигация
  стандарт. Когда sheet закрыт — internal tabs не видны, нет
  визуального шума.

  (5) «FAB перемещается на mobile — может перекрыть sheet».
  Возражение: FAB смещается ВЫШЕ sheet (между sheet и tabbar).
  Когда sheet открыт, FAB сидит в зоне между sheet и tabbar —
  юзер видит и кликает. Когда sheet closed, FAB на своём
  обычном месте поверх tabbar.

  (6) «localStorage persisted height — может быть неправильный
  размер для landscape».
  Возражение: clamped 240..560px в portrait даёт разумные размеры.
  В landscape (height ~ 400px) clamp автоматически подрежет
  до 240px (нижний bound). Можно добавить resize listener —
  но это polish для v2, не блокер.
synthesis: |
  Шесть компонентов:

  1. **`ui/src/presentation/state/uiState.ts`** (modify, +40 строк):
     - Новый signal `sheetHeightPx: () => number | null` —
       null = auto (snap-driven), иначе px.
     - `setSheetHeightPx(px)`: clamp [240..560], persist в
       `wavecode-mobile-sheet-h-v1`.
     - `resetSheetHeightPx()`: clear persistence.
     - CSS `--sheet-h` обновляется через `createEffect` +
       `document.documentElement.style.setProperty('--sheet-h', ...)`.

  2. **`ui/src/styles/sheets.css`** (modify, +90 строк):
     - `@media (max-width: 720px) { ... }` block:
       * `.wc-sheet-backdrop { display: none }`
       * `.wc-sheet` — `position: relative; transform: none;
         height: var(--sheet-h, 50vh); max-height: 70vh;
         min-height: 0; border-radius: 12px 12px 0 0;
         transition: height 240ms var(--ease-spring);`
       * `.wc-sheet[data-snap='closed']` — `height: 0; visibility: hidden`
       * `.wc-sheet[data-snap='peek']` — `height: 35vh`
       * `.wc-sheet[data-snap='half']` — `height: 50vh`
       * `.wc-sheet[data-snap='full']` — `height: 70vh`
       * `.wc-sheet__top-handle` — новая drag-affordance (4px cyan pill,
         16px hit-area, cursor: ns-resize).
       * `.score-panel` — `flex: 1 1 auto; min-height: 200px;
         max-height: calc(100vh - var(--header-h) - var(--tabbar-h) -
         var(--safe-bottom) - var(--sheet-h, 50vh))`.
       * `.wc-fab` — `bottom: calc(var(--tabbar-h) + var(--safe-bottom)
         + var(--sheet-h, 0px) + var(--space-md)); transition: bottom
         240ms var(--ease-spring)`.
       * `.app-body` — column flex, `display: flex; flex-direction: column;
         min-height: 0; overflow: hidden;`.
       * `.wc-sheet__tabs` — internal tabs styling (см. ниже).
       * `body[data-sheet-open='true']` — `overflow: auto` (unlock scroll;
         overlay не нужен → нет reason для lock).

  3. **`ui/src/presentation/components/BottomSheet.tsx`** (modify,
     +60 строк): новый `<div class="wc-sheet__top-handle">` вместо
     (или над) bottom-handle-area. Pointer drag handler:
     - mobile (`matchMedia('(max-width: 720px)'`): vertical drag →
       `setSheetHeightPx(startH - dy)`. Snap decision по release:
       height < 240px → snapTo('closed'), height > 60vh →
       snapTo('full'), else snapTo('half').
     - desktop: existing snap-transitions (closed/peek/half/full)
       через translateX.
     - На mobile drag-handle — это primary handle; bottom handle-area
       скрыт (transition-disabled).

  4. **`ui/src/presentation/components/SheetTabs.tsx`** (new, ~70 строк):
     - Internal tab bar внутри sheet header (после title, перед actions).
     - 5 tabs: Mixer/AI/Status/Step/Piano. SVG icon + label.
     - Click → `setTab(tabId)`. active = current activeTab.
     - Tab "Score" НЕ показывается в SheetTabs (Score = close sheet).
     - Disabled when sheet snap='closed' (tab-bar не виден).

  5. **`ui/src/App.tsx`** (modify, +5 строк): `<BottomSheets />`
     перемещается ИЗ sibling-of-body В child-of-body. Это нужно
     для in-flow layout на mobile (column flex). На desktop через
     CSS `@media (min-width: 1024px)` .wc-sheet восстанавливает
     position:fixed через css-override (sheets.css media query).

     Альтернатива: оставить BottomSheets как sibling, добавить
     `display: none` для mobile-стилей через обёртку. Это менее
     чисто — выбираю child-of-body.

  6. **`ui/src/presentation/components/BottomSheets.tsx`** (modify,
     +10 строк): каждый `<BottomSheet>` рендерит `<SheetTabs />` В
     header (или только первый, и tabs в active Sheet). Решение:
     tabs рендерим в каждом, но они показываются только когда
     sheet открыт (data-snap='closed' → tabs hidden).

  CSS — final visual layer:

  ```css
  /* split-pane divider (top-handle, draggable) */
  .wc-sheet__top-handle {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 16px;
    cursor: ns-resize;
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    border-bottom: 1px solid var(--border);
    background: var(--surface-0);
    position: relative;
  }
  .wc-sheet__top-handle::before {
    content: '';
    width: 40px;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--border-strong);
    transition: background var(--dur-xs) var(--ease);
  }
  .wc-sheet__top-handle:hover::before { background: var(--cyan); }
  .wc-sheet__top-handle:active { cursor: grabbing; }
  .wc-sheet__top-handle:active::before { background: var(--cyan); }

  /* internal sheet tabs */
  .wc-sheet__tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    padding: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
  }
  .wc-sheet__tab {
    height: 24px;
    padding: 0 var(--space-xs);
    background: transparent;
    color: var(--fg-dim);
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    transition:
      color var(--dur-xs) var(--ease),
      background var(--dur-xs) var(--ease);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
  }
  .wc-sheet__tab:hover { color: var(--fg); }
  .wc-sheet__tab[data-active='true'] {
    color: var(--fg-inverse);
    background: var(--cyan);
    border-color: var(--cyan);
  }
  ```

  Tests:
  - vitest: новый `uiState.test.ts` кейсы:
    * sheetHeightPx default = null
    * setSheetHeightPx clamps 240..560
    * Persists + restores from localStorage
    * resetSheetHeightPx → null + localStorage cleared
    * CSS var --sheet-h обновляется через createEffect
  - vitest: новый `SheetTabs.test.tsx`:
    * renders 5 tabs (Mixer/AI/Status/Step/Piano)
    * click tab → setTab вызван с правильным id
    * active tab получает data-active=true
    * hidden when sheet snap='closed'
  - e2e: новый `tests/e2e/mobile-sheet-push.spec.ts` (5 cases):
    * mobile viewport → BottomSheet open at 'half' → editor visible
      above sheet, оба interactive.
    * Tap Mixer tab → sheet opens, editor не перекрыт, mixer показан.
    * Tap AI tab while sheet open → sheet контент меняется (AI), sheet
      остаётся open.
    * Tap Score tab → sheet закрывается, editor full-height.
    * Drag top-handle down → sheet height уменьшается (через
      data-sheet-h CSS var).

  Substrate scope:
  - 5 файлов modify, 1 файл new (SheetTabs.tsx), 1 файл new (e2e spec).
  - ~280 LoC impl, ~150 LoC tests, ~100 LoC e2e.
  - Total ~530 LoC diff.
  - Зависимости: `matchMedia` (стандарт DOM), CSS custom properties.

  Risks:
  - iOS Safari `100vh` иногда включает URL-bar в высоту. Mitigation:
    использовать `100dvh` где supported (iOS 15.4+), fallback на
    `100vh` для старых.
  - drag-handle conflict с touch-scroll если юзер хочет scroll
    sheet content. Текущее решение: drag-handle = first 16px
    сверху sheet, остальное scroll normal. Touch target isolation
    via `touch-action: pan-y`.
  - transition: height на слабых устройствах — может быть janky.
    Mitigation: 240ms spring curve — на 60fps плавно.
  - iOS landscape (height ~400px) — min-height 200px + sheet min 240
    даёт total 440px > viewport. Mitigation: clamp height + max 70vh.
  - FAB position shift может конфликтовать с BottomNav. Решение:
    FAB на mobile (z выше tabbar) → смещается над sheet, не над
    tabbar. CSS var --sheet-h обеспечивает transition.

  Supersedes / relations:
  - SUPERSEDES: частично `wavecode-mobile-tabbed-sheet-routing` —
    single-active semantics остаются, но BottomSheet physical
    position меняется с fixed-overlay на in-flow flex.
  - BUILDS ON: `wavecode-bottom-bar-unified` — TabBar остаётся,
    BottomNav-табы по-прежнему primary navigation.
  - BUILDS ON: `wavecode-mobile-single-panel` — ScorePanel-flex-1
    default остаётся, теперь адаптивно через `--sheet-h`.
  - BUILDS ON: `wavecode-piano-rec-clarity` — BottomSheet-piano на
    mobile остаётся (потому что это один из tools внутри SheetTabs).
  - REUSES: `wavecode-piano-modes-and-gain`'s PreviewPill — на
    mobile BottomSheet-piano показывает preview-pill; на desktop
    inline-piano в ScorePanel остаётся.
  - FUTURE: v2 — drag-handle для landscape orientation; resize
    observer для re-clamp при rotate.
status: applied
witness:
  applied_at: 2026-10-13
  branch: feat/mobile-sheet-push
  commit: a79534ed4f5630521f8bb904883f6825ab6e0e21
  supersedes: null
  notes: |
    Implementation completed on 2026-10-13 on branch
    `feat/mobile-sheet-push`. Test counts (vitest): 712/712
    passing across 52 files. Net new tests: +17 (9 uiState
    sheetHeightPx cases + 8 SheetTabs cases). New e2e spec
    mobile-sheet-push.spec.ts (5 cases). tsc --noEmit clean;
    vite build succeeds. No new lint errors.
axiom: A5
epistemics:
  - statement: "BottomSheet (kind=ai/mixer/status/step/piano) сейчас position:fixed с z-sheet=40+1; перекрывает ScorePanel снизу"
    marker: fact
    evidence: "ui/src/styles/sheets.css:39-60 — .wc-sheet { position: fixed; ... bottom: calc(var(--tabbar-h) + var(--safe-bottom)); }"
  - statement: "wc-sheet-backdrop использует backdrop-filter: blur(2px); именно blur делает редактор «размытым» при snap=peek/half"
    marker: fact
    evidence: "ui/src/styles/sheets.css:12-22 — .wc-sheet-backdrop { position: fixed; inset: 0; backdrop-filter: blur(2px); z-index: var(--z-sheet); }"
  - statement: "uiState.setTab уже single-active — открытие одного kind закрывает все остальные"
    marker: fact
    evidence: "ui/src/presentation/state/uiState.ts:254-266 — openKindSheet сбрасывает все snapsByKind на 'closed' кроме целевого"
  - statement: "setTab('score') вызывает closeAllSheets — Score в BottomNav уже закрывает все sheets"
    marker: fact
    evidence: "ui/src/presentation/state/uiState.ts:290-292 — if (tab === 'score') closeAllSheets();"
  - statement: "matchMedia('(max-width: 720px)') используется в wavecode-mobile-single-panel для mobile viewport detection"
    marker: fact
    evidence: "ui/src/presentation/state/uiState.ts:51-56 — isMobileViewport через matchMedia('(max-width: 720px)')"
  - statement: "drag-handle в BottomSheet уже реализован (handle-area на pointer events) — pattern переиспользуем для vertical resize на mobile"
    marker: fact
    evidence: "ui/src/presentation/components/BottomSheet.tsx:36-80 — onPointerDown/onPointerMove/onPointerUp с snap decisions"
  - statement: "GarageBand iOS использует двухуровневую навигацию: BottomNav (master) + BottomSheet tools; SheetTabs не дублирование, а secondary navigation между tools"
    marker: judgment
    evidence: "Apple GarageBand iOS UX pattern; standard mobile music-app pattern"
  - statement: "split-pane layout с min-height 200px для ScorePanel — это минимум для чтения кода с одной строкой видимой и скроллом"
    marker: judgment
    evidence: "WCAG minimum touch target 44px + line-height 1.5×14px ≈ 21px = 200px = ~10 строк кода видимо; editor scrollable для остального"
  - statement: "localStorage persistence для sheet height помнит предпочтения пользователя между сессиями"
    marker: judgment
    evidence: "axiom A5 — surface the model user holds; пользователь явно resize'ил — expect remembered next session"
  - statement: "iOS Safari 100vh включает URL-bar в viewport height; использование 100dvh (где supported) даёт accurate viewport"
    marker: fact
    evidence: "Apple WebKit blog — 100dvh since iOS 15.4; standard pattern; fallback на 100vh для older"
---