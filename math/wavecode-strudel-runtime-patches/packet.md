---
proposition: |
  Три независимых бага в Strudel-стеке `@strudel/{core,tonal,webaudio}`
  коллапсируют в «захлёбывающийся UI»: в консоль летит ~10 logs/sec,
  а LLM-ответы оператора не доходят. Каждый корень — отдельный, фиксы
  ортогональны:

  1. **`[voicing]: unknown chord "<X>"`.** `voicings.mjs:144` делает
     `dictionary[symbol].map(...)`; если chord-suffix (`maj7`, `min7`)
     не ключ — throws, catch в `voicing.mjs:210` логирует на КАЖДЫЙ
     hap. ireal-dictionary (`simple` из `ireal.mjs`) содержит
     tonal-style keys (`^7`, `m7`, `+`, etc.) + авто-алиасы через
     `voicingAlias()` для `^` / `-` / `+`, но НЕ для длинных форм
     `maj7` / `min7`. `<Dmin7 G7 Cmaj7>` в Jazz ii-V-I пресете ловит
     это ~8 раз/sec потому что voicing ре-эвалится на каждый hap
     резолвящийся chord'а (а не один раз/цикл, как можно подумать).

  2. **`[getTrigger] error: sound drums not found!`.**
     `superdough.mjs:572` бросает этот `Error` когда `soundMap[s]`
     undefined. SampleLoader регистрирует `drums_bd`, `drums_sd` …
     bare-алиасы (`bd`, `sd`, …) через `addBareAliases()`, но НЕ
     ключ `drums` (это BANK имя, не sound). LLM регулярно халлюцинирует
     `s("drums")` как «общий барабан» — scheduler-fire на hap-саунде
     `drums` → `soundMap["drums"]` undefined → throw на каждом
     цикле scheduler'а (тот же ~200 ms цикл что и выше).

  3. **CSS-строка `background-color: black;color:white;border-radius:15px`
     в КАЖДОМ `[getTrigger]` / `[voicing]` / `[cyclist]` сообщении.**
     `@strudel/core/logger.mjs:21` вызывает
     `console.log(\`%c${message}\`, 'background-color: black;…')`.
     В Chromium DevTools `%c` + companion CSS дают ОДНО стилизованное
     сообщение. В Paseo chat / copy-paste / log-файлах CSS-string
     append'ится к тексту verbatim → мусор в каждой строке ошибок.

  4. **`[AIEditPanel] LLM error: LLM HTTP request failed: Failed to fetch`.**
     `LiveLLMClient.ts:67` ловит `err` от `fetch()` и пишет
     `err.message` в `Error`. На Chromium `fetch` бросает
     `TypeError: Failed to fetch` для трёх КАЧЕСТВЕННО разных причин
     (CORS preflight fail / mixed-content / network down), и
     `err.message` их НЕ различимы. Оператор видит одно и то же
     сообщение и не понимает, чинить proxy или сертификат.

  Resolution:
  + `ui/src/infrastructure/audio/strudelPatches.ts` — единственный
    файл, держит ТРИ pure-helper'а: `wrapStrudelLogger`,
    `applyVoicingAliases(tonal)`, `applyBankAliasFallback(webaudio,
    fallbacks?)`. Idempotent, без side-effect на import.
  + `ui/src/infrastructure/audio/strudelPatches.test.ts` — 13 unit
    тестов против pure-shape модулей (мокаем `voicingRegistry`/
    `soundMap` как plain objects). Никакого реального `@strudel/*`
    в test loop.
  + `ui/src/main.tsx` — `wrapStrudelLogger()` в самом верху,
    ДО первого `import('@strudel/...')`. Pattern-detection: 1-й arg
    начинается с `%c[`, 2-й arg — CSS string с `border-radius|…white|background-color`.
    При совпадении — strip `%c`, reroute через `console.error(msg,
    ...rest)`.
  + `ui/src/infrastructure/audio/LiveAudioEngine.ts:177-185` —
    `applyVoicingAliases(modules.tonal)` сразу после `evalScope(core,
    mini, tonal)` и перед первым `webaudioRepl`. Тонкие моменты:
    `voicingAlias()` регистрации (`@strudel/tonal/voicings.mjs:225-243`)
    идут при ИМПОРТЕ модуля → наши alias'ы должны идти ПОСЛЕ них.
    Это условие выполняется только когда мы зовём patch ПОСЛЕ
    `loadModules()`, не раньше.
  + `ui/src/infrastructure/audio/SampleLoader.ts:42,78-91,99-104` —
    импорт `applyBankAliasFallback` + `DEFAULT_BANK_FALLBACKS`,
    новый локальный `applyBankFallbacksFromModuleShape()` →
    `registerBank()` зовёт его после `addBareAliases()`. Default
    fallbacks: `drums→drums_bd, drum→drums_bd, piano→piano_a4,
    synth→synth_bass-c2`. Только ADD missing + только когда
    fallback key уже есть в map (deferred — сэмплы могут грузиться
    позже).
  + `ui/src/infrastructure/llm/LiveLLMClient.ts:171-212` — новый
    `classifyLLMTransportError(err, apiUrl)`. Browser fetch бросает
    одно `Failed to fetch` для разных рут-причин; helper обнаруживает
    pattern (regex `Failed to fetch|NetworkError|fetch failed|load failed`),
    инспектирует `window.location.origin` vs `apiUrl`, добавляет
    `(CORS: добавить …; mixed-content: …)` суффикс к сообщению.
    Оператор может сразу сказать «proxy не allowlist'нул origin»
    vs «у меня DNS лежит».
antithesis: |
  (1) «Submit PR в upstream Strudel» — текущая кодовая база на
    `@strudel/core@1.2.6` + `@strudel/tonal@1.2.6` от 2025;
    апстрим может уже иметь фикс, но даже если да — минор-апдейт
    Strudel в wavecode отдельный риск (touch sensitivity к
    scheduler API) и не помогает с нашими конкретными use-cases
    (важно, чтобы `min7`/`maj7` разрешались в wavecode-style
    ii-V-I). Inline-patch дешевле и обратимо.

  (2) «Patch-package на logger.mjs» — даёт persistent patch через
    postinstall, но добавляет зависимость от patch-package в lockfile
    + пост-инсталл хук. Boot-time monkey-patch через
    `console.log = wrapped` не трогает ничего в node_modules, не
    ломается на `npm ci`, и обратим удалением одного файла.
    Минус: HMR может заэпизодически зашить дважды (защищено
    `logWrapped` флагом).

  (3) «Регистрировать bank-fallback в App.tsx через await import
    strudel/webaudio» — добавляет ещё одну точку импорта Strudel в
    boot-path; уже сейчас Strudel модули грузятся лениво в
    LiveAudioEngine. Делать это в `SampleLoader.registerBank()`
    означает callsite порядок: samples → bare-aliases → bank-fallback
    (one bank at a time), что естественно.

  (4) «Сделать `s("drums")` synthetic — а не alias на банк» —
    superdough ожидает ЛЮБОЙ lookup-result имеет `onTrigger(t, …)`
    в `data`. Synthetic drum воспроизводился бы, но имел бы другую
    velocity-кривую чем 808 → score авторы удивлялись бы что их
    `s("drums:bd")` звучит иначе чем `s("drums")`. Alias на
    конкретный sound (`drums_bd`) даёт предсказуемый результат.

  (5) «Retry при `Failed to fetch`» — соблазнительно, но КОРЕНЬ
    проблемы сервер-side (proxy CORS allowlist). Retry замаскирует
    реальную причину и будет спамить LLM-proxy. Лучше честное
    сообщение с подсказкой куда смотреть. Если бы был прогресс-бар
    retry — отдельный task; в данном пакете не делаем.

  (6) «Удалить `%c` из logger.mjs через patch-package вместо
    monkey-patch» — patch-package требует regeneration патча при
    каждом lockfile-bump; monkey-patch `console.log` живёт в
    нашем коде и переживает любые обновления `@strudel/core`.
    Кроме того, в DEV-режиме DevTools-console всё равно покажет
    console.error с красной иконкой что достаточно для UX.
synthesis: |
  Boot-time monkey-patch + post-load mutations. Чистый inline код,
  ноль new deps, ноль изменений в node_modules, ноль fetch-retry.

  Шаги фикса:
  1. `ui/src/infrastructure/audio/strudelPatches.ts` — создать
     pure helpers `wrapStrudelLogger`, `applyVoicingAliases`,
     `applyBankAliasFallback` + `DEFAULT_BANK_FALLBACKS`.
     Каждый helper объяснён комментарием С корнем бага С ссылкой
     на конкретную строку в `@strudel/...` (Strudel 1.3 — bundled в
     `ui/node_modules`).
  2. `ui/src/main.tsx` — `wrapStrudelLogger()` ДО первого import'а
     любого Strudel-модуля, после `solid-js/web`. Sync, idempotent.
  3. `ui/src/infrastructure/audio/LiveAudioEngine.ts` — после
     `evalScope(core, mini, tonal)` (строки 173-175) и перед
     `webaudioRepl({…})` (строка 199), вызвать
     `applyVoicingAliases(modules.tonal)`. Контрактное место,
     гарантирует что patch идёт после import-side
     `voicingAlias()`-регистраций из `voicings.mjs:225-243` и до
     первой пользовательской `voicing()`-цепочки.
  4. `ui/src/infrastructure/audio/SampleLoader.ts` — после
     `samples(manifestUrl)` и `addBareAliases()` (внутри
     `registerBank` try-блока, после sample manifest резолвится),
     звать `applyBankAliasFallback({ soundMap },
     DEFAULT_BANK_FALLBACKS)`. Логировать имена добавленных
     aliases для дебага.
  5. `ui/src/infrastructure/llm/LiveLLMClient.ts` — добавить
     helper `classifyLLMTransportError(err, apiUrl)`; передавать
     его через `catch:` в `Effect.tryPromise({ try: () =>
     fetch(…), catch: (err) => classifyLLMTransportError(err,
     deps.apiUrl) })`. Helper классифицирует regex'ом и
     добавляет context hints через `window.location`.
  6. `ui/src/infrastructure/audio/strudelPatches.test.ts` — 13 unit
     тестов (mute console; проверить routing, idempotency, alias
     injection edge-cases). Мокаем `voicingRegistry` И
     `soundMap` как plain object'ы — никакого real `@strudel/*`
     в test loop не происходит (быстрая обратная связь).

  Boot порядок теперь:
    (a) `wrapStrudelLogger()` в `main.tsx` до любого импорта App.
    (b) Solid render → App onMount → `loadAllSamples()` (parallel).
    (c) На user action (eval / preset click) → AudioEngine.eval →
        ensureRepl → loadModules → `evalScope` → `applyVoicingAliases`.
    (d) Каждый `samples()` резолв в SampleLoader →
        `addBareAliases()` → `applyBankAliasFallback()`.
substrate: |
  + `ui/src/infrastructure/audio/strudelPatches.ts` (новый, 209 строк)
  + `ui/src/infrastructure/audio/strudelPatches.test.ts` (новый, 13 tests)
  ~ `ui/src/main.tsx` (+4 строки: import + `wrapStrudelLogger()`)
  ~ `ui/src/infrastructure/audio/LiveAudioEngine.ts` (+8 строк: import +
    вызов `applyVoicingAliases` + диагностический лог)
  ~ `ui/src/infrastructure/audio/SampleLoader.ts` (+5 строк: новый import,
    helper, вызов в registerBank)
  ~ `ui/src/infrastructure/llm/LiveLLMClient.ts` (+42 строки:
    `classifyLLMTransportError` helper + connection в catch)
status: applied
axiom: A2 (Library-binding reciprocity: third-party code expects a
  contract we violate; reciprocate by adapting to the contract in our
  side, not by patching node_modules)
epistemics:
  - statement: "@strudel/core/logger.mjs:21 вызывает
      console.log('%c${message}', 'background-color: black;color:white;
      border-radius:15px')."
    marker: fact
    evidence: "Содержимое ui/node_modules/@strudel/core/logger.mjs:21;
      copy-paste дословный (Oct 2026). Один .mjs файл, 35 строк total."
  - statement: "@strudel/tonal/voicings.mjs:144 содержит
      `const voicings = dictionary[symbol].map(...)` и throws
      TypeError если symbol не ключ dictionary."
    marker: fact
    evidence: "ui/node_modules/@strudel/tonal/voicings.mjs:139-146 —
      function renderVoicing({…}). Symbol — second-токен из
      tokenizeChord(chord) regex: `^([A-G][b#]*)([^/]*)[/]?([A-G][b#]*)?$`.
      Для input 'Cmaj7' tokenize → ['C', 'maj7']. Lookup dictionary['maj7']
      → undefined → throw → caught в voicings.mjs:210 logger line."
  - statement: "ireal.mjs dictionary keys = '7', 'm7', '^7', 'm9', etc. —
      нет 'maj7', 'min7'."
    marker: fact
    evidence: "ui/node_modules/@strudel/tonal/ireal.mjs:8-100 (simple)
      и 187-280 (complex) — ни одного ключа `maj7` / `min7` / `major*`.
      voicing.mjs:227-243 делает auto-alias `^`→`M`, `-`→`m`, `+`→`aug`,
      но regex включения требует `includes('^')` / `includes('-')` etc.,
      что не ловит длинные формы."
  - statement: "superdough.mjs:572 throws `Error(\`sound ${s} not
      found! Is it loaded?\`)` когда getSound(s) undefined."
    marker: fact
    evidence: "ui/node_modules/superdough/superdough.mjs:550-573:
      `} else if (getSound(s)) {…} else {throw new Error(...)}`. Сама
      errorLogger обёртка в @strudel/core/repl.mjs:309 добавляет
      префикс '[getTrigger]' при errorLogger(err, 'getTrigger')."
  - statement: "SampleLoader.addBareAliases() добавляет `bd` → `drums_bd`,
      `sd` → `drums_sd`, etc. но НЕ `drums` (bank name)."
    marker: fact
    evidence: "ui/src/infrastructure/audio/SampleLoader.ts:59-76 — loop
      добавляет alias только на суффикс ПОСЛЕ первого `_`. Для ключа
      `drums_bd` суффикс = `bd`, для `drums_tom-l` = `tom-l`. Сам bank
      `drums` (без `_sound`) никогда не появляется как alias."
  - statement: "Chromium fetch() throws TypeError 'Failed to fetch'
      для CORS preflight failure / mixed-content / network error —
      неразличимо по err.message."
    marker: fact
    evidence: "WHATWG Fetch §3.2.4 (CORS preflight fetch) — при blocked
      preflight promise rejects с TypeError без additional properties;
      MDN 'fetch()' docs и chromium source net/url_request.cc:403-422
      net::ERR_FAILED / ERR_NETWORK_CHANGED все мапятся в одинаковый
      'Failed to fetch'."
  - statement: "LiveLLMClient.ts перед фиксом теряет err.cause при
      обёртке в Error(\`LLM HTTP request failed: ${msg}\`)"
    marker: fact
    evidence: "ui/src/infrastructure/llm/LiveLLMClient.ts:67 (pre-fix)
      — `catch: (err) => new Error(\`LLM HTTP request failed:
      ${err instanceof Error ? err.message : String(err)}\`)`. err.cause
      (стандартизован в ES2022, поддерживается в Chromium ≥93) не
      читается; classify-логика отсутствует."
