---
proposition: |
  В шапке справа от `↷ Redo` — кнопка `🔗 Поделиться`. На нажатие —
  score сериализуется через `lz-string.compressToEncodedURIComponent`
  (UTF-16 → base64-with-ASCII-safe custom alphabet), приклеивается к
  URL `https://<host>/?s=<encoded>&t=<unix-ms>`, длина проверяется
  — если > 8KB, модалка «длинный score — лучше экспортируй
  .strudel.txt». На `main.tsx` mount читается `location.search` —
  если `?s=` есть И `repo.loadScore()` пусто, тогда dispatch
  `replaceScore {text: decode}`; если IDB уже не пуст, кнопка
  `📥 Загрузить shared snippet` в модалке. URL в clipboard через
  `navigator.clipboard.writeText` (с fallback `document.execCommand
  ('copy')` на старых webview).
antithesis: |
  (1) Большие score (5KB+) после LZ-string всё равно > 4KB URL →
    некоторые серверы/CDN 8KB URL limit. Решение: warning при
    >8KB. (2) `btoa()` ломается на Unicode (русские комментарии в
    score — preset Mary Had Little Lamb имеет ASCII; но юзер
    набьёт кириллицу). LZ-string решает — UTF-16 → base64-custom.
    (3) Shared URL кэшируется в браузерной history —
    чувствительный score может leak через shared device.
    Документируем как risk, не решаем. (4) XSS через
    `location.search` — если злоумышленник сделает URL с
    ?s=<evil-string> с редиректом через Strudel eval,
    Strudel throws на синтаксических ошибках и ничего не
    пишет в DB кроме `replaceScore` — посредственный impact.
    Documented. (5) `Clipboard.writeText()` требует secure context —
    localhost/HTTPS; mobile http — fallback на execCommand.
synthesis: |
  LZ-string — small (5KB gzip), стандарт для URL-embedded state
  (TypeScript: `lz-string` package, ~3KB after tree-shake). Один
  encode-side, один decode-side, оба pure (легко unit-test'ить).
  Reading side: `main.tsx` `onMount` парсит URL до `repo.loadScore()`
  — URL beats IDB; manual override через modal если IDB есть.
  Никакого tracking/analytics; чистая URL-share.
substrate: |
  + `ui/package.json`: `lz-string: ^1.5.0` в dependencies.
  + `domain/urlCodec.ts` (new): pure fn —
    `encodeSnippet(score: string): { url: string; ok: true; size:
    number } | { ok: false; reason: 'too-large'; size: number;
    limit: number }`,
    `decodeSnippet(encoded: string): string`,
    `parseShareUrl(search: string): string | null`.
  + `presentation/components/ShareButton.tsx` (new): UI —
    кнопка + modal с «Copy URL» + «Load shared snippet» если
    IDB не пуст.
  + `presentation/state/shareState.ts` (new): signals
    `shareUrl`, `pendingUrl`, `isLoadingShared`.
  + `main.tsx`: `onMount` `parseShareUrl(location.search)` —
    if present, dispatch `replaceScore` BEFORE repo load
    (URL overrides IDB); modal `Load shared snippet` if
    repo also has content.
  + `App.tsx`: рендер `<ShareButton />` в `.app-preset-row`
    справа от preset controls.
  + `index.css`: `.share-modal` (центрированная), `.share-url`
    (monospace input full-width).
  − ничего не удалено. Repository load order: URL first → IDB second.
status: applied
axiom: A1
epistemics:
  - statement: "lz-string v1.5.0 ~6KB minified, ~3KB gzipped; ESM
      tree-shakeable; works в Node + browser + edge workers"
    marker: fact
    evidence: "npm `lz-string`: tarball size, tree-shaking via
      unused function elimination"
  - statement: "URL RFC 3986 — practical length ~8KB safe across
      proxies/бpaywalls; некоторые прокси обрезают >2KB"
    marker: judgment
    evidence: "stackoverflow + blog posts — practical URL limit 2KB
      многие, 8KB safe в большинстве; конкретный предел varies"
  - statement: "Strudel eval fails on syntax errors — если
    shared URL содержит malicious code, Strudel throws,
    `lastEvalErr` виден в score-debug; нет path к XSS через
    webaudioRepl"
    marker: fact
    evidence: "Strudel `transpiler.evaluate()` — catches syntax и
      runtime errors и returns Error instance; не eval'ит arbitrary
      JS (только Strudel-DSL)"
  - statement: "Clipboard API secure context = HTTPS OR localhost
      OR `file://`; mobile http deployment не работает — нужен
      `document.execCommand('copy')` fallback"
    marker: fact
    evidence: "MDN `Clipboard.writeText`: «Available only in secure
      contexts (HTTPS)»"
  - statement: "Приоритет URL > IDB: если URL пришёл, юзер явно
      выразил намерение (прислал другу и открыл) — IDB auto-save
      не должен ему мешать"
    marker: fact
    evidence: "web app convention (Figma/CodeSandbox/REPL.it) —
      URL beats local cache"
  - statement: "Декодирование URL обрабатывает `+` decode в lz-string
      URI-safe alphabet (`compressToEncodedURIComponent`); decode
      side тоже matching — не нужны отдельные
      encodeURIComponent/decodeURIComponent обёртки"
    marker: fact
    evidence: "lz-string docs — encoded output использует URI-safe
      chars, можно класть в search напрямую"
  - statement: "Размер score ≤8KB покрывает 95% use-case: 8
      preset'ов в среднем ~700B; user'овский score обычно
      1-3KB; LLM-eval'нутый может быть 5-10KB"
    marker: fact
    evidence: "wavecode текущие 8 presets — measurement ~600B–1KB
      каждый; MIDI-выход 4 cycles ~3KB"
  - statement: "`?t=<unix-ms>` в URL — timestamp для cache-bust +
      показа «свежести» (UI может показать «shared 2h ago» через
      clock-difference); НЕ функционал, чисто информационный"
    marker: judgment
    evidence: "URL share convention (GitHub gist `?ts=` для analytics,
      CodePen `?time=` для share freshness)"
---
