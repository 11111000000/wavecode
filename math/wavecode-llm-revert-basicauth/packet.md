---
proposition: |
  LLM-эндпоинт `llm.kosov.online` (LiteLLM public listener, 11436)
  идёт **без** basic-auth на Caddy-уровне: tier="public" (НЕ
  "public-auth"). Авторизация — двухуровневая:
    1. CORS allowlist на LiteLLM (FastAPI CORSMiddleware, exact-string).
       Каждый фронт получает свой origin в списке, чтобы браузер
       пустил fetch с credentials/no-credentials.
    2. Per-app Bearer-ключ (LiteLLM `Authorization: Bearer sk-litellm-…`).
       Один ключ на приложение, ревокабельный, scoped.
  Всё. Basic-auth, API-key на query, mTLS — НЕ добавляются. Caddy видит
  `llm` vhost как `tier="public"` и пропускает bearer-only клиентов
  (Geopulse FastAPI, Genium-clean Lab/TestBench, wavecode AIEditPanel).
antithesis: |
  (1) «basic-auth = defense-in-depth от key exfiltration из JS bundle».
    Возражение: если атакующий на любом `*.kosov.online` — у него
    уже есть bundle (CORS не пустит его чужой Origin → preflight
    fail). Если атакующий **вне** kosov-online — CORS его режет
    до basic-auth. basic-auth ничего не добавляет, кроме трения
    для существующих клиентов.

  (2) «basic-auth прячет 11436 от любопытных сканеров портов и
    единую точку входа». Возражение: 11436 на 127.0.0.1, фаервол
    закрыт → сканеры не дотянутся. Caddy публичный listener
    единственная точка входа (201.24.118.191:443), и она
    публична by design.

  (3) «тогда ограничь public listener только мы с Caddy-vhost на
    IP allowlist». Возражение: добавляет perimeter filtering,
    но не решает root cause — broken Genium/Geopulse need fix,
    а не ещё один слой.

  Предыдущий (2026-10-07) эксперимент tier="public-auth" сломал
  всех bearer-only клиентов: Caddy basic_auth gate навешивается
  через `mkTailnetHandler` даже на tailnet (100.81.163.63) и
  localhost (127.0.0.1:443) listener, не только public. Это side
  effect kinetic services subtree, не спец-фича.
synthesis: |
  Tier=public обратно. ADR (зафиксировать в KB AngaraConfig):
  authorization model = (CORS allowlist) × (per-app Bearer key)
  — единственная защита. Threat model: реальная угроза — exfiltration
  key из bundle; единственная защита от неё — короткоживущий ключ +
  быстрая ротация (per-app key через `/key/generate` когда починим
  Prisma/Postgres backend в `services/llm-proxy.nix`), а не
  basic-auth поверх.

  Фикс в этом пакете:
  1. `AngaraConfig/configuration.nix:632-643` — `"llm"` блок:
     удалить `auth = { … }`, вернуть `tier = "public"`.
  2. Side-effect bug от предыдущего коммита (Paseo tree-stend):
     `services.tree-stend.enable = true;` был закрыт `};` на
     колонке 0 → выпал из module scope; rebuild падал с
     "option does not exist". Поправлено отдельным коммитом.

  Verified live: сразу после `nixos-rebuild switch` curl с
  только `Authorization: Bearer …` через `https://llm.kosov.online`
  возвращает 200 + LiteLLM JSON (548 bytes response body). OPTIONS
  preflight возвращает правильные `Access-Control-Allow-Origin:
  https://wavecode.kosov.online` без требования basic auth.

  Out of scope (новые пакеты когда-нибудь):
  - Реальная per-app key issuance через `/key/generate`
    (Postgres/Prisma backend) — сейчас все клиенты используют
    один `LITELLM_MASTER_KEY` из bundle.
  - Documentation в `AngaraConfig/KB/30_decisions/` об этом
    эксперименте и откате.
substrate: |
  ~ AngaraConfig/configuration.nix (10 line change: revert llm tier
    с public-auth → public, удалён `auth = { htpasswdFile = …;
    realm = …; type = "basic"; }` блок)
  ~ AngaraConfig/configuration.nix (3 line change: indent kinetic
    close brace + подвинуть `services.tree-stend.enable = true;`
    в module scope — коммит 04a1c5e)
status: applied
axiom: A5
epistemics:
  - statement: "Caddy basic_auth gate в kinetic применяется ко ВСЕМ
      listener'ам (public, tailnet, localhost), не только public."
    marker: fact
    evidence: "AngaraConfig/services/kosov-reverse-proxy/default.nix:133-141
      `mkTailnetHandler` навешивает basic_auth gate через
      `optionalString (vhost.tier == \"public-auth\")`. Caddyfile
      конфиг `/etc/static/caddy/caddy_config` после tier=public-auth
      содержит три basic_auth блока для llm vhost (строки 181-183,
      444-446, 659-661) — по одному на каждый listener."
  - statement: "С `2026-10-07` по `2026-10-09` Genium-clean Lab,
      Genium-clean TestBench, Geopulse LLM и wavecode AIEditPanel
      401-ing через Caddy при bearer-only запросах. Подтверждено
      curl: `POST http://127.0.0.1:443/v1/chat/completions` с
      `Host: llm.kosov.online` + `Authorization: Bearer …` →
      `401 Unauthorized, Www-Authenticate: Basic realm=restricted`."
    marker: fact
    evidence: "Журнал curl в этом сеансе до revert'а + код клиентов:
      Geopulse `src/geopulse/adapters/llm/minimax.py:140-147`
      (только Authorization: Bearer);
      Genium-clean `src/ui/Lab.svelte:248-260` (только Bearer
      через VITE_LLM_PROXY_KEY); wavecode сам себе аналогично."
  - statement: "Тест `POST http://127.0.0.1:11436/v1/chat/completions`
      с реальным bearer-ключом Genium-clean → 200 OK, 549 bytes JSON
      — LiteLLM работает и ключ валиден. basic-auth не нужен для
      легитимного трафика."
    marker: fact
    evidence: "curl прямо к `:11436` минуя Caddy — LiteLLM
      `x-litellm-call-id: 6d0c0ce7-...` в headers."
  - statement: "После revert + rebuild: тот же `POST` через Caddy с
      тем же bearer-ключом → 200 OK с реальным LiteLLM JSON;
      OPTIONS preflight от wavecode → `Access-Control-Allow-Origin:
      https://wavecode.kosov.online`, без basic-auth challenge."
    marker: fact
    evidence: "curl в этом сеансе после revert (08:52:13Z POST,
      08:52:17Z OPTIONS)."
  - statement: "Side-effect bug от `feat(tree-stend): add SSR
      dev-stand` (Paseo commit f6c7a1b, 2026-10-09T08:44:13Z):
      `services.tree-stend.enable = true;` оказался за пределами
      module scope из-за лишнего `};` на колонке 0. Предыдущий
      rebuild не пере-эвалировал (rc=0 в <1s из-за --quiet
      systemd-run), поэтому баг не всплыл до попытки полного
      rebuild в этом сеансе."
    marker: fact
    evidence: "Paseo commit f6c7a1b diff в `configuration.nix:862-867`;
      оценка `nixos-rebuild --flake path:. --impure switch` в этом
      сеансе до фикса: `option 'services.kinetic.services.tree-stend.enable'
      does not exist`; eval track см. `AngaraConfig/KB/…` после
      фикса."
  - statement: "Сlosure между basic-auth gate и current threat
      model — это broken Genium/Geopulse/wavecode (loss of
      feature для всех), а не added security (basic-auth не
      защищает от key exfiltration, как показано выше)."
    marker: inference
    evidence: "Логика синтеза: basic-auth не достигает цели →
      overhead без выгоды → revert."
---

## Intent

Зафиксировать решение: tier=public для llm, отказ от basic-auth
как дополнительного слоя. Задокументировать, что эксперимент
2026-10-07 провалился (сломал working apps), и обозначить threat
model: CORS allowlist + per-app keys как baseline authz.

## What this is NOT

- Не про то, что basic-auth в принципе плохо. Он подходит для
  tier=public-auth (genium-clean, geopulse, harness, kb-news,
  physics-kb, etc — приложения с persistent UI без upstream
  bundle exposure).
- Не про отказ от всей Caddy vhost auth модели. kinetic tiering
  остаётся.
- Не про direct LiteLLM access. Caddy остаётся единственным
  публичным entry point (11436 bind 127.0.0.1, фаервол).

## Worked example

Было (c 2026-10-07):
```http
POST https://llm.kosov.online/v1/chat/completions
Authorization: Bearer sk-litellm-ea6d97e9…
Content-Type: application/json

→ 401 Unauthorized
  Www-Authenticate: Basic realm="restricted"
```

Стало (с 2026-10-09, этот пакет):
```http
POST https://llm.kosov.online/v1/chat/completions
Authorization: Bearer sk-litellm-ea6d97e9…
Content-Type: application/json

→ 200 OK
  x-litellm-model-api-base: https://api.minimax.io/v1
  Content-Type: application/json
  <549 bytes OpenAI-compat JSON>
```

И CORS preflight от `Origin: https://wavecode.kosov.online`
отдаёт правильный `Access-Control-Allow-Origin` без challenge —
см. `wavecode-llm-cors-explicit-allowlist` для CORS-фикса
(этот пакет — следующий шаг dialectic chain).

## Notes

- **Что починить в ближайшее**:
  - Реальный per-app key issuance через `/key/generate`
    (сейчас все клиенты используют master key из bundle —
    ревокация требует перебилда, что медленно для granular
    rotations).
  - KB-документация: добавить запись в
    `AngaraConfig/KB/30_decisions/llm-proxy-basicauth-experiment-fail-2026-10-09.md`
    (TODO — обсудить с владельцем AngaraConfig).
- **Прямые cleanup-задачи вне scope этого пакета**:
  - `/etc/secrets/llm-htpasswd` остаётся в системе, но
    неиспользуемый после rebuild. Удалить вручную ИЛИ
    оставить как backup, на усмотрение.
  - bin/install-htpasswd.sh `add llm` теперь no-op
    (tier=public игнорирует `auth = { … }`). Документировать
    в README скрипта.
- **Anti-regression**: при попытке добавить basic-auth обратно
  для llm — обязательно проверять, что basic_auth добавляется
  ТОЛЬКО на public listener (mkPublicHandler), не на tailnet/
  localhost (mkTailnetHandler). Иначе повторится 401-епсия
  для Genium/Geopulse/wavecode.
