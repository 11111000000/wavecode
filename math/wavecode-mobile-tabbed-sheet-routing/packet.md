---
proposition: |
  Bottom-sheet router wavecode: единый источник истины — `snapsByKind`
  (per-kind sheet state). Tab-bar табы mixer/ai/status/score и шапочные
  toggle Step/Piano — все управляются через per-kind API
  (`openKindSheet/closeKindSheet/closeAllSheets`), и BottomSheet рендерится
  исключительно по `getKindSnap(kind)`. Single-active semantics: открытие
  нового sheet закрывает все предыдущие, никаких «призрачных» sheet'ов
  одновременно на translateY(0). TabBar z-index > sheet z-index, sheet
  позиционируется выше tab-bar (bottom: tabbar-h), чтобы табы всегда
  кликабельны даже при открытом sheet. Status — отдельный kind с
  HelloPanel внутри (раньше сетил `openSheet('ai', 'full')` что было
  просто неверно).
antithesis: |
  (1) «Per-kind state раздувает API — лучше иметь один signal». Возражение:
    drag-handler в BottomSheet уже передаёт свой `kind` в замыкании через
    `props.kind` → единый путь — везде snap записывается в запись с этим
    ключом. Один signal не нужен — 4 sheet'а с независимыми snap'ами.
  (2) «closeAllSheets + single-active openKindSheet — over-engineering».
    Возражение: на mobile один sheet = single focus; multi-sheet
    одновременно не используется ни одним flow. Сложность close-on-open
    = 5 строк в `openKindSheet`, выгода — нет «наложения» двух
    translateY(0), стабильная видимость одного sheet за раз.
  (3) «BottomSheet top-bar (`header-h`) для mobile? Не переусложнение?».
    Возражение: на mobile sheet занимает bottom + height =
    calc(100vh - tabbar - safe-areas). На desktop остаётся
    height = calc(100vh - header-h). Один CSS-rule для двух медиа —
    никакого дублирования.
synthesis: |
  1. Расширили SheetKind union: добавлен `'status'`, initial
     `snapsByKind.status` в наборе. SheetHeader для status
     ("Состояние run-time telemetry").
  2. `openSheet`/`closeSheet` переписаны как тонкие обёртки над
     `openKindSheet/closeAllSheets`, которые синхронизируют оба:
     per-kind record + global activeSheet/sheetSnap. Гарантирует, что
     BottomSheet (читает getKindSnap) и любой global consumer
     (TopBar/FAB actions) видят одно и то же.
  3. `snapTo(snap)` в BottomSheet drag-handler теперь синхронизирует
     snapsByKind для активного kind — раньше после drag'а
     переоткрытие забывало snap.
  4. `openKindSheet` стал single-active: сбрасывает ВСЕ snapsByKind
     на 'closed' перед открытием нового. BottomSheet-ы-конкуренты
     уходят в `data-snap='closed'` → CSS translateY(100%).
  5. `setTab(status)` → `openKindSheet('status', 'full')` (раньше
     открывал AI — баг семантики).
  6. App.tsx: добавлен `<BottomSheet kind="status" ...><HelloPanel />`
     (раньше status panel показывался только при getActiveTab() ===
     'score', что на mobile делало таб «мёртвым»).
  7. App.tsx: убраны `<Show when={showStepGrid()}>` и
     `<Show when={showPiano()}>` ВНЕ BottomSheet — visibility теперь
     полностью на стороне snapsByKind, родительские signal-ы
     используются только для chip active-state.
  8. CSS — sheet bottom: calc(tabbar-h + safe-bottom), max-height =
     calc(100vh - tabbar - safe-areas), чтобы sheet не перекрывал
     TabBar. TabBar z-index = z-sheet + 10 (выше sheet) →
     pointer-events всегда работают.
  9. BottomSheet: использует `closeAllSheets()` (не closeKindSheet,
     которого больше нет в публичном API).
substrate: |
  + `ui/src/presentation/state/uiState.ts` (modify):
    add 'status' to SheetKind, rewrite openSheet/snapTo/closeSheet
    как обёртки вокруг per-kind API, single-active в openKindSheet,
    setTab('status') → openKindSheet('status', 'full').
  + `ui/src/presentation/state/uiState.test.ts` (extend):
    6 новых тестов: openSheet sync, openKindSheet single-active,
    closeAllSheets, setTab mixer/status/score path.
  + `ui/src/presentation/components/BottomSheet.tsx` (modify):
    closeKindSheet → closeAllSheets (sheet API един).
  + `ui/src/App.tsx` (modify):
    добавить BottomSheet kind=status (HelloPanel); убрать Show-обёртки
    у Step/Piano BottomSheet.
  + `ui/src/styles/sheets.css` (modify):
    mobile: sheet bottom = tabbar-h + safe-bottom, max-height = 100vh
    минус tabbar/safe-areas; desktop остаётся без изменений (height =
    100vh - header-h).
  + `ui/src/styles/components.css` (modify):
    wc-tabbar z-index: var(--z-sheet) + 10 (выше sheet).
  * `math/wavecode-modern-mobile-redesign/packet.md` (reference):
    «BottomSheet + TabBar» — original design, sync state не
    предусмотрен, закрыто этим пакетом.
  - `math/wavecode-sheet-fixes/packet.md` (parallel, не
    задокументирован): per-kind snap + content fixes — без этого
    пакета Step/Piano toggle показывал sheet, но контент-верстка
    ломалась. Наш пакет НЕ supersede его — это разные оси.
---

## Verification

Manual (mobile viewport 412×900):
1. Mixer tab → sheet «Микшер» выезжает с M/S/gain каналами.
2. AI tab → закрывает mixer, открывает «ИИ-ассистент» half-snap.
3. Status tab → закрывает AI, открывает «Состояние run-time
   telemetry» (HelloPanel).
4. Score tab → закрывает все sheets, возврат к редактору.
5. Step / Piano chip в preset-row → bottom-sheets открываются,
   TabBar всегда кликабелен.
6. Score tab между sheets: каждый раз последний sheet закрывается
   и выбранный открывается; никаких наложений.

Auto (vitest):
- 19/19 uiState.test.ts passes: новые тесты на sync/closeAllSheets
  гарантируют non-regression.

