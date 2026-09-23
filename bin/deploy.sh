#!/usr/bin/env bash
# bin/deploy.sh — собрать wavecode и развернуть в /var/lib/wavecode/dist/.
#
# Что делает:
#   1. Проверяет наличие .env.local (с per-app LLM-ключом).
#   2. pnpm install (если node_modules отсутствует).
#   3. pnpm build → ui/dist/
#   4. sudo cp -r ui/dist/* → /var/lib/wavecode/dist/ (caddy:caddy).
#
# После deploy:
#   • https://wavecode.kosov.online/  — публичный URL (Caddy public listener)
#   • https://wavecode.tail347ae6.ts.net/ — tailnet URL (Tailscale mesh)
#
# Rollback:
#   • cd ~/Projects/AngaraConfig && git revert <commit> && bin/rebuild.sh switch
#
# Идемпотентно: можно запускать сколько угодно раз.

set -euo pipefail

UI_DIR="$(cd "$(dirname "$0")/../ui" && pwd)"
DEPLOY_DIR="/var/lib/wavecode/dist"

cd "$UI_DIR"

# 1. Check .env.local.
if [ ! -f .env.local ]; then
  echo "ERROR: $UI_DIR/.env.local not found."
  echo "  Copy .env.example to .env.local and fill in VITE_LLM_PROXY_KEY."
  echo "  cp .env.example .env.local && \$EDITOR .env.local"
  exit 1
fi

# 2. Verify key is set.
if grep -q "REPLACE-ME" .env.local; then
  echo "ERROR: VITE_LLM_PROXY_KEY still has placeholder. Run:"
  echo "  MASTER_KEY=\$(grep LITELLM_MASTER_KEY /etc/secrets/llm-proxy/master.key | cut -d= -f2)"
  echo "  curl -X POST http://127.0.0.1:11436/key/generate -H \"Authorization: Bearer \$MASTER_KEY\" \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"key_alias\":\"wavecode-browser\",\"models\":[\"smart\",\"fast\"],\"duration\":\"365d\"}'"
  exit 1
fi

# 3. Install if needed.
if [ ! -d node_modules ]; then
  echo "==> pnpm install"
  pnpm install --no-frozen-lockfile
fi

# 4. Build.
echo "==> pnpm build"
pnpm build

# 5. Deploy to /var/lib/wavecode/dist (Caddy needs read access there).
echo "==> sudo cp -r $UI_DIR/dist/* → $DEPLOY_DIR/"
/home/az/.local/bin/sudo -n mkdir -p "$DEPLOY_DIR"
/home/az/.local/bin/sudo -n cp -r "$UI_DIR/dist/." "$DEPLOY_DIR/"
/home/az/.local/bin/sudo -n chown -R caddy:caddy "$DEPLOY_DIR"

echo
echo "✓ Build + deploy complete: $DEPLOY_DIR/"
echo
echo "Nix config already points there. Если меняли .env.local,"
echo "перезагрузите Caddy: systemctl reload caddy"
echo
echo "Verify:"
echo "  curl -I https://wavecode.kosov.online/"
echo "  curl -I https://wavecode.tail347ae6.ts.net/"