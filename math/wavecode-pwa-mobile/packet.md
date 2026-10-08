---
proposition: |
  wavecode — installable PWA. `vite-plugin-pwa` включён в
  `vite.config.ts` с `registerType: 'autoUpdate'`, прекэш initial
  bundle (HTML, JS, CSS, fonts), runtime-кэш Strudel vendor-chunks
  (`@strudel/core`, `@strudel/webaudio`, etc.) и `llm.kosov.online`
  responses — через Workbox `precacheAndRoute`. `public/manifest.webmanifest`
  со ссылками на `icon-192.png`, `icon-512.png`, `apple-touch-icon-
  180.png`. В `ui/index.html` — 4 meta-тега: `apple-mobile-web-app-capable
  = "yes"`, `mobile-web-app-capable = "yes"`, `theme-color = "#0a0a0a"`
  (уже есть), `viewport-fit = "cover"` (safe area iPhone notch).
  На iPhone Safari «Add to Home Screen» даёт fullscreen application
  без Safari chrome и без history-back (то, чего хотят профи в metro).
antithesis: |
  (1) `vite-plugin-pwa` тянет Workbox ~30KB minified + complexity;
    Strudel vendor-chunks прекэшируются (~676KB precache) — первая
    install у юзера долгая. Решение: precache только critical path
    (HTML/JS entry, fonts), остальное `runtime caching` Strudel-
    chunks on-demand. (2) Service worker stale-while-revalidate —
    юзер hard-reload может не получить latest UI если SW застрял.
    Решение: `autoUpdate` + cache-bust query-string на каждую новую
    deployment (vite делает hash-bundles автоматически). (3) iOS
    Safari < 17 имеет баги в `apple-mobile-web-app-capable` с
    viewport-fit=cover — status bar overlap; hybrid: опциональный
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-
    translucent">`. (4) Push notifications НЕ нужны (мы не пушим
    UI), не добавляем — diminishing returns. (5) Service worker
    offline-mode score-read OK; но `repo.saveScore` IDB-write без
    аудио context не нужен, всё равно OK. Strudel init — единственный
    эффект, который ВСЁ ЕЩЁ блокирует UI; SW не влияет. (6)
    icon-192/512 — генерация PNG placeholders; без дизайнера берём
    простой SVG-style «wavecode» monogram. (7) SW регистрация через
    `vite-plugin-pwa` `registerType: 'autoUpdate'` автоматически.
synthesis: |
  `vite-plugin-pwa` + Workbox precache + manual `public/manifest.webmanifest`
  + 4 meta-теги + 3 PNG-иконки. Никакого custom service worker — Workbox
  defaults хватает. Иконки простые, `wavecode` mono-accent text
  generator на first commit (SVG, потом Sharp PNG). `viewport-fit=cover`
  на iOS Safari 14+ работает, на старых — `padding: env(safe-area-inset)`
  в `.app` селекторе.
substrate: |
  + `ui/package.json`: devDep `vite-plugin-pwa: ^0.20.x`,
    runtime `workbox-window: ^7.0.0` (если не transitive).
  + `vite.config.ts`: `import { VitePWA } from 'vite-plugin-pwa'`,
    plugin(plain config — registerType, manifest, workbox.globPatterns).
  + `ui/public/manifest.webmanifest` (new): `name`, `short_name`,
    `start_url: '/'`, `display: 'standalone'`, `theme_color`,
    `background_color`, `icons: [{ src: '/icon-192.png',
    sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png',
    sizes: '512x512' }]`.
  + `ui/public/icon-192.png` (new): 192×192 PNG, monogram «wc»
    в accent цвете #ff6b6b на #0a0a0a фоне.
  + `ui/public/icon-512.png` (new): same 512×512.
  + `ui/public/apple-touch-icon-180.png` (new): 180×180, same style.
  + `ui/index.html`: 3 новых `<meta>` тега (`apple-mobile-web-app-
    capable`, `mobile-web-app-capable`, `viewport-fit=cover`) и
    `<link rel="manifest" href="/manifest.webmanifest">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">`.
  + `ui/src/index.css`: `body { padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom); }` для iOS
    notched + landscape safe areas.
  − ничего не удалено. PWA-структура additive, не ломает
    существующий HTML/CSS.
  − **НЕ** push notifications, **НЕ** background sync,
    **НЕ** offline mode улучшения (Strudel + IDB already
    работают offline после загрузки).
status: draft
axiom: A1
epistemics:
  - statement: "vite-plugin-pwa совместимо с Vite 5 (project use
      vite ^5.4); registerType 'autoUpdate' vs 'prompt' —
      autoUpdate обновляет SW без показа UI промпта"
    marker: fact
    evidence: "vite-plugin-pwa docs — Vite 5 поддержка, registerType
      'autoUpdate' = silent update, prompt = manual confirm"
  - statement: "Workbox precache limit по manifest size — каждый
      добавляется в manifest.json; total precache ≈ initial bundle
      size ~150KB (без Strudel) — приемлемо"
    marker: fact
    evidence: "Workbox defaults — `maximumFileSizeToCacheInBytes =
      2MB` на файл, precache manifest limit не больше 50MB
      (compress)"
  - statement: "Apple-touch-icon-180 PNG требуется iOS чтобы
      отрисовать иконку при «Add to Home Screen»;
      SVG не рендерится в Apple touch icon"
    marker: fact
    evidence: "Apple WebKit docs `apple-touch-icon` — image/png
      обязательно; SVG работает в manifest но не в apple-touch"
  - statement: "iOS Safari ≥14 уважает `viewport-fit=cover` +
      `apple-mobile-web-app-capable=yes` — fullscreen PWA mode
      (без Safari chrome)"
    marker: fact
    evidence: "Safari 14 release notes — поддержка PWA-features
      совместима с W3C Web App Manifest"
  - statement: "Strudel vendor-chunks @strudel/*~676KB — НЕ в
      precache, runtime caching on first request (через Workbox
      `registerRoute(/\/assets\/.*/, new CacheFirst(...))`)"
    marker: judgment
    evidence: "vite-plugin-pwa docs — separate precache (own routes)
      от Workbox runtime routes; Lighthouse PWA score ≤100
      достаточно для installability"
  - statement: "manifest.webmanifest требует HTTPS в production
      (localhost = исключение для dev); dev preview OK"
    marker: fact
    evidence: "W3C Web App Manifest spec — браузеры требуют HTTPS
      для installability, localhost dev mode исключение"
  - statement: "PWA install через WebKit iOS требует explicit
      «Add to Home Screen» tap юзером — no automatic prompt"
    marker: fact
    evidence: "Apple WebKit docs — PWA install на iOS manual через
      Share → Add to Home Screen; no `beforeinstallprompt` event"
  - statement: "Service worker регистрация безопасна на Vite dev
      mode — vite-plugin-pwa отключает SW в dev (если не
      `devOptions.enabled = true`)"
    marker: fact
    evidence: "vite-plugin-pwa docs — dev-mode без SW по умолчанию"
  - statement: "Иконки wavecode monogram — design system зависит;
      минимальный = PNG placeholder с текстом «wc» в accent
      цвете #ff6b6b; designer pass когда-нибудь позже"
    marker: judgment
    evidence: "PWA icon best practice — should reflect brand; если
      нет дизайнера — простая monogram"
---
