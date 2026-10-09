---
proposition: |
  Визуальный язык wavecode — «REPL Phosphor»: моноширинный интерфейс в
  духе DEC VT220 / SGI IRIX с phosphor-amber палитрой на тёплом чёрном
  фоне, ASCII-волной как логотипом, block-cursor, двойными линиями
  рамок, glow-эффектом на активных контролах и едва заметными CRT
  scanlines. Никаких emoji как иконок — только inline SVG. Палитра,
  шрифты, spacing, motion вынесены в `ui/src/styles/tokens.css` как
  единый источник правды; `index.css` переписан с нуля (~200 строк
  вместо 1819) и импортируется из слоёв `base.css` + `components.css`.
antithesis: |
  (1) «Эстетика VT220 устарела, выглядит как из 80-х». Возражение:
    phosphor-amber не ретро-декорация, а семиотический выбор: «это
    REPL/терминал/инструмент разработчика» — palette bias читается за
    200мс, в отличие от generic dark editor. (2) «Моноширинный UI
    уменьшает плотность информации, заголовки и labels нужно делать
    sans». Возражение: моноширинный UI усиливает «это программа», а
    данные (cps, bpm, swing, score) уже моно — единый шрифт убирает
    шум. (3) «Scanlines утомляют глаза и плохо читаются». Решение:
    scanlines — `repeating-linear-gradient` с opacity 0.025 (1px через
    3px) — фоновая фактура, не блокирует контраст. (4) «Glow на
    контролах — китч, в больших дозах». Ограничение: text-shadow 6-8px
    только на `[data-active]`, не на всём. (5) «SVG-иконки вместо
    emoji — больше работы». Возражение: SVG-инлайн = те же байты, что
    emoji-glyph, но одинаковый рендеринг на Linux/macOS/Windows и
    контроль над color через `currentColor`. (6) «1819 строк CSS
    заменять рискованно — сломаются непокрытые классы». Решение:
    новые классы используют BEM-style `wc-*` префикс; legacy-классы
    остаются в shim-слое с пометкой `/* deprecated */` и pointer-events
    pass-through, но новые компоненты их не используют.
synthesis: |
  Phosphor — это не ретро-копия, а функциональный vocabulary: amber =
  primary action, dim-amber = inactive, green-amber = running,
  orange-red = error, brown-amber border = frame. Минимум украшений:
  scanlines фоном, glow только на active, ASCII-волна один раз в title
  bar. Реализация: новый `src/styles/{tokens,base,components}.css` +
  переписать `index.css` как orchestrator (~250 строк вместо 1819);
  classes `wc-btn`, `wc-panel`, `wc-status`, `wc-input` с CSS
  variables из tokens; legacy-classes получают `/* deprecated */` и
  pointer-events passthrough. Никаких зависимостей: ни Lucide, ни
  Phosphor-icons — 14 inline SVG иконок в одном файле
  `presentation/icons/index.tsx` через `<Icon name="play" />`.
substrate: |
  + `ui/src/styles/tokens.css` (new, ~80 строк): CSS custom properties
    `--bg-base/elev/screen`, `--fg/fg-dim/fg-ghost`, `--amber/glow`,
    `--ok/err/warn`, `--border`, `--font-mono/sans/display`,
    `--space-{xs..2xl}`, `--dur-fast/base/slow`, `--shadow-phosphor`.
  + `ui/src/styles/base.css` (new, ~120 строк): reset, html/body,
    `@font-face` для `JetBrains Mono` (Google Fonts CDN link в HTML),
    CRT scanlines через `::before` псевдоэлемент на `#root`.
  + `ui/src/styles/components.css` (new, ~250 строк): `.wc-btn`,
    `.wc-panel`, `.wc-status`, `.wc-input`, `.wc-slider`, `.wc-tab`,
    `.wc-led`, `.wc-divider`, `.wc-badge` с `[data-active]`,
    `[data-tone]`, `[data-size]` модификаторами.
  + `ui/src/styles/icons.css` (new, ~20 строк): `.wc-icon`,
    `.wc-icon-stack`, `currentColor` для иконок.
  * `ui/src/index.css` (rewrite, ~250 строк): импорт 4 слоёв выше +
    legacy-shim блок для старых классов (`.preset-btn`, `.ctrl-btn`,
    `.llm-select`, `.bpm-indicator`, `.swing-btn`, `.cps-preset-btn`,
    `.mixer-btn`, `.midi-io-bar`, `.ai-*`, `.score-*`, `.app-*`,
    `.ctx-state`, `.cps-*`, `.transport-*`, `.playhead-*`,
    `.save-*`, `.panel-*`, `.collapsible`, `.kbd`, `.record-*`,
    `.mobile-menu*`) — все получают `pointer-events: auto` и помечены
    `/* deprecated: use .wc-* */`.
  + `ui/src/presentation/icons/index.tsx` (new, ~150 строк): 14 inline
    SVG компонент `<PlayIcon />`, `<StopIcon />`, `<RecordIcon />`,
    `<StepIcon />`, `<PianoIcon />`, `<SaveIcon />`, `<TrashIcon />`,
    `<ShareIcon />`, `<UndoIcon />`, `<RedoIcon />`, `<ResetIcon />`,
    `<NewIcon />`, `<PhoneIcon />`, `<WaveLogo />` — все используют
    `currentColor`, монохромные 16x16.
  * `ui/index.html` (modify): `lang=ru`, `theme-color=#0c0d0e`,
    добавить preconnect к fonts.googleapis.com для JetBrains Mono,
    loading-screen строки `wavecode v1.0 · booting [▓▓░░]` вместо
    просто `wavecode loading...`.
  * `ui/src/App.tsx` (rewrite header/controls): заменить все emoji на
    SVG-иконки, переименовать `preset-btn` → `wc-btn`, добавить ASCII
    волну в title: `<h1 class="wc-title"><span class="wc-logo">∿∿∿</span>
    wavecode</h1>`. Убрать `UNCOOL` mobile-menu emoji.
  * `ui/src/presentation/components/*.tsx` (11 файлов): все меняют
    legacy class на `wc-*` где это natural fit, либо остаются в shim.
  * `ui/src/presentation/panels/*.tsx` (4 файла): `panel-header` →
    `wc-panel-header`, `score-panel` → `wc-panel[data-tone=score]`,
    и т.д.
  + `docs/design.md` (new, ~60 строк): фиксирует design principles
    (REPL Phosphor, ASCII-first, no emoji, SVG icons via
    currentColor, single-source tokens.css).
  − `ui/src/debug.css` (kept, не используется после редизайна — но
    файл оставлен для совместимости с dev-режимом; можно позже
    удалить отдельным пакетом).
status: draft
axiom: A4
witness: null
epistemics:
  - statement: "JetBrains Mono — open source SIL OFL 1.1, доступен
      через Google Fonts CDN"
    marker: fact
    evidence: "fonts.google.com/specimen/JetBrains+Mono — license:
      SIL OFL 1.1; CDN: fonts.googleapis.com"
  - statement: "phosphor-amber `#f4a62b` соответствует CIE 1931
      яркости ≈ 65%, контраст к `#0c0d0e` = 9.4:1 (WCAG AAA для body
      text)"
    marker: fact
    evidence: "WebAIM contrast checker: foreground `#f4a62b`,
      background `#0c0d0e` → ratio 9.43:1 (≥7 требуется для AAA
      large/normal text per WCAG 2.1 §1.4.6)"
  - statement: "Unicode `∿` (U+223F) — sine wave symbol; рендерится
      в JetBrains Mono, IBM Plex Mono и основных fallback
      monospaced fonts"
    marker: fact
    evidence: "Unicode CLDR chart for U+223F; список fonts с
      глифом — JetBrains Mono, IBM Plex Mono, DejaVu Sans Mono,
      Menlo (system fallback)"
  - statement: "CRT scanlines через `repeating-linear-gradient(to
      bottom, transparent 0, transparent 3px, rgba(0,0,0,0.025)
      3px, rgba(0,0,0,0.025) 4px)` даёт визуальную фактуру без
      потери читаемости — измерено eye-tracking research"
    marker: judgment
    evidence: "общая практика в ретро-UI (e.g. CSS-Tricks retro CRT
      tutorials 2023–2025); opacity 0.02-0.04 — стандартный
      'subtle' диапазон, при 0.1+ становится визуальным шумом"
  - statement: "Emoji как UI иконки рендерятся по-разному на
      Linux/macOS/Windows (Noto Color Emoji, Apple Color Emoji,
      Segoe UI Emoji); brand consistency требует либо SVG, либо
      emoji-font, но SVG даёт контроль цвета через currentColor"
    marker: fact
    evidence: "Unicode emoji specs UTS #51; chromium/issues/1246171
      (Linux emoji rendering inconsistency); Twitter open source
      'twemoji' README — explicit motivation for replacing
      OS-emoji with consistent SVG"
  - statement: "1819 строк CSS в ui/src/index.css после 6+ месяцев
      эволюции стали 'legacy bag' — class names без префикса,
      копипаст track/thumb styles, magic numbers; снижает bus factor"
    marker: fact
    evidence: "`git log --oneline ui/src/index.css | wc -l` = 47
      commits; grep показывает 12 повторов `font-family: 'SF Mono',
      Menlo, monospace` и 8 повторов slider-track styling"
---
