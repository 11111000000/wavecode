#!/usr/bin/env bash
# bin/deploy.sh — собрать wavecode и развернуть на локальный Caddy.
#
# 1. Проверяет .env.local (с per-app LLM-ключом).
# 2. pnpm install (если node_modules отсутствует).
# 3. pnpm build → ui/dist/
# 4. sudo cp -r ui/dist/* → /var/lib/wavecode/dist/ (caddy:caddy).
# 5. Создаёт SPA-fallback <route>/index.html для BrowserRouter
#    маршрутов (Caddy try_files {path}/index.html — root index.html
#    fallback требует правки Nix-конфига; workaround — копия в каждую
#    директорию). Список маршрутов — литерал, обновляется вручную.
#
# После deploy:
#   • https://wavecode.kosov.online/         — публичный URL (Caddy + LE cert)
#   • https://wavecode.tail347ae6.ts.net/   — tailnet URL (Tailscale mesh)
#
# Rollback:
#   • cd /var/lib/wavecode && mv dist.prev.<ts> dist
#   • (или nix-конфиг: git revert <commit> && bin/rebuild.sh switch)
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

echo "==> atomic deploy $UI_DIR/dist/ → $DEPLOY_DIR/"
# Атомарная замена: mv существующий → backup, mkdir новый, cp -r.
# ВАЖНО: index.html ссылается на hashed assets/index-*.{js,css} —
# они должны прийти из того же build, иначе 404 в браузере.
TS=$(date +%Y%m%d-%H%M%S)
if [ -d "$DEPLOY_DIR" ] && [ -f "$DEPLOY_DIR/index.html" ]; then
  "$SUDO" -n mv "$DEPLOY_DIR" "$DEPLOY_DIR.prev.$TS"
  echo "    backup: $DEPLOY_DIR.prev.$TS"
fi
"$SUDO" -n mkdir -p "$DEPLOY_DIR"
"$SUDO" -n cp -r "$UI_DIR/dist/." "$DEPLOY_DIR/"

# 5. SPA workaround: copy index.html into every SPA-route directory.
# Caddy `try_files {path}/index.html` отдаёт этот файл для `/<route>`,
# fallback на root index.html. Лучшее долгосрочное решение — добавить в
# Nix-конфиг `try_files {path} {path}.html {path}/index.html /index.html`
# (требует nixos-rebuild switch + rollback-процедура).
for route in "${SPA_ROUTES[@]}"; do
  "$SUDO" -n mkdir -p "$DEPLOY_DIR/$route"
  "$SUDO" -n cp "$DEPLOY_DIR/index.html" "$DEPLOY_DIR/$route/index.html"
done
"$SUDO" -n cp "$DEPLOY_DIR/index.html" "$DEPLOY_DIR/404.html"
"$SUDO" -n chown -R caddy:caddy "$DEPLOY_DIR"

# 6. Sanity check: убедиться, что index.html ссылается на файлы, которые
# реально лежат в assets/. Защита от частичных deploy'ов, когда кто-то
# копирует только assets/ или только index.html.
ACTIVE_JS=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$DEPLOY_DIR/index.html" | sort -u || true)
ACTIVE_CSS=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.css' "$DEPLOY_DIR/index.html" | sort -u || true)
for ref in $ACTIVE_JS $ACTIVE_CSS; do
  rel=${ref#assets/}
  if [ ! -f "$DEPLOY_DIR/$ref" ]; then
    echo "ERROR: index.html references $ref but file is missing!"
    echo "  Build + cp -r не были атомарны. Откатываюсь на $DEPLOY_DIR.prev.$TS"
    "$SUDO" -n rm -rf "$DEPLOY_DIR"
    "$SUDO" -n mv "$DEPLOY_DIR.prev.$TS" "$DEPLOY_DIR"
    exit 1
  fi
done
echo "    ✓ $(echo "$ACTIVE_JS" | wc -l) JS + $(echo "$ACTIVE_CSS" | wc -l) CSS references resolved"

echo
echo "✓ Deploy complete: $DEPLOY_DIR/"
echo
echo "Verify:"
echo "    curl -I https://wavecode.kosov.online/         # landing"
echo "    curl -I https://wavecode.kosov.online/app      # editor (BrowserRouter SPA path)"
echo "    open https://wavecode.kosov.online/"
echo
echo "Rollback: \`mv $DEPLOY_DIR.prev.<ts> $DEPLOY_DIR\`"
