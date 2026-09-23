---
proposition: |
  wavecode деплоится как статический SPA: `pnpm build` → ui/dist/ → любой
  static-host (Vercel, Cloudflare Pages, GitHub Pages, nginx). Без Nix-выходов,
  без контейнеров, без серверного процесса.
antithesis: |
  SSR (Next.js, Remix, SolidStart) даёт быстрый initial render и SEO.
  Backend с WS-сервером даёт приватное state и real-time multi-user.
  NixOS-контейнер даёт воспроизводимый деплой. Никакая из этих фич
  не нужна для live-coding в браузере, но отсутствие SSR означает
  пустой экран до загрузки JS.
synthesis: |
  Live-coding — interactive tool для одного пользователя, SEO нерелевантен.
  Initial render пустой экран 200-500ms приемлем (loading-state в
  index.html). State в IndexedDB → приватный, persistent на стороне
  клиента. Multi-user — out of scope (single-user use case). Vercel /
  Cloudflare Pages дают бесплатный хостинг с автоматическим HTTPS.
  Деплой = `git push` (если настроен CI/CD).
substrate: none
status: draft
axiom: A3
epistemics:
  - statement: "Live-coding SPA — interactive tool, SEO нерелевантен"
    marker: judgment
  - statement: "Vite build даёт ~400KB initial bundle (Solid + Strudel + Effect + CM6)"
    marker: hypothesis
    evidence: "примерная оценка, не измерено"
  - statement: "Cloudflare Pages бесплатен для статики с автоматическим HTTPS"
    marker: fact
---

## Intent

`pnpm build` → `ui/dist/` (статические файлы). Деплой копированием на
любой static-host. Никаких systemd-юнитов, никаких Docker-образов,
никаких Nix-флейков outputs.

## What this is NOT

- Не SSR (Next.js/Remix/SolidStart). Single-page-app, всё рендерится на клиенте.
- Не Backend-as-a-Service (Firebase/Supabase). State в IndexedDB, LLM через прокси.
- Не NixOS-контейнер. Деплоится как обычная статика.
- Не Docker-образ. Нет runtime-зависимостей кроме браузера.

## Worked example

```sh
# Build
cd ~/Projects/wavecode/ui
pnpm build
# → ui/dist/ (HTML + JS chunks + CSS)

# Deploy на Cloudflare Pages
pnpm dlx wrangler pages deploy dist --project-name=wavecode

# Или просто:
scp -r dist/* user@host:/var/www/wavecode/
```

## Notes

- **Bundle structure** (см. vite.config.ts manualChunks):
  - `strudel` — Strudel runtime (lazy-loaded, не нужен на initial render)
  - `audio` — Tone.js (lazy-loaded)
  - `codemirror` — editor (lazy-loaded)
  - `effect` — Effect runtime
  - `ai` — LLM client (lazy-loaded)
  - initial chunk: ~50KB (Solid + domain + application skeleton)
- **Environment variables** (Vite инжектит в build):
  - `VITE_LLM_PROXY_URL=https://llm.kosov.online/v1`
  - `VITE_LLM_PROXY_KEY=sk-litellm-...`
  - Эти попадают в client bundle; per-app ключи revocable, риск минимален.
- **HTTPS**: Cloudflare/Vercel дают автоматически. Self-hosted — Let's Encrypt / Caddy.
- **CI/CD**: optional. Push в git → auto-deploy через Vercel/Cloudflare Pages.
- **Backup**: state в IndexedDB; пользователь может экспортировать score через
  UI (TODO).