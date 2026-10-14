#!/usr/bin/env bash
# bin/check-llm-key.sh — verify ui/.env.local VITE_LLM_PROXY_KEY
# matches the server's LITELLM_MASTER_KEY on angara-1.
#
# Зачем: wavecode SPA делает fetch к https://llm.kosov.online/v1/chat/completions
# с Authorization: Bearer <key>. Public instance (llm-proxy-public.service,
# 127.0.0.1:11436) проверяет key через _user_api_key_auth_builder →
# compare_digest(api_key, master_key). Если НЕ совпало → пытается lookup
# virtual key в Prisma DB → DB нет (см. services/llm-proxy.nix:67-69) →
# 400 {"error":{"type":"no_db_connection",...}}.
#
# Тихий failure mode: bundle компилится, деплоится, всё выглядит green,
# но в UI "LLM ошибка: LLM HTTP 400: ...No connected db..." для каждого
# запроса. Поэтому check ПЕРЕД pnpm build.
#
# Behaviour:
#   • .env.local отсутствует / VITE_LLM_PROXY_KEY пустой → exit 1
#   • .env.local содержит REPLACE-ME → exit 1
#   • /etc/secrets/llm-proxy/master.key недоступен (CI без server
#     access) → WARN, exit 0 (best-effort)
#   • ключи не совпадают → exit 1 с actionable hint
#   • ключи совпадают → exit 0

set -euo pipefail

UI_DIR="$(cd "$(dirname "$0")/../ui" && pwd)"
ENV_LOCAL="$UI_DIR/.env.local"
MASTER_KEY_FILE="/etc/secrets/llm-proxy/master.key"

err() { echo "ERROR: $*" >&2; }
ok()  { echo "✓ $*"; }

if [ ! -f "$ENV_LOCAL" ]; then
  err "$ENV_LOCAL not found."
  err "  cp $UI_DIR/.env.example $ENV_LOCAL && \$EDITOR $ENV_LOCAL"
  exit 1
fi

BUNDLE_KEY=$(grep -E '^VITE_LLM_PROXY_KEY=' "$ENV_LOCAL" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
if [ -z "$BUNDLE_KEY" ]; then
  err "VITE_LLM_PROXY_KEY is empty in $ENV_LOCAL."
  exit 1
fi
if [ "$BUNDLE_KEY" = "REPLACE-ME" ] || [[ "$BUNDLE_KEY" == *REPLACE-ME* ]]; then
  err "VITE_LLM_PROXY_KEY still has placeholder 'REPLACE-ME'."
  err "  На angara-1: sudo grep LITELLM_MASTER_KEY $MASTER_KEY_FILE"
  err "  Скопируй значение (с префиксом sk-litellm-) в $ENV_LOCAL."
  exit 1
fi

if [ ! -r "$MASTER_KEY_FILE" ]; then
  err "Cannot read $MASTER_KEY_FILE (running outside angara-1 or no sudo?)."
  err "  This check is best-effort. Bundle will be built with current .env.local."
  err "  If deploying from a CI runner that has SSH access to angara-1, the"
  err "  secrets are there — copy the file or run this script over SSH."
  err ""
  err "  To verify after deploy:"
  err "    curl -fsS -X POST http://127.0.0.1:11436/v1/chat/completions \\"
  err "      -H \"Authorization: Bearer \$VITE_LLM_PROXY_KEY\" \\"
  err "      -H 'Content-Type: application/json' \\"
  err "      -d '{\"model\":\"fast\",\"messages\":[{\"role\":\"user\",\"content\":\"PONG\"}],\"max_tokens\":5}'"
  err "    → должен вернуть 200, не 400 'No connected db'."
  exit 0
fi

SERVER_KEY=$(grep -E '^LITELLM_MASTER_KEY=' "$MASTER_KEY_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
if [ -z "$SERVER_KEY" ]; then
  err "$MASTER_KEY_FILE has no LITELLM_MASTER_KEY line."
  exit 1
fi

if [ "$BUNDLE_KEY" != "$SERVER_KEY" ]; then
  err "VITE_LLM_PROXY_KEY in $ENV_LOCAL does NOT match LITELLM_MASTER_KEY on angara-1."
  err "  bundle (first 24 chars): ${BUNDLE_KEY:0:24}..."
  err "  server (first 24 chars): ${SERVER_KEY:0:24}..."
  err ""
  err "  Это причина 400 'No connected db' в UI: LiteLLM checks api_key != master_key,"
  err "  tries to look up virtual key in Prisma DB, no Prisma configured, 400."
  err ""
  err "  Fix: скопируй значение с angara-1:"
  err "    sudo grep ^LITELLM_MASTER_KEY $MASTER_KEY_FILE"
  err "  Затем обнови $ENV_LOCAL VITE_LLM_PROXY_KEY= на это значение (включая префикс sk-litellm-)."
  exit 1
fi

ok "VITE_LLM_PROXY_KEY matches LITELLM_MASTER_KEY on angara-1."
