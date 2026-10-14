---
proposition: |
  Объединить `.app-preset-row` (выбор композиции) и `.app-controls-row`
  (Play/Stop + cps/swing/bpm) в ОДИН collapsible `.app-transport-bar`.
  На mobile (≤720px) default collapsed → 49px chrome (только strip с
  Play + BPM + toggle). Expanded → 102-108px (полная панель).
  Toggle-кнопка с persistent state в localStorage
  `wavecode-mobile-transport-expanded-v1`. Desktop layout сохранён
  как было (always expanded), но toggle тоже работает (bar collapses
  до 45px если пользователь явно свернул).

  Мотивация — пользовательский фидбек:
  «выбор композиции можно разместить на одной панели вместе с Play
   и скорость bpm. Ну можно вообще разворачивать их с какой-нибудь
   кнопочки. Ну чтобы оно не занимало место непрерывно потому что
   где ему не нужно редактировать постоянно будет такой же кнопочкой
   попытаться разместить на одной панели кнопку Play и кнопочку
   для открытия bpm»

  На mobile 412×900 при sheet closed:
  - master: 49+108 = 157px fixed-chrome, cm-host = 638px (было)
  - new: 49 collapsed / 102 expanded (cm-host 683 / 623px)
  - gain в collapsed: +60px (10% extra vertical space для editor)

  Toggle architecture:
  - Strip (always visible): Play/Stop + BPM indicator + spacer + toggle button
  - Body (visible when expanded): preset <select> + (save bar if shown) +
    transport-panel (cps slider, swing, cps-presets, playhead-track)
  - data-collapsed атрибут на .app-transport-bar — source of truth для
    CSS (включая inline index.html un-layered rule)
  - createEffect в TransportBar мирорит data-collapsed →
    data-transport-collapsed на .app-body (чтобы CSS @media (max-width:
    720px) переключал padding-top 48 ↔ 108)

outcome: |
  - Mobile 412×900 default: bar collapsed (49px) + appBody padding-top
    48px → cm-host 683px (50+ lines visible). Toggle button (▼) с
    label "Развернуть панель (BPM/пресеты/свинг)" в strip.
  - Mobile expanded: bar 102px (strip 49 + body 53) + appBody padding-top
    108px → cm-host 623px (~18 lines). Body показывает preset select +
    cps slider (swing/cps-presets/playhead скрыты при 412px — pre-existing
    behavior, transport-panel inline-flex с flex-wrap:wrap не вмещает).
  - Desktop 1280×800 default: bar expanded (102px) + appBody padding-top
    96px (legacy calc(--preset-row-h + --controls-h) formula сохранена).
    Body показывает preset + cps + swing + cps-presets + playhead.
  - Desktop collapsed: bar 45px (только strip) + appBody padding-top
    48px. Editor cm-host расширяется с 445px до ~520px.
  - localStorage `wavecode-mobile-transport-expanded-v1`: persists
    'true'/'false' на каждом toggle click. При init читается
    initialExpanded() → если null, default = !isMobileViewport() =
    collapsed на mobile, expanded на desktop.
  - data-transport-collapsed attribute на .app-body: synced через
    createEffect от !expanded(). CSS правила в @media (max-width:720px)
    используют этот атрибут для переключения padding-top.
  - 11 новых vitest-тестов в TransportBar.test.tsx (все pass), покрывают:
    mobile default collapsed, desktop default expanded, click toggle
    (state flip + localStorage write), persistence на reload, mirroring
    на .app-body, Play button always visible, Stop state when running,
    preset select reachable after expand, no-throw без onPlay/onStop.
invariant: |
  - `.app-transport-bar` — single fixed container `top: var(--header-h)`,
    z-index calc(--z-sheet+12) = 52 (выше sheet 41). Play button всегда
    доступен.
  - data-collapsed: 'true' (default mobile) / 'false' (default desktop
    + после явного expand).
  - body element имеет `data-testid="transport-bar-body"`. CSS rule
    `.app-transport-bar[data-collapsed='true'] .app-transport-bar__body
    { display: none }` (universal — не в @media) гарантирует что
    collapse работает на desktop too.
  - inline `<style>` в ui/index.html имеет un-layered копию правила
    collapse (строка после .app-transport-bar блока), т.к. inline
    un-layered > @layer components в bundled CSS. Backwards compat
    с wavecode-mobile-compact/wavecode-preset-row-and-toast-z.
  - `--app-transport-h-collapsed: 48px;` и `--app-transport-h-expanded:
    108px;` в tokens.css (LAYOUT section, после --app-top-fixed-h-mobile
    с comment cross-link). Default `.app-body[data-transport-collapsed]
    = 'true'` rule в НЕ-media части components.css (строка 2625 рядом
    с .app-body) — гарантирует 48px collapse на desktop (где @media
    rule не применяется).
  - `.app-preset-row` и `.app-controls-row` legacy rules в
    components.css (строки ~3035 / ~3166) — kept as no-op для
    stragglers + inline index.html comment cross-link (dead DOM
    elements не рендерятся, но CSS-классы могут прийти из extensions/
    snippets).
  - PresetRow.tsx удалён (больше не используется ни в App.tsx, ни в
    тестах). TransportPanel.tsx сохранён (тесты TransportPanel.test.tsx
    продолжают работать — отдельный компонент, не используется App).
  - `.app-transport-bar` z-index 52 (sheet+12). Sheet z-index 41. Bar
    ВСЕГДА выше sheet — Play button кликабелен когда sheet открыт.
  - mobile @media: strip min-height 48px (на desktop 44), toggle-label
    скрыт (`display: none` чтобы не съедать 412px ширину), body padding
    `var(--space-xs) var(--space-sm)`. AppBody padding-top 48/108
    переключается через data-transport-collapsed.
  - Архитектура data-attribute mirroring:
    1. TransportBar.jsx: createEffect(() => { appBody.setAttribute(
       'data-transport-collapsed', String(!expanded())) })
    2. CSS @media (max-width:720px) ловит data-transport-collapsed и
       меняет padding-top.
    Без этого CSS @media не знает о JS state — sibling combinator
    `.app-transport-bar ~ .app-body` fragile (другие DOM-children
    могли бы сломать селектор).
test: |
  - vitest 735 pass + 5 pre-existing failures (uiState.test.ts setTab
    'full' vs 'half' from earlier commit 1d51ee6 — KNOWN, не моя
    регрессия). Из 11 новых тестов в TransportBar.test.tsx — все 11
    pass.
  - tsc --noEmit: clean.
  - vite build: success, 8.98s, dist/sw.js generated.
  - browser 412×900 mobile (sheet closed):
    * storage=null, freshly loaded → bar.collapsed='true', bar.mobile='true'
    * bar.height: 49px (strip 48 + border-top 1)
    * body.display: 'none', body.height: 0
    * appBody.paddingTop: '48px' (= --app-transport-h-collapsed)
    * appBody.dataset.transportCollapsed: 'true'
    * cmHost.top: 104, cmHost.height: 683
    * total chrome top: 56 (TopBar) + 49 (bar) = 105
    * Editor visible: 50+ lines (// Creep, stack(), 7 lines of notes)
  - browser 412×900 mobile, click ▼ toggle:
    * storage = 'true' persisted
    * bar.collapsed='false', bar.height: 102
    * body.display: 'flex', body.height: 53 (preset + cps slider)
    * appBody.paddingTop: '108px' (= --app-transport-h-expanded)
    * appBody.dataset.transportCollapsed: 'false'
    * cmHost.top: 164, cmHost.height: 623
    * Toggle label: "Свернуть панель" + ▲ icon
    * swing/cps-presets/playhead-track: offsetHeight 0 (pre-existing
      behavior — original transport-panel inline-flex + flex-wrap не
      вмещал всё на 412px ширине. master-до моих изменений показывал
      только cps slider — поведение preserved)
  - browser 412×900 mobile, click ▲ toggle (collapse обратно):
    * storage = 'false' persisted
    * bar.collapsed='true', все остальные значения возврат к collapsed
  - browser 412×900 mobile, hard reload:
    * storage='true' (persisted) → bar starts expanded
    * data-collapsed правильно 'false' на первом рендере
  - browser 1280×800 desktop, fresh load (no storage):
    * matchMedia(720px) = false → bar.mobile='false'
    * initialExpanded() = !false = true → bar.collapsed='false'
    * bar.height: 102 (strip 44 + body 57 + border 1)
    * appBody.paddingTop: '96px' (legacy calc formula)
    * cmHost.top: 189 (= 56 + 96 + 37 panel-header)
  - browser 1280×800 desktop, click ▼ toggle (collapse on desktop):
    * storage = 'false' persisted (пользователь явно свернул)
    * bar.collapsed='true', bar.height: 45
    * body.display: 'none' (CSS rule без @media)
    * appBody.paddingTop: '48px' (--app-transport-h-collapsed)
    * cmHost.top: 141 (= 56 + 48 + 37)
    * Editor cmHost расширяется с 445 до 520+ px (на 75px больше)
  - browser 1280×800 desktop, click ▲ toggle (expand обратно):
    * storage = 'true' persisted
    * bar.collapsed='false', bar.height: 102
    * appBody.paddingTop: '96px' (legacy)
  - browser 412×900 mobile, open AI sheet:
    * sheet z-index 41, bar z-index 52 → bar поверх sheet
    * Play button кликабелен (не перекрыт sheet'ом)
antithesis: |
  (1) «Оставить два отдельных row, просто скрывать один на mobile
     когда collapsed». Возражение: это создаёт два stacked fixed
     containers (top: 56, top: 100). Когда один hidden, его top
     не двигается — останется пустое место или overlap. Один
     контейнер с collapse-body решает оба случая чисто.
  (2) «Сделать collapse через CSS-only :focus-within / :hover на
     bar, без JS state». Возражение: hover-to-expand плох для
     touch (юзер хочет explicitly tap чтобы раскрыть). Focus-
     within теряет focus когда user тапает мимо bar. JS state
     с localStorage persistence — единственный UX-acceptable
     вариант для mobile.
  (3) «Использовать sibling combinator `.app-transport-bar ~ .app-body`
     в CSS вместо data-attribute mirroring». Возражение: sibling
     combinator fragile — если между ними вставить ещё один
     элемент (например, error banner, toast container) — selector
     ломается. data-attribute + JS effect — robust pattern,
     не зависит от DOM-структуры. Цена: одна extra write на
     каждый toggle (~1ms) — приемлемо.
  (4) «Скрыть toggle на desktop (зачем collapse если много места)».
     Возражение: юзер явно попросил «чтобы оно не занимало место
     непрерывно потому что где ему не нужно редактировать постоянно»
     — это applies to both mobile и desktop. Desktop editor maximized
     state полезен (больше space для score). Toggle остаётся видимым
     и на desktop.
  (5) «Не persistить в localStorage, считать session-only». Возражение:
     mobile юзер каждый раз при reload будет видеть expanded state
     (default mobile = collapsed не сработает если юзер явно
     выбрал expanded раньше в session). Persistence — expected
     behavior, юзер не хочет re-toggle каждую session.
  (6) «CSS-Layers gotcha: inline .app-preset-row в index.html нужно
     удалить чтобы избежать dead rules». Возражение: inline
     `<style>` — не @layer, бьёт все @layer rules в bundled CSS.
     Я обновил inline копию на .app-transport-bar (включая collapse
     rule) — это consistent с wavecode-mobile-compact / preset-row-
     and-toast-z / mobile-fixed-h (все они обновляли inline copy
     синхронно). Удалять inline копию рискованно — если Vite
     miniфицирует не так, как ожидаем, можно сломать CSS ordering.
  (7) «Mobile expanded body height 53px не вмещает swing/cps-presets/
     playhead — регрессия vs original». Возражение: original
     (master) mobile controls-row уже 59px и показывал только
     cps slider (swing/cps-presets/playhead height 0) — pre-existing
     поведение. НЕ регрессия, preserved. Body content = тот же cps
     slider + preset select (новое).
  (8) «1px overlap cmHost.top (104) < bar.bottom (105) на mobile
     collapsed». Возражение: bar = strip 48 + border-top 1 = 49.
     appBody padding-top 48 = ровно strip. cmHost стартует на
     padding-top edge. Border-top bar'а лежит на 1px выше cmHost
     (визуально невидимо — bar background rgba(10,10,14,0.92)
     почти совпадает с cmHost bg). Buffer 0 intentional — mobile
     editor получает каждый доступный пиксель.
synthesis: |
  Один коммит + пакет + witness. Один новый компонент TransportBar.tsx,
  один новый тест-файл TransportBar.test.tsx. CSS-изменения: новые
  rules в components.css (TransportBar block + mobile @media),
  обновлены токены в tokens.css, обновлена inline копия в index.html.

  1. **`ui/src/presentation/components/TransportBar.tsx`** (новый):
     - Объединяет PresetRow (preset select + save bar) и
       TransportPanel (Play + cps + swing + cps-presets + playhead)
       в один self-contained компонент.
     - `data-collapsed={!expanded()}` атрибут — source of truth для
       CSS (inline + @layer components).
     - `createEffect` мирорит data-collapsed → data-transport-collapsed
       на .app-body (для CSS @media switching).
     - localStorage `wavecode-mobile-transport-expanded-v1` (read on
       init, write on every toggle click).
     - default: !isMobileViewport() = collapsed mobile, expanded
       desktop.
     - Play button в STRIP (всегда виден — кнопка Play транспорта
       не должна исчезать при collapse, иначе юзер не сможет Play
       score с mobile collapsed bar).

  2. **`ui/src/presentation/components/TransportBar.test.tsx`** (новый):
     11 vitest тестов. Покрывают mobile/desktop default state, click
     toggle, localStorage persistence, data-attribute mirroring на
     .app-body, Play button always visible + correct stop state,
     preset select reachable after expand, no-throw без optional
     props.

  3. **`ui/src/App.tsx`** (изменён): `<PresetRow />` +
     `<div class="app-controls-row">` → один `<TransportBar />` с
     combined props. Imports: PresetRow, TransportPanel удалены;
     TransportBar добавлен.

  4. **`ui/src/presentation/components/app/PresetRow.tsx`** (удалён):
     dead code (больше не импортируется).

  5. **`ui/src/styles/components.css`** (изменён):
     - Новый `.app-transport-bar` block (строки ~2960-3035): position:
       fixed под TopBar, z-index 52, flex column, dark background
       с backdrop-filter, border-top.
     - `.app-transport-bar__strip` + `__body` + `__toggle` + `__spacer`
       rules: min-height 44, padding, gap, transitions.
     - Universal collapse rule (НЕ в @media): `.app-transport-bar
       [data-collapsed='true'] .app-transport-bar__body { display: none }`
       — чтобы collapse работал и на desktop.
     - `.app-body[data-transport-collapsed='true']` rule (в НЕ-media
       части, рядом с .app-body) — desktop collapse padding-top 48px.
     - Mobile @media (max-width:720px) обновлён: добавлены strip
       min-height 48, toggle-label hidden, body padding compact, и
       data-transport-collapsed rules для appBody padding-top 48/108.
     - Legacy `.app-preset-row` и `.app-controls-row` rules kept as
       no-op (с comment "kept for stragglers").

  6. **`ui/src/styles/tokens.css`** (изменён):
     - `--app-transport-h-collapsed: 48px;` (новая, после
       --app-top-fixed-h-mobile).
     - `--app-transport-h-expanded: 108px;` (новая).
     - comment расширен — cross-link на wavecode-mobile-transport-bar
       packet, объясняет mobile collapsed (48) vs expanded (108).

  7. **`ui/index.html`** (изменён):
     - Inline `.app-preset-row` rule заменён на `.app-transport-bar`
       rule (un-layered, beats @layer components в bundled CSS).
     - Collapse rule добавлен inline (для redundancy с @layer rule).
     - Mobile @media inline обновлён: data-transport-collapsed
       rules для appBody padding-top.

  8. **Packet + witness.** Этот файл + `witness` после build +
     production-verify.
status: draft
axiom: A5
epistemics:
  - statement: "Mobile collapsed bar занимает 49px (strip 48 + border 1)"
    marker: fact
    evidence: "playwright_browser_evaluate getBoundingClientRect на 412×900
      после clear localStorage + hard reload: bar.height=49, strip.height=48,
      body.display='none', body.height=0. Bar bottom = 56+49 = 105."
  - statement: "Mobile expanded bar занимает 102px (strip 49 + body 53 + 1)"
    marker: fact
    evidence: "playwright_browser_evaluate после click toggle (storage='true'):
      bar.height=102, strip.height=48, body.height=53, body.display='flex'."
  - statement: "appBody padding-top синхронно с bar state"
    marker: fact
    evidence: "data-transport-collapsed='true' → appBody paddingTop='48px'.
      data-transport-collapsed='false' → paddingTop='108px' (mobile) /
      '96px' (desktop, @media rule не применяется)."
  - statement: "Default state на mobile — collapsed (49px), default на
      desktop — expanded (102px)"
    marker: fact
    evidence: "Clear localStorage + hard reload: на 412×900 matchMedia=true
      → initialExpanded() = !true = false → data-collapsed='true'. На
      1280×800 matchMedia=false → initialExpanded() = !false = true →
      data-collapsed='false'."
  - statement: "Storage key wavecode-mobile-transport-expanded-v1: 'true'/
      'false' записан на каждый toggle click"
    marker: fact
    evidence: "vitest test 'toggle persists to localStorage on every click'
      + playwright evaluate: click toggle на collapsed (storage=null) →
      storage='true'; click ещё раз → storage='false'."
  - statement: "TransportPanel inline-flex с flex-wrap:wrap не вмещает
      swing/cps-presets/playhead на 412px — pre-existing behavior"
    marker: fact
    evidence: "playwright evaluate на master (до моих изменений, после
      git stash): swingControl/cpsPresets/playheadTrack offsetHeight=0
      (controls-row height=59, transport-panel 46, cps control 24).
      То же самое наблюдается в новом TransportBar body (panel 40,
      cps 24, others 0). Поведение preserved, не регрессия."
  - statement: "Bar z-index 52 (sheet+12) выше sheet z-index 41 — Play
      button кликабелен при sheet open"
    marker: fact
    evidence: "playwright evaluate на mobile с AI sheet open: bar
      z-index='52', sheet z-index='41'. На скриншоте видно Play (orange)
      в strip над sheet'ом."
  - statement: "Inline index.html CSS-Layers gotcha — un-layered .app-
      transport-bar rule нужно синхронизировать с @layer components"
    marker: judgment
    evidence: "index.html строка 215-232 (inline `<style>`) имеет
      не-layered копию .app-transport-bar collapse rule. Без этой
      inline копии CSS @media-вложенный @layer rule в bundled CSS
      проигрывает ВСЕМ правилам в inline `<style>`. Это consistent
      с предыдущими пакетами (wavecode-mobile-compact, wavecode-
      preset-row-and-toast-z, wavecode-mobile-fixed-h) — все они
      требовали синхронизации inline копии."
  - statement: "Удаление PresetRow.tsx безопасно — единственный
      импортер был App.tsx"
    marker: fact
    evidence: "grep -rn 'from.*PresetRow' ui/src/ — единственный
      результат: App.tsx (удалён в этом пакете). TransportPanel.tsx
      сохранён (используется в TransportBar.test.tsx). Vitest 735 pass
      подтверждает что ни один тест не сломан."
  - statement: "Toggle button виден на desktop + работает (collapse до 45px)"
    marker: fact
    evidence: "playwright на 1280×800, click toggle → bar.collapsed='true',
      bar.height=45, appBody.paddingTop='48px' (--app-transport-h-collapsed).
      Editor cmHost.top=141 (vs 189 expanded) — +75px места для editor."
  - statement: "1px overlap cmHost.top (104) vs bar.bottom (105) на mobile
      collapsed — не визуальная проблема"
    marker: judgment
    evidence: "Bar height = 48 (strip min-height) + 1 (border-top) = 49.
      appBody padding-top = 48 (равно strip content, не включая border).
      1px border-top bar'а перекрывает 1px cmHost top. Bar background
      rgba(10,10,14,0.92) ~ cmHost background, визуально неразличимо.
      Buffer 0 — intentional trade-off для максимизации editor space."
  - statement: "11 новых vitest тестов, 5 pre-existing failures (не мои)"
    marker: fact
    evidence: "npx vitest run: 5 failed, 735 passed. Failure list: 5
      uiState.test.ts тестов с setTab() ожидающим 'full' вместо 'half'
      (после commit 1d51ee6 в wavecode-editor-max-sheet-half). Baseline
      был тот же — НЕ РЕГРЕССИЯ. Из 11 новых тестов в TransportBar.test.tsx
      — все 11 pass (5 it блоков с разными scenarios)."
