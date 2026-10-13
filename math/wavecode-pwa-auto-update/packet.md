---
proposition: |
  После deploy пользователи продолжали работать на старом
  JS-бандле, пока не сделают hard reload (Ctrl+Shift+R) вручную.
  Симптом — 2026-10-13: LLM-фикс с правильным `sk-litellm-` префиксом
  был задеплоен, но в браузере юзера всё ещё крутился старый chunk
  с неверным ключом → 401 "Malformed API Key". После `bin/deploy.sh`
  Service Worker обновлялся (`skipWaiting: true` + `clientsClaim: true`
  ставились vite-plugin-pwa автоматически, см. `sw.js` текущего
  деплоя), но **страница не перезагружалась** — потому что
  inject'нутый `dist/registerSW.js` был наивной заглушкой:

    if('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
      })
    }

  Здесь нет `Workbox` import, нет `addEventListener('activated')`,
  нет `location.reload()`. Регистрация есть, обновления есть, но
  auto-reload отсутствует.

  Решение: `useRegisterSW` из `virtual:pwa-register/solid` в
  `ui/src/main.tsx` — обёртка вокруг Workbox с auto-reload
  на `activated` event. Toasts через `consoleStore.pushToast` для
  `onNeedRefresh` / `onOfflineReady`.
antithesis: |
  (1) «Можно просто добавить `workbox.skipWaiting: true,
  clientsClaim: true` явно — этого хватит». Возражение: эти
  флаги уже ставились `vite-plugin-pwa` автоматически при
  `registerType === "autoUpdate"` (см. node_modules
  `vite-plugin-pwa/dist/index.js:1003-1006`). SW обновлялся,
  но **страница не перезагружалась** — нет кода который бы
  это делал. Без `useRegisterSW`/`Workbox` в `registerSW.js`
  auto-reload невозможен.
  (2) «Hard reload хватает, не нужно auto». Возражение:
  юзер не знает когда был deploy. Юзер не помнит про hard reload.
  Юзер звонит и спрашивает "почему опять ошибка?". Auto-reload —
  единственный способ гарантировать что юзер видит свежее.
  (3) «Use `injectRegister: 'inline'` и напиши свой auto-reload
  скрипт». Возражение: Workbox уже написан, проверен
  сообществом, edge cases (Safari quirks, dev-mode handoff)
  учтены. Свой велосипед — заведомо хуже.
  (4) «Show a toast "Update available — click to reload"».
  Возражение: `registerType: 'autoUpdate'` означает
  бесшовное обновление без UI. Toasting создаёт
  modal dialog UX, который противоречит выбранной модели.
  Можно добавить toast *перед* reload (мой вариант) —
  короткий info "Новая версия загружается…" — но reload
  не должен требовать click.
synthesis: |
  Шесть точечных правок:

  1. **`ui/src/main.tsx`** (modify, +30 line):
     Импорт `useRegisterSW` из `virtual:pwa-register/solid`.
     Вызов с тремя callbacks:
     - `onNeedRefresh` → `consoleStore.pushToast({ severity: 'info', title: 'Новая версия загружается…', ttlMs: 2000 })`.
     - `onOfflineReady` → аналогичный toast (готовность к офлайн-работе).
     - `onRegisterError` → `console.error('[pwa] ...', err)`.
     Сам `useRegisterSW` под капотом вызывает Workbox, который
     на `activated` event с `isUpdate` сам делает `location.reload()` —
     ничего руками не пишем.

  2. **`ui/tsconfig.json`** (modify, +1 line):
     `types: ["vite/client", "node", "vite-plugin-pwa/client"]`
     — без этого `virtual:pwa-register/solid` не резолвится
     в strict TS.

  3. **`vite.config.ts`** — **не трогаем**. `registerType: 'autoUpdate'`
     уже правильный. `injectRegister: 'auto'` (default) тоже
     правильный: vite-plugin-pwa при наличии `useRegisterSW`
     в коде сам генерит правильный `registerSW.js` с Workbox
     bootstrap. Без `useRegisterSW` (как раньше) — генерит
     наивную заглушку. То есть фикс `main.tsx` достаточно
     для всей PWA-цепочки.

  Verification:
  - `npm run typecheck` — clean.
  - Headless Chromium (Playwright): `reg.update()` → Workbox
    увидел новый SW → `activated` event → `location.reload()` →
    новая страница загружена → console: `[pwa] init v2 — useRegisterSW active @ …/assets/index-DOFjlvPH.js:…`.
  - Manual: `chrome://serviceworker-internals/` → видна
    активация нового SW без `waiting` статуса.

  Что НЕ делаем:
  - Не ставим `injectRegister: 'inline'` явно (default 'auto' OK).
  - Не вызываем `location.reload()` в `onNeedRefresh` (Workbox
    сам делает это на `activated` после `skipWaiting`).
  - Не показываем модалку "Update available" (`autoUpdate` UX
    — безшовный).
  - Не меняем `runtimeCaching` rules (LLM-responses и
    strudel-vendor остаются как есть).
status: applied
witness:
  applied_at: 2026-10-13
  commit: 982d29491cae07b6ea1c9d4f9d39c7c0fa90c2c1
  supersedes: null
  notes: |
    Implementation in two commits:
      982d294 fix(pwa): use useRegisterSW with auto-reload …
      1afcc3a test(pwa): marker log to verify auto-reload on next deploy

    End-to-end verification (Playwright headless Chromium, 2026-10-13):
      1. Opened https://wavecode.kosov.online/
      2. useRegisterSW auto-registered Workbox SW (no manual registerSW call)
      3. Deployed new bundle via `bin/deploy.sh` (commit 1afcc3a)
      4. Called `reg.update()` in browser to force check
      5. Workbox detected /sw.js change, installed new SW, skipWaiting
         fired, activated event fired, location.reload() called
      6. New bundle (index-DOFjlvPH.js, different hash) loaded
      7. Console: `[pwa] init v2 — useRegisterSW active`

    typecheck: clean
    vitest: 628/628 (no PWA tests, none added — Workbox is
      out-of-process, can't unit-test the SW lifecycle from vitest)
---