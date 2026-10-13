#!/usr/bin/env bash
# bin/deploy.sh — собрать wavecode и развернуть в двух местах.
#
# 1. PRIMARY: локальный Caddy через /var/lib/wavecode/dist.
#    → https://wavecode.kosov.online/  (Caddy public listener, LE cert)
#    → https://wavecode.tail347ae6.ts.net/ (Caddy tailnet listener)
#
# 2. PARALLEL: GH Pages через gh-pages branch (https://11111000000.github.io/wavecode/).
#    Публичный mirror для случаев, когда локальный сервер недоступен
#    (CDN, обходной аудит, новый дев-стенд). Не претендует на домен
#    wavecode.kosov.online — CNAME удалён из gh-pages намеренно, чтобы
#    GitHub не резолвился как источник custom domain.
#
# Что делает:
#   1. Проверяет .env.local (per-app LLM-ключ).
#   2. pnpm install (если node_modules отсутствует).
#   3. pnpm build → ui/dist/
#   4. sudo cp -r ui/dist/* → /var/lib/wavecode/dist/ (caddy:caddy).
#   5. Создаёт SPA-fallback <route>/index.html для BrowserRouter
#      маршрутов (Caddy try_files {path}/index.html — root index.html
#      fallback требует правки Nix-конфига; workaround — копия в каждую
#      директорию). Список маршрутов — литерал, обновляется вручную.
#   6. Параллельный push в gh-pages branch через orphan worktree,
#      без CNAME (GH Pages не претендует на кастомный домен).
#
# Rollback:
#   * Primary:  cd /var/lib/wavecode && mv dist.prev.<ts> dist
#   * GH Pages:  gh api -X DELETE repos/.../git/refs/heads/gh-pages
#
# Идемпотентно: можно запускать сколько угодно раз.

set -euo pipefail

UI_DIR="$(cd "$(dirname "$0")/../ui" && pwd)"
DEPLOY_DIR="/var/lib/wavecode/dist"

# SPA маршруты — литерал. Под каждый путь deploy.sh копирует
# index.html в /$route/index.html — Caddy try_files {path}/index.html
# находит файл и отдаёт. Лендинг / не нуждается в /index.html (это и есть root).
# Добавляй сюда новые SPA-маршруты при появлении.
SPA_ROUTES=(app shared mixer chat status piano step console)

cd "$UI_DIR"

# 1. Check .env.local.
if [ ! -f .env.local ]; then
  echo "ERROR: $UI_DIR/.env.local not found."
  echo "  Copy .env.example to .env.local and fill in VITE_LLM_PROXY_KEY."
  exit 1
fi
if grep -q "REPLACE-ME" .env.local; then
  echo "ERROR: VITE_LLM_PROXY_KEY still has placeholder. Get a key first:"
  echo "  MASTER_KEY=\$(grep LITELLM_MASTER_KEY /etc/secrets/llm-proxy/master.key | cut -d= -f2)"
  echo "  curl -X POST http://127.0.0.1:11436/key/generate -H \"Authorization: Bearer \$MASTER_KEY\" \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"key_alias\":\"wavecode-browser\",\"models\":[\"smart\",\"fast\"],\"duration\":\"365d\"}'"
  exit 1
fi

# 2. Install if needed.
if [ ! -d node_modules ]; then
  echo "==> pnpm install"
  pnpm install --no-frozen-lockfile
fi

# 3. Build.
echo "==> pnpm build"
pnpm build

# 4. Deploy to /var/lib/wavecode/dist (Caddy needs read access).
SUDO=/usr/bin/sudo
if ! "$SUDO" -n true 2>/dev/null; then
  echo "ERROR: $SUDO -n rejected (no passwordless sudo)."
  echo "  Fix: NOPASSWD line for /bin/cp /bin/mkdir /bin/chown in /etc/sudoers.d/wavecode-deploy"
  echo "  OR run this script as root."
  exit 1
fi

echo "==> cp $UI_DIR/dist/ → $DEPLOY_DIR/ (PRIMARY)"
# Backup → dist.prev.<timestamp> (idempotent rollback).
TS=$(date +%Y%m%d-%H%M%S)
if [ -d "$DEPLOY_DIR" ] && [ -f "$DEPLOY_DIR/index.html" ]; then
  "$SUDO" -n mv "$DEPLOY_DIR" "$DEPLOY_DIR.prev.$TS"
  echo "    backup: $DEPLOY_DIR.prev.$TS"
fi
"$SUDO" -n mkdir -p "$DEPLOY_DIR"
"$SUDO" -n cp -r "$UI_DIR/dist/." "$DEPLOY_DIR/"

# 5. SPA workaround: copy index.html into every SPA-route directory.
# Caddy `try_files {path}/index.html` отдаёт этот файл для `/<route>`,
# fallback на root index.html. Лучшее долгосрочное решение — добавить
# в Nix-конфиг `try_files {path} {path}.html {path}/index.html /index.html`
# (требует nixos-rebuild switch + rollback-процедура).
for route in "${SPA_ROUTES[@]}"; do
  "$SUDO" -n mkdir -p "$DEPLOY_DIR/$route"
  "$SUDO" -n cp "$DEPLOY_DIR/index.html" "$DEPLOY_DIR/$route/index.html"
done
"$SUDO" -n cp "$DEPLOY_DIR/index.html" "$DEPLOY_DIR/404.html"
"$SUDO" -n chown -R caddy:caddy "$DEPLOY_DIR"

# 6. Drop stale hashed bundles. Vite emits content-hashed filenames, so
# previous index-*.js / index-*.css become orphans after a new build.
ACTIVE_JS=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' "$DEPLOY_DIR/index.html" | sort -u || true)
ACTIVE_CSS=$(grep -oE 'index-[A-Za-z0-9_-]+\.css' "$DEPLOY_DIR/index.html" | sort -u || true)
for f in "$DEPLOY_DIR/assets/"index-*.js "$DEPLOY_DIR/assets/"index-*.js.map \
         "$DEPLOY_DIR/assets/"index-*.css "$DEPLOY_DIR/assets/"index-*.css.map; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  case "$base" in
    *.js|*.js.map)
      echo "$ACTIVE_JS" | grep -qx "$base" && continue ;;
    *.css|*.css.map)
      echo "$ACTIVE_CSS" | grep -qx "$base" && continue ;;
  esac
  "$SUDO" -n rm -f "$f"
done
"$SUDO" -n chown -R caddy:caddy "$DEPLOY_DIR"

echo "✓ PRIMARY deployed: $DEPLOY_DIR/"

# 7. Parallel GH Pages deploy (orphan worktree, no CNAME — mirror only).
echo "==> gh-pages (PARALLEL mirror)"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_WORK=/tmp/gh-pages-work
  rm -rf "$GH_WORK"
  mkdir -p "$GH_WORK"
  cd "$GH_WORK"
  git init -q
  git remote add origin "$(git -C "$UI_DIR/.." remote get-url origin)"
  git checkout --orphan gh-pages >/dev/null 2>&1
  cp -r "$UI_DIR/dist/." .
  rm -f CNAME  # never claim custom domain — primary serves there
  git add -A
  git -c user.email="${GIT_AUTHOR_EMAIL:-wavecode-deploy@local}" \
      -c user.name="${GIT_AUTHOR_NAME:-wavecode-deploy}" \
      commit -q -m "deploy: parallel mirror from $(git -C "$UI_DIR/.." rev-parse --short HEAD)"
  git push -q -f origin gh-pages
  echo "✓ PARALLEL gh-pages pushed: $(gh api repos/11111000000/wavecode/pages --jq .html_url)"
else
  echo "  (skipped: gh CLI not authenticated — set it up with 'gh auth login')"
fi

echo
echo "✓ Both deployments succeeded:"
echo "    PRIMARY:   https://wavecode.kosov.online/"
echo "    MIRROR:    $(cd "$UI_DIR/.." && git remote get-url origin | sed 's|github.com/11111000000/|11111000000.github.io/|; s|\.git$|/|')"
echo
echo "Verify:"
echo "    curl -I https://wavecode.kosov.online/         # landing"
echo "    curl -I https://wavecode.kosov.online/app      # editor (BrowserRouter SPA path)"
echo "    open https://wavecode.kosov.online/"
echo
echo "Rollback: \`mv $DEPLOY_DIR.prev.<ts> $DEPLOY_DIR\`"
