---
proposition: |
  В `ui/.env.local` лежит `VITE_LLM_PROXY_KEY` БЕЗ префикса `sk-litellm-`,
  а `LITELLM_MASTER_KEY` на angara-1 — С префиксом. `compare_digest` в
  `_user_api_key_auth_builder` (litellm 1.75.5) возвращает False →
  upstream-код считает, что ключ НЕ мастер → пытается lookup virtual
  key в Prisma DB → Prisma сознательно отключён
  (`services/llm-proxy.nix:67-69`) → 400 `{"error":{"type":"no_db_connection",...}}`.
  Тихо: bundle собирается и деплоится без ошибок, в UI каждый запрос
  возвращает "LLM ошибка: LLM HTTP 400: ...No connected db...". Юзер
  видит broken AI panel, при этом Playwright/curl с правильным
  `sk-litellm-...` ключом возвращает 200 — т.е. это key-drift, не
  реальный outage.
antithesis: |
  (1) «Подменить `.env.local` напрямую в этом сеансе» — починит
    симптом сейчас, но `.env.local` gitignored, дрифт вернётся при
    следующем `git clean -fdx -e ui/.env.local` (CI deploy делает
    именно это) или при ручной перезаписи. Нужна защита от drift.

  (2) «Сделать так, чтобы LiteLLM принимал ключ без префикса» —
    upstream LiteLLM требует формат `sk-<…>` для virtual keys
    (`_user_api_key_auth_builder:790` ассертит `api_key.startswith("sk-")`).
    Менять upstream-код нельзя (Nix store, не наш пакет).

  (3) «Поднять Prisma/SQLite для виртуальных ключей» — наш config
    в `services/llm-proxy.nix:67-69` явно документирует, почему
    Prisma не работает: `prisma generate` требует записи в
    site-packages (read-only в Nix store), Prisma engine binary
    не существует на Prisma CDN для linux-nixos. Починить — это
    отдельный ADR-уровень refactor (Prisma → Postgres asyncpg, или
    LiteLLM proxy → свой auth backend). Не blocking для текущей
    проблемы.

  (4) «Прятать 400 error в UI, retry с правильным ключом» — клиент
    не знает, какой ключ "правильный". Это server-side config drift,
    а не runtime-проблема клиента. Только deploy-time check может
    гарантировать правильное значение.

  (5) «Ничего не делать, пусть wavecode-сторона заметит» — мы
    ЗАМЕТИЛИ: 400 каждые 30 секунд в логах юзера, но key
    инфраструктура (AngaraConfig) — единственное место, где
    canonical-значение master_key. Клиент (bundle) должен быть
    читателем, не источником истины.

  (6) «Поднять отдельный backend на angara-1, который держит
    master_key и проксирует для wavecode» — правильный долгосрочный
    фикс, но это новый сервис, новый flake-кусок, новый домен.
    Не blocking для текущей проблемы (текущая security model
    "master_key в bundle" уже принята в `math/wavecode-llm-litellm-proxy`).
synthesis: |
  Три слоя защиты — все должны быть на месте, любой по отдельности
  недостаточен.

  **Слой 1: deploy-time check.**
  `bin/check-llm-key.sh` запускается из `pnpm prebuild` (через
  package.json) и из `bin/deploy.sh` явно. Сравнивает
  `VITE_LLM_PROXY_KEY` в `ui/.env.local` с `LITELLM_MASTER_KEY` в
  `/etc/secrets/llm-proxy/master.key` на angara-1. Если
  недоступен (CI без server access) — WARN, exit 0 (best-effort).
  Если ключи не совпадают — exit 1 с actionable hint:
  "sudo grep ^LITELLM_MASTER_KEY /etc/secrets/llm-proxy/master.key;
  обновить VITE_LLM_PROXY_KEY= в .env.local (включая sk-litellm-
  префикс)". CI deploy (`bin/deploy.sh` через GitVerse Actions SSH)
  запускается на angara-1, так что check работает.

  **Слой 2: прокси fail-closed при config-reload race.**
  `services/llm-proxy/patches/auth_fail_closed.{py,pth}` — monkey-patch
  `_user_api_key_auth_builder`. Если `master_key is None AND
  prisma_client is None` → raise `HTTPException(503, "auth_not_ready")`
  вместо возврата `PROXY_ADMIN` для любого ключа. Это закрывает
  7-минутное окно между "Application startup complete" и
  "Proxy initialized with Config" после SIGHUP reload, в течение
  которого public instance был фактически open-proxy (verified
  2026-10-14: fake keys возвращали 200 в этом окне).

  Установка через `.pth` файл в site-packages, потому что:
  systemd services не honour PYTHONSTARTUP, uvicorn workers — fork
  (не exec), так что `.pth` — единственный mechanism, который
  fires в каждом Python process для данного site-packages dir.
  Import hook через `sys.meta_path` ловит первый import
  `litellm.proxy.auth.user_api_key_auth` независимо от порядка
  (даже если при старте модуль ещё не fully loadable).

  **Слой 3: actionable error messages в SPA.**
  `LiveLLMClient.classifyLLMHttpError` теперь различает:
  - 400 `no_db_connection` → подсказка про `bin/check-llm-key.sh`,
    как получить master_key с angara-1
  - 401 `malformed` → "ключ должен начинаться с sk-"
  - 401 generic → "возможно, master_key rotated, см. check-llm-key.sh"
  - 503 `auth_not_ready` → "proxy starting up, retry"
  - 429 → "rate-limited"
  - 5xx → "upstream error"
  Юзер сразу видит, что делать, а не "LLM ошибка" с raw JSON.

  Тесты `services/llm-proxy/tests/test_auth_fail_closed.py`:
  4 кейса (no-backend → 503, master_key set → pass-through,
  prisma_client set → pass-through, idempotent install). Все pass.

  Не входит в этот пакет (явно за рамками):
  - Реальный per-app virtual key (нужен DB backend) — отдельный ADR
    в AngaraConfig.
  - Backend-прокси на angara-1, скрывающий master_key от bundle —
    правильный долгосрочный фикс, но требует нового сервиса.
  - Caddy-side assertion, что `publicBackend` действительно
    указывает на 11436 а не 11435 (вторая часть бага проявилась
    бы если srv2 случайно смотрел бы на tailnet instance — сейчас
    корректно, но нет защиты от регрессии).

  Взаимодействие с предыдущими пакетами:
  - `wavecode-llm-cors-explicit-allowlist` (2026-10-09): CORS preflight
    теперь проходит, но без правильного ключа 400. Этот пакет
    закрывает второй слой "правильный preflight + правильный auth".
  - `wavecode-llm-litellm-proxy`: master_key в bundle — известное
    ограничение. Этот пакет его не устраняет, но фиксит specific
    failure mode, при котором даже master_key из bundle не работает.
  - `wavecode-llm-revert-basicauth` (2026-10-12): vhost tier=public
    вместо public-auth. Корректно; этот пакет не трогает routing.

## Implementation

Wavecode-side (this repo):
- `bin/check-llm-key.sh` (new, executable)
- `bin/deploy.sh` (calls check-llm-key.sh after .env.local existence
  check)
- `ui/.env.example` (warning block about drift + how to get key)
- `ui/package.json` (prebuild script invokes the check)
- `ui/src/infrastructure/llm/LiveLLMClient.ts` (classifyLLMHttpError
  for actionable errors)

AngaraConfig-side (cross-repo):
- `services/llm-proxy.nix` (litellmAuthPatch derivation added to
  Python env)
- `services/llm-proxy/patches/auth_fail_closed.{py,pth}` (the
  monkey-patch)
- `services/llm-proxy/tests/test_auth_fail_closed.py` (4 tests, all pass)
- `services/llm-proxy/tests/__init__.py` (package marker)

## Verification

```bash
# 1. Test the fail-closed patch
cd /home/az/Projects/AngaraConfig-llm-public-auth-fix
PYTHONPATH=... python3 -m unittest \
  services.llm-proxy.tests.test_auth_fail_closed -v
# 4/4 OK

# 2. Verify public instance behavior post-rebuild (after this is deployed)
# Direct curl to 127.0.0.1:11436 with WRONG key → 400 no_db_connection
# (unchanged, the wavecode key is now the full master, so this requires
# a different wrong key).
# curl with the wavecode .env.local key (sk-litellm-...) → 200 from upstream
curl -X POST 'http://127.0.0.1:11436/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk-litellm-...real-key...' \
  -d '{"model":"fast","messages":[{"role":"user","content":"PONG"}],"max_tokens":5}'
# → 200, not 400

# 3. Verify SIGHUP race no longer opens proxy
sudo kill -SIGHUP $(systemctl show llm-proxy-public -p MainPID --value)
# In the first 10 seconds, requests should return 503 (not 200):
curl -X POST 'http://127.0.0.1:11436/v1/chat/completions' \
  -H 'Authorization: Bearer anything' \
  -d '{"model":"fast","messages":[{"role":"user","content":"PONG"}]}' \
  -w "%{http_code}\n"
# → 503 auth_not_ready (not 200)

# 4. Browser-side end-to-end (via Playwright MCP)
# Hard-reload wavecode.kosov.online, type "сделай быстрее в два раза"
# in the AI panel, click "Применить" → status "Применено и играет ✓"
# (regression test for the original failure mode)

# 5. Deploy-time check
cd /home/az/Projects/wavecode
bin/check-llm-key.sh
# → "✓ VITE_LLM_PROXY_KEY matches LITELLM_MASTER_KEY on angara-1."
# (or non-zero exit with actionable hint if drift)

# 6. Try with WRONG key in .env.local
echo "VITE_LLM_PROXY_KEY=sk-litellm-DRIFTED-KEY" > ui/.env.local
bin/check-llm-key.sh
# → exit 1, prints:
#   "ERROR: VITE_LLM_PROXY_KEY in .../ui/.env.local does NOT match
#    LITELLM_MASTER_KEY on angara-1.
#    bundle (first 24 chars): sk-litellm-DRIFTED-KEY...
#    server (first 24 chars): sk-litellm-ea6d97e948e72da6ba6ef52...
#    Это причина 400 'No connected db' в UI: ..."
```

## Failure modes & rollback

If `auth_fail_closed.py` raises on import (e.g. litellm refactor
breaks our import hook), the entire `llm-proxy-public.service` will
fail to start. The systemd unit is configured with `Restart=always,
RestartSec=3s`, so it will crash-loop. Mitigation: revert commit
`c9c13c7` (or whichever commit landed the patch) and rebuild.

If the patch fires 503 for legitimate requests (false positive),
the service is functionally down for clients. Mitigation: same —
revert the patch. Since the patch only fires when BOTH master_key
AND prisma_client are None, this can only happen during
config-reload windows, and the upstream LiteLLM behavior in that
window was "return PROXY_ADMIN for any key" — i.e., completely
unauthenticated. So 503 is strictly more secure.

If `bin/check-llm-key.sh` rejects a valid key (e.g. trailing
whitespace, or master_key was rotated and bundle wasn't rebuilt
yet), the deploy fails. Mitigation: rebuild bundle with new
key, or temporarily skip the check by setting
`SKIP_LLM_KEY_CHECK=1` (TODO: implement this escape hatch if it
becomes a problem; currently we just fail fast).
