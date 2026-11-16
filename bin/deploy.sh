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
#   • https://wavecode.sibres.tech/  — публичный URL (Caddy public listener)
#   • https://wavecode.kosov.online/ — из Tailscale (split-DNS → tailnet IP)
#
# Rollback:
#   • cd ~/Projects/AngaraConfig && git revert <commit> && bin/rebuild.sh switch
#
# Идемпотентно: можно запускать сколько угодно раз.

set -euo pipefail

# Resolve pnpm to an absolute path — non-interactive SSH sessions (e.g.
# GitVerse Actions runner) don't source ~/.bashrc, so a bare `pnpm` would
# fail with "command not found" even when pnpm is installed for the user.
# corepack installs pnpm at /home/<user>/.local/bin/pnpm; fall back to
# PATH lookup so the script still works on dev hosts where pnpm is in
# /run/current-system/sw/bin or corepack-managed shims.
if command -v pnpm >/dev/null 2>&1; then
  PNPM="$(command -v pnpm)"
else
  PNPM="/home/${SUDO_USER:-$USER}/.local/bin/pnpm"
fi
if [ ! -x "$PNPM" ]; then
  echo "ERROR: pnpm not found. Install via corepack:"
  echo "  corepack enable && corepack prepare pnpm@latest --activate"
  exit 1
fi

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

# 2. Verify key matches server's LITELLM_MASTER_KEY (or warn if running
#    outside angara-1 and we can't read /etc/secrets/llm-proxy/master.key).
"$UI_DIR/../bin/check-llm-key.sh"

# 3. Install if needed.
if [ ! -d node_modules ]; then
  echo "==> pnpm install"
  "$PNPM" install --no-frozen-lockfile
fi

# 4. Build.
echo "==> pnpm build"
"$PNPM" build

# 5. Deploy to /var/lib/wavecode/dist (Caddy needs read access there).
echo "==> sudo cp -r $UI_DIR/dist/* → $DEPLOY_DIR/"
SUDO=/usr/bin/sudo
if ! "$SUDO" -n true 2>/dev/null; then
  echo "ERROR: $SUDO -n rejected (no passwordless sudo)."
  echo "  Fix: add NOPASSWD for /bin/cp /bin/mkdir /bin/chown in /etc/sudoers.d/wavecode-deploy"
  echo "  OR run this script as root."
  exit 1
fi
"$SUDO" -n mkdir -p "$DEPLOY_DIR"
"$SUDO" -n cp -r "$UI_DIR/dist/." "$DEPLOY_DIR/"
# Prune stale files. Vite content-hashes every chunk, so each build
# orphans the previous one's files; the fresh build dir is the source of
# truth — anything in the deploy dir that is not in it is garbage.
# The old index-*-only loop missed every other chunk family (codemirror-*,
# effect-*, VisualizerPanel-*, workbox-*, …) and so accumulated ~60 MB of
# orphans per deploy; it also deleted the ACTIVE bundle's source map,
# because the map filename was never in the ACTIVE_JS list.
if [ ! -f "$UI_DIR/dist/index.html" ]; then
  echo "ERROR: $UI_DIR/dist/index.html missing — refusing to prune."
  exit 1
fi
pruned=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  if [ -e "$UI_DIR/dist/$rel" ]; then
    continue
  fi
  "$SUDO" -n rm -rf "$DEPLOY_DIR/$rel"
  pruned=$((pruned + 1))
done < <(cd "$DEPLOY_DIR" && find . -mindepth 1 -printf '%P\n' | sort -r)
[ "$pruned" -gt 0 ] && echo "==> pruned $pruned stale file(s) from $DEPLOY_DIR/"
"$SUDO" -n chown -R caddy:caddy "$DEPLOY_DIR"

echo
echo "✓ Build + deploy complete: $DEPLOY_DIR/"
echo
echo "Nix config already points there. Если меняли .env.local,"
echo "перезагрузите Caddy: systemctl reload caddy"
echo
echo "Verify:"
echo "  curl -I https://wavecode.sibres.tech/"
echo "  curl -I https://wavecode.kosov.online/"