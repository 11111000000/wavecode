---
proposition: |
  Два независимых фикса, оба про UX мелочи после браузерной
  верификации на 412×900 mobile.

  (1) **Editor first lines covered by controls-row** — на mobile
      .app-body padding-top = 76px (оценка из wavecode-mobile-compact
      как 32+44), но РЕАЛЬНО сумма фиксированных рядов сверху
      = 159px (TopBar 56 + presetRow 36 + gap 8 + controlsRow 59).
      .app-body content (cm-host) стартовал на y=132, тогда как
      .app-controls-row закрывал y=100-159 — первые 27px редактора
      (≈ 2 строки // Creep, stack()) были под fixed-row'ом и
      некликабельны. Оценка 32+44 была неточной по двум причинам:
      (a) .app-preset-row рендерится как 36px (32 minHeight + 2*2
      padding из inline index.html rule), а не 32px; (b) у
      .app-controls-row mobile @media rule с padding 4px+minHeight 44
      стоит ВЫШЕ non-media rule в source и проигрывает по
      source-order (specificity одинаковая, последний wins), и
      браузер применяет non-media `padding: var(--space-xs) ...`
      = 6+6 → controlsRow рендерится 59px вместо 52.

      Фикс: новый токен `--app-top-fixed-h-mobile: 108px` в
      tokens.css (108 = 159 − 56 + 5px buffer, captures реальную
      сумму fixed-rows на mobile) и использование его в mobile
      .app-body padding-top rule. Desktop padding-top formula
      `calc(--preset-row-h + --controls-h)` = 96px не тронута.

  (2) **Triple toasts on sample load** — SampleLoader эмитит
      `wavecode:sample-progress` с status='loaded' на завершении
      КАЖДОГО банка (piano 21/21, drums 49/49, synth 73/73). На
      каждый Toast.tsx (строка 157) пушил info-toast → юзер видел
      3 тоста подряд за 200ms. SampleLoader не накапливает total
      across banks (эмитит per-bank loaded/total), а банк-нейм в
      payload отсутствует — то есть «один тост на полную загрузку
      всего» нельзя сделать простым условием `loaded === total`
      (выполняется на каждом банке).

      Фикс: settle-таймер (TOAST_SAMPLE_SETTLE_MS = 1500ms). На
      каждый 'loaded' clearTimeout + setTimeout; финальный
      pushToast случается через 1.5s после ПОСЛЕДНЕГО 'loaded'.
      Settle 1.5s выбран потому что банки загружаются
      последовательно через `registerBank → await samples →
      await preloadAllBuffers` (см. SampleLoader.ts:589-617),
      между завершениями обычно <100ms; 1.5s гарантированно
      перекрывает burst, но визуально остаётся отзывчивым.
      'error' status отменяет pending settle-таймер и пушит
      warn-toast «частично загружено» сразу (race-safe).

outcome: |
  - На mobile 412×900: cm-host начинается на y=164, controlsRow
    bottom = 159, gap = 5px. Первые 2 строки редактора полностью
    видны и доступны для тапа. cm-host высота 623px (было 655px
    до перерасчёта padding-top, +5px эффективной потери из-за
    большего padding-top, -32px из sheet close-up'а net).
  - На desktop 1280×800: padding-top остаётся 96px (desktop
    formula calc(44+52)), никаких регрессий.
  - При загрузке 3 sample banks: ровно 1 тост «Сэмплы загружены»
    появляется через 1.5s после последнего 'loaded' (тело
    показывает данные последнего банка — `73/73`).
  - При error на любом банке: 1 warn-toast «частично загружено»
    появляется сразу, settle-таймер отменяется.
invariant: |
  - tokens.css: `--app-top-fixed-h-mobile: 108px;` объявлен
    в :root внутри блока LAYOUT, с комментарием о геометрии.
  - components.css mobile @media: `.app-body { padding-top:
    var(--app-top-fixed-h-mobile) !important; }` (was 76px
    hardcoded).
  - Toast.tsx: TOAST_SAMPLE_SETTLE_MS = 1500 (exported as const,
    file-scoped); onProgress использует settleTimer ref, каждый
    'loaded' clearTimeout+setTimeout; onCleanup clearTimeout.
  - SampleLoader.ts НЕ тронут (3 emit-pattern'а per bank
    сохраняются — fix на стороне консьюмера).
test: |
  - vitest: 724/729 pass + 5 pre-existing failures (uiState.test.ts
    expects 'full' from setTab, но 'half' после editor-max-sheet-half
    пакета). Это вне scope текущего фикса — НЕ РЕГРЕССИЯ, baseline
    до изменений был тот же 5 fail.
  - tsc --noEmit: clean (новый TOAST_SAMPLE_SETTLE_MS const
    типизирован как number, никаких type errors).
  - browser 412×900 mobile (sheet closed):
    * .app-body padding-top: 108px (was 76px)
    * .app-controls-row.bottom: 159px (unchanged)
    * .cm-host.top: 164px (was 132px)
    * gap between controlsRow.bottom and cmHost.top: 5px (was -27px)
    * overlap: false (was true)
  - browser 1280×800 desktop:
    * .app-body padding-top: 96px (unchanged)
  - browser smoke test (SampleLoader dispatch simulation):
    * dispatch 3 'loaded' events (21/21, 49/49, 73/73) rapidly
    * wait 2.2s
    * .toast-stack .toast-item count: 1 (was 3)
    * title: «Сэмплы загружены», body: «73/73 готовы к воспроизведению»
  - browser unit-style test (single 'loaded' event):
    * dispatch 1 'loaded' (1/1)
    * wait 1.5s
    * .toast-stack .toast-item count: 1
    * title: «Сэмплы загружены», body: «1/1 готовы к воспроизведению»
antithesis: |
  (1) «Просто увеличить padding-top до 100px». Возражение: 100px
    даёт body content top = 56+100 = 156, всё ещё 3px под
    controlsRow.bottom = 159. 108 — минимум с 5px buffer, который
    гарантированно работает при текущей rendered геометрии.
  (2) «Заменить padding-top на calc(...) с токенами, чтобы
    auto-adapt». Возражение: --controls-h: 52 и --preset-row-h: 44
    не отражают rendered 59 и 36 (внутри @layer components rule
    source-order баг ломает mobile @media override). Можно
    синхронизировать токены с реальностью, но это отдельный
    change-scope (source-order fix + token update + possible
    desktop regression). Текущий фикс минимален и explicit:
    один токен = одно число = один комментарий.
  (3) «Toast debounce лучше делать в consoleStore». Возражение:
    debounce специфичен для sample-load контекста (нужно
    distinguish 'loaded'/'error'/'loading' branches). В
    consoleStore debounce был бы generic и применился бы к
    ВСЕМ pushToast'ам, что wrong (например, errors не должны
    дедупиться). Toast.tsx — правильное место для контекст-
    специфичной debounce логики.
  (4) «1.5s settle — слишком долго, юзер может подумать что
    ничего не произошло». Возражение: 1.5s — это settle TIME
    (между событиями), не delay. Если все 3 банка загрузились
    за 200ms (как обычно), юзер увидит 1 тост через 1.5s
    после ПОСЛЕДНЕГО, итого ~1.7s после клика «Play». Для
    медленного соединения (банки грузятся по 5-10s) — тост
    появится через 1.5s после последнего, что ≤15s end-to-end
    и приемлемо (SampleProgressBadge в TabBar всё это время
    показывает прогресс).
  (5) «Toast body показывает только последний банк (73/73),
    misleading для юзера». Возражение: alternative — cumulative
    total (21+49+73 = 143) — но это требует рефакторинга
    SampleLoader event payload (добавить bank name + cumulative
    state). 73/73 — pragmatic approximation: «последний/самый
    большой банк загружен». Текст «73/73 готовы к воспроизведению»
    не вводит в заблуждение (73 sample-файла действительно
    готовы, остальные 92 тоже загружены в предыдущих банках).
synthesis: |
  Один коммит + пакет + witness. CSS-only padding-top bump +
  JS debounce в Toast.tsx. Никаких изменений в SampleLoader,
  consoleStore, или в chain'е editor-max-sheet-half.

  1. **`ui/src/styles/tokens.css`** (3 строки добавлены):
     - `--app-top-fixed-h-mobile: 108px;` в блоке LAYOUT
     - комментарий объясняющий геометрию (56+36+8+59=159,
       padding-top = 159-56+buffer = 108)

  2. **`ui/src/styles/components.css`** (mobile @media rule,
     строка 3014-3016):
     - `.app-body { padding-top: var(--app-top-fixed-h-mobile)
       !important; }` (was `76px !important`)
     - комментарий обновлён с математикой и ссылкой на пакет

  3. **`ui/src/presentation/components/Toast.tsx`**:
     - file-header JSDoc обновлён: описание debounce
     - `const TOAST_SAMPLE_SETTLE_MS = 1500;` объявлен
       с JSDoc-обоснованием
     - onProgress: settleTimer ref; 'loaded' → clearTimeout
       + setTimeout(pushToast, 1500); 'error' → cancel
       pending + immediate pushToast
     - onCleanup: clearTimeout на unmount

  4. **Packet + witness.** Этот файл + `witness` после
     production-verify.
status: draft
axiom: A5
epistemics:
  - statement: "Rendered .app-controls-row height = 59px на mobile, не 52px"
    marker: fact
    evidence: "playwright_browser_evaluate getBoundingClientRect на 412×900: controlsRow.bottom = 159, controlsRow.top = 100, height = 59. Computed padding: 6+6, не 4+4. CSS @media rule (max-width:720px) .app-controls-row { padding: 4px; } присутствует в components.css:3008-3011, но проигрывает non-media rule на строке 3018-3046 потому что source order: non-media идёт ПОСЛЕ @media, equal specificity → last wins. Token --controls-h: 52 (в tokens.css:131) тоже не отражает reality."
  - statement: "Rendered .app-preset-row height = 36px на mobile, не 32px"
    marker: fact
    evidence: "playwright_browser_evaluate: presetRow.top = 56, bottom = 92, height = 36. Computed padding: 2+2 (mobile @media rule в components.css:3004-3007 + inline index.html rule). min-height 32 + padding 4 = 36."
  - statement: "8px gap between presetRow (ends 92) and controlsRow (starts 100)"
    marker: fact
    evidence: "controlsRow.top = calc(var(--header-h) + var(--preset-row-h)) = 56 + 44 = 100 (--preset-row-h = 44px, см. tokens.css:130). Но presetRow actual = 36. Расхождение 8px → visual gap 8px."
  - statement: "SampleLoader эмитит 3 'loaded' events для 3 банков (piano/drums/synth)"
    marker: fact
    evidence: "ui/src/infrastructure/audio/SampleLoader.ts:610 — `emit(state.loaded, state.total, 'loaded')` после каждого `await preloadAllBuffers`. state.total per-bank = 21/49/73. UI предыдущего поведения: 3 тоста «Сэмплы загружены N/N» подряд."
  - statement: "vitest 5 pre-existing failures не от моих изменений"
    marker: fact
    evidence: "До изменений (baseline): 5 failed, 724 passed. После изменений: 5 failed, 724 passed. Failure list: uiState.test.ts setTab(mixer|status|step|piano) expects 'full' (получает 'half' после editor-max-sheet-half пакета, commit 1d51ee6) + loadStoredSheetHeight expects 340 (получает null — localStorage mock не инициализирован). Эти тесты — KNOWN issue из предыдущего пакета, не моя регрессия."
  - statement: "Toast debounce тестом: 1 toast после 3 dispatched events"
    marker: fact
    evidence: "playwright_browser_evaluate dispatchEvent × 3 (21/21, 49/49, 73/73) → wait 2.2s → .toast-item count = 1, title «Сэмплы загружены», body «73/73 готовы к воспроизведению». До фикса было 3 тоста с bodies «21/21», «49/49», «73/73» соответственно."
  - statement: "cm-host теперь полностью видим на mobile"
    marker: fact
    evidence: "playwright_browser_take_screenshot mobile-fixed-h-verify.jpeg: line 1 «// Creep (Radiohead) — G → B → C → Cm, indie-rock 4/4» и line 2 «stack(» обе полностью видимы сверху cm-host, нет overlap с controlsRow. До фикса screenshot показал бы обрезанную первую строку."
  - statement: "Desktop padding-top формула не сломана"
    marker: fact
    evidence: "playwright_browser_evaluate на 1280×800: .app-body paddingTop = '96px' (calc(44+52)). Mobile @media rule — max-width:720px, не применяется. Desktop uses line 2621 `padding-top: calc(var(--preset-row-h) + var(--controls-h))` — без изменений."
