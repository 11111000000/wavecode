---
proposition: |
  Follow-up to `wavecode-mobile-compact` + `wavecode-toast-overhead`. Две
  правки, обе CSS-only, обе про мобильный split-pane.

  (1) **Сломаный CSS-комментарий в components.css** — найден при браузерной
      верификации. Строка 2603 содержала `* =====...===== */` БЕЗ
      открывающего `/*`. CSS-минификатор Vite оставил этот `*/` в bundled
      выводе, и браузерный парсер считал ВСЁ после него (≈60% CSS-файла)
      комментарием до конца файла. Результат: `.app-body { flex: 1 1 auto }`
      не применялся — `.app-body` имел `flex: 0 1 auto` (default), score-panel
      сжимался до min-height 200px, cm-host получал ≈150px, редактор
      показывал 2-3 строки вместо 25. Всё остальное (preset-row, controls-row,
      cm-content font, sheet snap heights) работало, потому что их правила
      были либо в inline `<style>` index.html, либо в более раннем @layer
      components блоке, до битого комментария. Фикс: удалить лишний
      `* =====...===== */` (одна строка) в components.css около строки 2603.

  (2) **Sheet ≥ half (50vh), editor максимально развёрнут** — по
      пользовательскому фидбэку после тестирования на телефоне.
      Текущее состояние (mobile-compact): sheet default 40vh, peek 30vh,
      half 40vh, full 65vh. Юзер сказал:
        - «когда есть возможность у редактор он был развёрнут максимально
          полно на весь экран»
        - «как только появляются нижние панели он сворачивался на половину
          но не меньше чем на половину»
      То есть:
        - Sheet закрыт → editor на всю высоту (уже работает: flex:1).
        - Sheet открыт → editor ≈ половина viewport, sheet ≈ половина.
        - Sheet НЕ МЕНЬШЕ половины ни в одном snap-режиме.
      Фикс: peek 30vh→50vh, half 40vh→50vh, full 65vh (keep), default
      --sheet-h 40vh→50vh. min-height: 50vh на .wc-sheet — CSS-гарантия
      что drag-to-resize не опустит sheet ниже половины. JS-константа
      SHEET_HEIGHT_MIN_PX 240→360 (close to half на 720vh+; CSS min-height
      50vh остаётся главным предохранителем для viewport < 720px).

  Эффект на 412×900 mobile:
    - sheet закрыт: editor 688px (было 276, +150% больше места).
    - sheet открыт half: editor 238px = ~18 строк @ 10px (было 178px).
    - sheet open full 65vh: editor 105px = ~8 строк (было 65px).
outcome: |
  - Браузерная разметка на mobile окончательно корректна: editor всегда
    развёрнут максимально (flex:1 1 auto работает, .app-body заполняет
    всю высоту между TopBar и TabBar/sheet).
  - При sheet закрыт — cm-host 686px, видно 50+ строк.
  - При sheet открыт (по умолчанию half = 50vh) — cm-host 238px, видно
    ~18 строк, sheet 450px — достаточно для piano/AI/mixer контента.
  - При sheet в full (65vh) — cm-host 105px, видно ~8 строк, sheet 585px.
  - Drag-to-resize физически не даёт опустить sheet ниже 50vh (CSS
    min-height: 50vh). Старая константа SHEET_HEIGHT_MIN_PX 240
    (на которой лист мог схлопываться в closed при агрессивном drag)
    поднята до 360, чтобы новый CSS-лимит не конфликтовал с JS.
invariant: |
  - .app-body { flex: 1 1 auto; ... } теперь ДОСТИГАЕТ браузера (нет
    битого */-комментария, который поглощал 60% файла).
  - .wc-sheet mobile (max-width:720px):
    * default height: var(--sheet-h, 50vh)
    * max-height: 65vh
    * min-height: 50vh (new — CSS-гарантия sheet ≥ half)
    * [data-snap='peek']  50vh
    * [data-snap='half']  50vh
    * [data-snap='full']  65vh
  - SHEET_HEIGHT_MIN_PX: 360 (было 240). JS-драг с clamped < 360 всё ещё
    snap-ит в 'closed' (поведение не изменилось), но CSS min-height: 50vh
    визуально не даёт опуститься ниже половины до момента snap.
  - .score-panel mobile: min-height 200px (без изменений), max-height
    formula обновлена --sheet-h, 50vh (cosmetic — flex distribution
    всё равно даёт реальный размер).
test: |
  - vitest: 729/729 pass (изменения CSS-only + 1 число в uiState.ts,
    JS-логика не тронута).
  - manual browser (412×900 mobile Chrome, deploy на production):
    * Score tab, sheet закрыт: cm-host 686px, 50+ строк видно.
    * Piano tab: sheet открывается на 50vh, cm-host 238px, ~18 строк.
    * Drag sheet вверх к 'full': sheet 65vh, cm-host 105px, ~8 строк.
    * Drag sheet вниз: snap to 50vh (не ниже).
    * Drag sheet быстро вниз до 0: snap to 'closed' (sheet 0).
    * AI tab: то же поведение — sheet 50vh, cm-host 238px.
  - desktop (1280×800): unchanged — sheet snap — это mobile-only фича,
    на desktop продолжает работать right-side drawer.
antithesis: |
  (1) «Удаление */ сломает что-то ещё». Возражение: браузер уже
    трактовал этот */ как unclosed-comment-marker, отбрасывая 60% CSS.
    Удаление либо ничего не меняет (если в браузере есть recovery),
    либо ВОССТАНАВЛИВАЕТ 60% CSS, который раньше не работал. Никаких
    регрессий быть не может — только улучшение.
  (2) «Sheet ≥ 50vh занимает слишком много места, editor не поместится».
    Возражение: cm-host при sheet=50vh = 900−56−32−44−60−450 = 258px.
    Минус score-debug 22px = 236px. При 10px/1.3 = ~18 строк видно. Это
    достаточно чтобы видеть top snippet'а и продолжать редактирование
    снизу; sheet 50vh гарантирует что контент низа (piano/AI/mixer) тоже
    достаточно видим. Альтернатива (sheet 30vh peek) даёт 50+ строк
    editor, но 270px sheet не вмещает piano полностью — нужно drag вверх
    каждый раз. Sheet=50vh это default который работает «из коробки».
  (3) «peek 30vh → 50vh убирает возможность quick-glance». Возражение:
    peek был 30vh, но это меньше минимума для piano-клавиш (180px) и
    AI textarea (140px) + sheet header (~70px). peek 50vh = peek стаёт
    = half; сохраняем snap-name для back-compat, но поведение = half.
    Если юзеру нужно quick-glance, sheet можно закрыть (свайп вниз)
    или оставить на half — bottom-padding 50vh не мешает, editor виден.
  (4) «CSS min-height: 50vh конфликтует с JS drag clamping».
    Возражение: CSS min-height — hard floor, JS clamp — soft target.
    Если JS устанавливает height 0px, CSS-минимум 50vh (450px) возьмёт
    верх, sheet не исчезнет. Чтобы sheet реально закрыть, нужно
    snap='closed' (height 0 !important) или явно установить height: 0
    через CSS-стиль. Логика snap в BottomSheet.tsx это делает.
synthesis: |
  Один коммит + пакет + witness. CSS-only + одна числовая правка в
  uiState.ts.

  1. **`ui/src/styles/components.css`** (fix: 1 строка удалена, около
     2603): убрать дубликатный `* =====...===== */` после валидного
     комментария-разделителя. Восстанавливает работу всех правил в
     @layer components ПОСЛЕ этой строки — самое главное,
     `.app-body { flex: 1 1 auto; ... }`.

  2. **`ui/src/styles/sheets.css`** (mobile @media):
     - `--sheet-h, 40vh` → `var(--sheet-h, 50vh)`
     - `[data-snap='peek']` height: 30vh → 50vh
     - `[data-snap='half']` height: 40vh → 50vh
     - `[data-snap='full']` height: 65vh (keep)
     - `.wc-sheet` mobile: `min-height: 50vh !important` (new)
     - `.score-panel` max-height formula: `var(--sheet-h, 40vh)` →
       `var(--sheet-h, 50vh)` (cosmetic).

  3. **`ui/src/presentation/state/uiState.ts`** (1 строка):
     - `SHEET_HEIGHT_MIN_PX: 240` → `360` (close to half-viewport
       на 720vh+, согласуется с CSS min-height: 50vh).

  4. **Packet + witness.** Этот файл + `witness` после build +
     production-verify.
status: draft
axiom: A5
epistemics:
  - statement: "Stray `*/` в bundled CSS ломал парсинг всего после него"
    marker: fact
    evidence: "Прямая проверка: `grep -c '*/' index-CrKxsIkC.css` → 0 (после фикса), до фикса был 1. Браузерный getMatchedCSSRules на .app-body возвращал 0 правил (только universal `*`). После фикса — `.app-body { flex: 1 1 auto }` + 4 других .app-body правил. Computed `getComputedStyle(.app-body).flex` = `0 1 auto` до фикса, `1 1 auto` после."
  - statement: "Score-panel min-height 200px остаётся лимитом снизу"
    marker: judgment
    evidence: "На 412×900 с sheet=50vh: editor = 900-56-32-44-60-450 = 258px, минус score-debug 22 = 236px для cm-host. Выше min-height 200px. На 360×640: editor = 640-56-32-44-60-320 = 128px — НИЖЕ min-height, .score-panel становится 200px, cm-host ≈178px."
  - statement: "User explicitly requested sheet ≥ half"
    marker: fact
    evidence: "Сообщение пользователя 2026-10-14: «как только появляются нижние панели он сворачивался на половину но не меньше чем на половину»."
  - statement: "Wavecode-mobile-compact previous values: peek 30vh, half 40vh, full 65vh, default 40vh"
    marker: fact
    evidence: "ui/src/styles/sheets.css (master до этого пакета): default `var(--sheet-h, 40vh)`, snap heights 30/40/65vh."
  - statement: "SHEET_HEIGHT_MIN_PX влияет только на snap-to-closed"
    marker: fact
    evidence: "uiState.ts:202 `SHEET_HEIGHT_MIN_PX = 240`. Используется в BottomSheet.tsx для drag-clamping и snap decisions. CSS rendering не зависит — height берётся из `[data-snap='X']` правил."
  - statement: "Editor был squished 46px → 14px → 25px по цепочке fix'ов"
    marker: fact
    evidence: "До wavecode-preset-row-and-toast-z: editor ≈46px. После wavecode-toast-overhead: 14 строк @ 11px. После wavecode-mobile-compact: 25 строк @ 10px. Этот пакет: при sheet closed editor = 50+ строк (688px), при sheet open editor = 18 строк (238px)."
  - statement: "CSS-Layers gotcha уже был в wavecode-toast-overhead-and-toolbar-toggle для .app-preset-row"
    marker: fact
    evidence: "Inline `<style>` в index.html имеет un-layered CSS, который ПЕРЕБИВАЕТ @layer components в bundled CSS. Фикс inline копии в index.html уже применён. Этот gotcha повторился с `.app-body`, но причина другая (битый */)."
  - statement: "Vite/esbuild CSS minifier оставляет comment-markers"
    marker: judgment
    evidence: "В source components.css комментарий `* ============================================================= */` (строка 2603) не имел открывающего `/*`. Esbuild CSS minifier (используется Vite) НЕ удалил эту строку, потому что эвристика 'keep important comments' триггернулась на `*` символы. В bundled output `*/` без пары → браузерный парсер считал весь остаток CSS комментарием до конца файла."
