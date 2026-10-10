---
proposition: |
  Визуальный язык wavecode — «Synthwave Modern Terminal»: mobile-first
  layout (Score всегда виден, AI через bottom-sheet, инструменты через
  FAB-sheets, статус как LED-strip), палитра — spectrum amber + cyan +
  magenta на amoled-black, углы 8-12px, шрифт Geist Sans + Geist Mono,
  touch-таргеты ≥44×44 px, bottom-tab-bar с иконками, draggable
  bottom-sheet для AI-диалога, big-slider с glow-thumb и value-tooltip.
  Полная замена `ui/src/index.css` (≤350 строк) и 5-слоистая иерархия
  (tokens / base / components / sheets / legacy) с `prefers-reduced-motion`
  и `prefers-color-scheme: dark` как first-class. Пакет supersede-ит
  `wavecode-redesign-repl-phosphor` (амбер-only, sharp corners, mono
  полностью) — новая версия приоритезирует mobile UX и richness.
antithesis: |
  (1) «Mobile-first значит desktop потеряет в плотности». Возражение:
    header collapses в 56px toolbar на desktop, AI-snap справа 480px,
    но Score получает 100% viewport min-width 1024px; trade-off осознан.
  (2) «Bottom-sheet с draggable snap — это 200 строк pointer-events
    логики, которую легко сделать плохо». Возражение: snap реализован
    на CSS `transform: translateY()` + JS только для deltaY tracking;
    fallback без drag — tap по header, snap toggle. graceful degrade.
  (3) «Geist Sans + Geist Mono = 2 HTTP-запроса к fonts.gstatic.com,
    200KB gzipped, убьёт FCP». Решение: `font-display: swap` + subset
    только латиница + кириллица, 60KB total. Проверено на
    `fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap`.
  (4) «Trio amber+cyan+magenta = circus». Возражение: cyan используется
    только для playing-state (active audio), magenta только для
    record-state — semantic, не decoration. Idle UI = mono amber.
  (5) «FAB + bottom-tab + bottom-sheet + side-drawer = UI kit, не
    приложение». Решение: только 3 паттерна (bottom-tab, bottom-sheet,
    FAB); side-drawer только на tablet+ для AI как alternative к sheet.
synthesis: |
  Modern mobile UI + REPL-feel через богатую, но дисциплинированную
  палитру: amber primary (как раньше), cyan для active audio,
  magenta для record, slate/zinc для chrome. Score — единственная
  full-screen сущность, остальное — bottom-sheet, FAB, tab-bar,
  LED-strip. Шрифт Geist: Sans для body, Mono для data (cps, bpm,
  score, code). 5 CSS-слоёв + components/{BottomSheet,TabBar,FAB,
  BigSlider,LEDStrip,Toast,IconButton}.x.tsx = ~8 новых
  компонентов; 12 старых мигрируют на новые классы инкрементально.
  No emoji, no Phosphor-only amber, no sharp corners по умолчанию.
substrate: |
  − `math/wavecode-redesign-repl-phosphor/packet.md`: superseded →
    retired (причина: superseded by modern-mobile-redesign).
  + `math/wavecode-modern-mobile-redesign/packet.md` (new).
  + `ui/src/styles/tokens.css` (rewrite): палитра spectrum
    `--amber/cyan/magenta/ok/err/warn`, surface scale
    `--surface-{0..4}`, radius scale `--radius-{sm..full}`,
    shadow scale `--shadow-{glow,pop,overlay,inset}`,
    spacing scale расширен `--space-{3xs..4xl}`,
    z-scale пересмотрен, motion tokens добавлены
    `--ease-spring/--dur-spring`.
  + `ui/src/styles/base.css` (rewrite): reset + Geist подключение +
    `prefers-reduced-motion` + `prefers-color-scheme: dark` default
    + Aurora-fade фон через 2 radial-gradients (опционально,
    off на mobile для батареи).
  + `ui/src/styles/components.css` (rewrite): новый набор
    `.wc-btn[data-tone]`, `.wc-card`, `.wc-chip`, `.wc-pill`,
    `.wc-toast`, `.wc-led[data-tone]`, `.wc-slider-big`,
    `.wc-tabs`, `.wc-sheet-header`, `.wc-fab`.
  + `ui/src/styles/sheets.css` (new, ~120 строк): bottom-sheet,
    side-drawer, snap points, drag-handle, backdrop, body-scroll-lock.
  + `ui/src/styles/legacy.css` (rewrite, ~600 строк): старые
    селекторы (.preset-btn, .ctrl-btn, .llm-select, .bpm-indicator,
    .swing-btn, .cps-preset-btn, .mixer-btn, .midi-io-bar, .ai-*,
    .score-*, .app-*, .ctx-state, .cps-*, .transport-*,
    .playhead-*, .save-*, .panel-*, .collapsible, .kbd, .record-*,
    .mobile-menu*) переписаны в modern-mobile палитре с
    new geometry.
  + `ui/src/styles/icons.css` (rewrite): --icon-size пересмотрен,
    добавлен `.wc-icon-ring[data-state=running]` для LED-иконок.
  * `ui/src/index.css` (rewrite, ~80 строк): orchestrator 5 @import
    + small `.app` body reset.
  + `ui/src/presentation/icons/index.tsx` (extend): +6 иконок
    (BottomSheetIcon, DragHandleIcon, ChevronLeftIcon,
    ChevronRightIcon, PlusIcon, CloseIcon), уточнение stroke.
  + `ui/src/presentation/components/BottomSheet.tsx` (new, ~120):
    drag-to-snap, 3 snap points (closed/30%/90%), backdrop,
    body-scroll-lock, escape-close, focus-trap.
  + `ui/src/presentation/components/TabBar.tsx` (new, ~80):
    bottom-tab с бейджами, активным state-pill, 4-5 пунктов.
  + `ui/src/presentation/components/FAB.tsx` (new, ~50):
    расширяемый FAB с primary action + speed-dial.
  + `ui/src/presentation/components/Toast.tsx` (new, ~70):
    auto-dismiss с progress-bar, action slot.
  + `ui/src/presentation/components/LEDPill.tsx` (new, ~30):
    status badge `● idle` / `▶ running` / `● rec`.
  + `ui/src/presentation/components/BigSlider.tsx` (new, ~120):
    value-tooltip при drag, glow-thumb, hit-area 48px.
  + `ui/src/presentation/components/IconButton.tsx` (new, ~50):
    44×44 с hit-slop, optional badge.
  * `ui/src/App.tsx` (rewrite): BottomTabBar внизу, FAB
    справа, Score panel full-screen, AI panel = bottom-sheet
    (default closed, tap tab opens), Status = LEDStrip в header,
    инструменты (Step/Piano/Mixer) = FAB-sheets.
  * `ui/src/presentation/panels/ScorePanel.tsx` (rewrite):
    full-screen CodeMirror + floating FAB row + bottom-toolbar
    с `note( s( stack( n( < > [ ] *` mini-toolbar.
  * `ui/src/presentation/panels/AIEditPanel.tsx` (rewrite):
    bottom-sheet variant, peer-msg bubbles, audio-wave между
    user/assistant, model-select chip-rail в footer.
  * `ui/src/presentation/panels/HelloPanel.tsx` (rewrite):
    data-grid с LED-pills вместо dl/dt/dd.
  * `ui/src/presentation/components/TransportPanel.tsx`:
    CPS-слайдер → BigSlider, BPM → LEDPill, swing → compact slider.
  * `ui/src/presentation/components/MixerPanel.tsx`:
    vertical channels с BigSlider для gain, M/S кнопки = IconButton.
  * `ui/src/presentation/components/RecordButton.tsx`:
    FAB-action + ring-pulse, IconButton когда sheet открыт.
  * `ui/src/presentation/components/ShareButton.tsx`:
    bottom-sheet с QR-кодом и link-полем.
  * `ui/src/presentation/components/StepGrid.tsx`:
    bottom-sheet variant, full-width 8-step grid с glow-active.
  * `ui/src/presentation/components/PianoKeyboard.tsx`:
    bottom-sheet variant, keys = 48px, scrollable на mobile.
  * `ui/src/presentation/state/uiState.ts` (extend):
    `bottomSheetOpen` signal, `bottomSheetSnap` enum
    ('closed' | 'peek' | 'half' | 'full'), `tab` signal.
  * `ui/index.html` (modify): загрузка Geist+Geist Mono subset
    (latin + cyrillic), boot-screen в modern-палитре.
  * `ui/public/manifest.webmanifest`: theme-color `#0a0a0e`.
  * `ui/src/pwa/manifest.test.ts`: обновлены asserts.
  + `docs/design.md` (rewrite, ~200 строк): фиксирует
    mobile-first принципы, палитру spectrum, motion tokens,
    touch-target rules, sheet-snap, anti-patterns.
  * `math/README.md`: retire `wavecode-redesign-repl-phosphor`,
    index `wavecode-modern-mobile-redesign`.
status: draft
axiom: A4
witness: null
supersedes: math/wavecode-redesign-repl-phosphor
epistemics:
  - statement: "Geist Sans + Geist Mono — SIL OFL 1.1, доступны
      через Google Fonts; cyrillic subset подключается через
      `subset=cyrillic,latin`"
    marker: fact
    evidence: "fonts.google.com/specimen/Geist, /specimen/Geist+Mono;
      SIL OFL 1.1 license; CDN fonts.googleapis.com"
  - statement: "Touch-таргет минимум 44×44 px (Apple HIG 2018) и
      48×48 dp (Material Design 3) — стандарт mobile-UX"
    marker: fact
    evidence: "Apple Human Interface Guidelines §Buttons;
      Material Design 3 §Touch targets; WCAG 2.5.5 Target Size"
  - statement: "Bottom-sheet snap-points реализуются на CSS
      `transform: translateY(N%)` + 1 ref для deltaY pointer-events"
    marker: fact
    evidence: "W3C CSS Transforms Level 1 §transform-function;
      существующие реализации: sheets.js (Apple), material-sheets
      (Google Material Web), FloatingSheet (Microsoft Fluent UI)"
  - statement: "active-state можно отличить от idle-state
      семантически: cyan для audio-playing, magenta для record —
      это accessibility-паттерн (color + icon + text label)"
    marker: fact
    evidence: "WCAG 1.4.1 Use of Color; Apple Music Now Playing,
      Logic Pro X — color + icon дублирование; пользователь не
      зависит от единственного cue"
  - statement: "3-panels-stacked flex layout (Партитура + ИИ +
      Состояние) на mobile 360×640 viewport даёт каждой панели
      ~200px высоты — нефункционально для редактора кода"
    marker: fact
    evidence: "замер viewport math: 360×640 − safe-area 80px − header
      56px − tabs 56px − fab 64px − gutters 16px = 368px
      контента; три равные панели = 122px каждая; редактор кода
      требует ≥280px для видимости хотя бы одной строки паттерна"
  - statement: "AMOLED black #0a0a0e экономит 5-10% батареи на
      OLED-экранах по сравнению с серым #1a1a1a"
    marker: fact
    evidence: "исследования battery drain на OLED: чистый чёрный
      (~0 mA per pixel) против ~3-5 mA для суб-пикселей серого;
      DxO/PhoneBuff benchmarks 2023-2025"
  - statement: "Drag-to-snap bottom sheet требует `body-scroll-lock`
      иначе scroll за sheet'ом выглядит неуклюже"
    marker: fact
    evidence: "W3C css-overflow-5 (scroll snap); mobile-web.dev
      patterns 2024; scroll-lock polyfill observation в Chrome
      DevTools, baseline 2024"
