---
proposition: |
  Публичный LiteLLM (`llm-proxy-public.service` на 127.0.0.1:11436,
  vhost `llm.kosov.online` через Caddy) пускает preflight OPTIONS только
  от origins в `services.llm-proxy.publicInstance.corsAllowedOrigins`.
  Список — explicit finite set конкретных HTTPS-хостов (FastAPI
  CORSMiddleware не поддерживает wildcard-паттерны, делает exact-string
  match). Добавляем `"https://wavecode.kosov.online"` при подключении
  каждого нового публичного клиента. Дополнительно: убираем
  случайно задвоенный `console.log('[llm] → request', ...)` блок
  в `LiveLLMClient.ts` (копипаста из соседнего коммита).
antithesis: |
  (1) «Поменять CORS на `*`» — FastAPI proxy закрыт API-key auth,
    `corsAllowCredentials=true` ⇒ wildcard с credentials запрещён
    спецификацией (CORS preflight ответ с `Access-Control-Allow-Credentials`
    не должен иметь `*` в origin). Кроме того, LiteLLM по умолчанию
    отдаёт `*` для no-auth — но Caddy `header_down` всё равно
    перезаписывает на request Origin в публичном vhost-канале
    (`kosov-reverse-proxy/default.nix:75-82`). Однако preflight
    ОТВЕТ LiteLLM для non-matching origin приходит БЕЗ
    `Access-Control-Allow-Origin` → `header_down` уже нечего
    перезаписывать → no-op → preflight по-прежнему fail.
    Простое смягчение allowlist до `*` ломает credentials flow.

  (2) «Прибить CORS на уровне Caddy, LiteLLM оставить `*`» — Caddy
    умеет отвечать OPTIONS preflight без backend (`header { …
    Access-Control-Allow-Origin * }` в `respond` или named-route),
    но это значит дублировать логику rate-limit/auth, которую
    LiteLLM и так делает. И теряем per-origin audit-log LiteLLM.

  (3) «Положить wavecode на собственный поддомен вне
    `*.kosov.online`» — потеряем wildcard cert Let's Encrypt, нужен
    отдельный vhost в `services.kinetic.services` + DNS-запись
    у Reg.ru. Неоправданная цена ради одного origin.
synthesis: |
  Explicit-list allowlist. Принцип: явный реестр публичных клиентов
  в AngaraConfig, обновляется при on-board нового приложения (тот же
  review-gate, что для добавления tier=public vhost).

  Шаги фикса:
  1. `AngaraConfig/configuration.nix:1215-1226` — добавить
     `"https://wavecode.kosov.online"` в
     `services.llm-proxy.publicInstance.corsAllowedOrigins`.
  2. `ui/src/infrastructure/llm/LiveLLMClient.ts:51-63` — убрать
     второй (back-to-back дубль) `console.log('[llm] → request', …)`,
     оставить первую запись.
  3. `ui/.env.example:10` — обновить комментарий
     `CORS *.kosov.online allowlist` →
     `CORS explicit allowlist на angara-1` (точное отражение реальности,
     см. antithesis #1).

  После `nixos-rebuild switch` LiteLLM перечитает config (SIGHUP через
  `systemctl reload llm-proxy-public` или автоматически при ребилде
  через `services.<…>.enable` recursion). wavecode — отдельный
  Vite-bundle-rebuild не нужен (только edit в AngaraConfig затрагивает
  runtime).
substrate: |
  ~ AngaraConfig/configuration.nix (1 line added to
    `services.llm-proxy.publicInstance.corsAllowedOrigins`)
  ~ ui/src/infrastructure/llm/LiveLLMClient.ts (удалён дубликат
    console.log, 8 lines removed)
  ~ ui/.env.example (1 line comment updated)
status: draft
axiom: A5
epistemics:
  - statement: "FastAPI CORSMiddleware сравнивает Origin exact-string,
      не glob. `['https://*.kosov.online']` литерально не матчит
      `https://wavecode.kosov.online`."
    marker: fact
    evidence: "AngaraConfig/services/llm-proxy.nix:349-351 — explicit
      warning comment рядом с опцией: «NB: FastAPI CORSMiddleware
      не поддерживает wildcard в origins; список конкретных хостов
      нужно явно». FastAPI source: starlette.middleware.cors uses
      `if origin in allow_origins` (no fnmatch)."
  - statement: "Браузер при Origin != allowlist отвечает на preflight
      без `Access-Control-Allow-Origin` header → `fetch()` бросает
      `TypeError: Failed to fetch`. Сообщение доходит в
      `Effect.tryPromise catch` без дополнительного контекста."
    marker: fact
    evidence: "WHATWG Fetch §3.2.4 «CORS preflight fetch»;
      wavecode LiveLLMClient.ts:65-76 wrap `fetch(...)` in
      `Effect.tryPromise` с catch который теряет err.cause."
  - statement: "Caddy `header_down` НЕ добавляет header, если
      upstream его не отправил. Перезаписывает только существующий."
    marker: fact
    evidence: "kosov-reverse-proxy/default.nix:75-82 — `header_down
      Access-Control-Allow-Origin "{http.request.header.Origin}"`
      в блоке `reverse_proxy`. Caddy docs: header_down устанавливает
      заголовок в response от upstream; отсутствующий upstream-header
      остаётся отсутствующим."
  - statement: "Public llm-proxy устанавливает
      `corsAllowCredentials=true` ⇒ wildcard `*` в Allow-Origin
      запрещён per CORS spec."
    marker: fact
    evidence: "AngaraConfig/configuration.nix:1223 —
      `corsAllowCredentials = true`. Fetch spec §3.2.4: «if
      Access-Control-Allow-Credentials is `true` and
      Access-Control-Allow-Origin is `*`, reject»."
  - statement: "Список apps на llm.kosov.online сейчас:
      genium-clean, geopulse, paseo, kb, chat + llm self. wavecode
      становится шестым."
    marker: fact
    evidence: "AngaraConfig/configuration.nix:1215-1222 (pre-fix
      состояние — пять origin + llm self). Audit: добавление нового
      origin — механический шаг, не требует переконфигурации
      LiteLLM models или Caddy vhosts."
  - statement: "Fetch с default credentials=omit и заголовком
      Authorization + Content-Type: application/json триггерит
      preflight OPTIONS (не-simple request)."
    marker: fact
    evidence: "Fetch spec §2.1.1 «CORS-safelisted request»: без
      Authorization + с simple Content-Type — no preflight. С
      Authorization — preflight обязателен."
  - statement: "Эффективное изменение runtime только в AngaraConfig
      (LiteLLM читает SIGHUP-reloadable config). Пересборка Vite
      bundle для wavecode не требуется (изменение
      LiveLLMClient.ts — bug, не новый функционал; .env.example —
      комментарий)."
    marker: inference
    evidence: "AngaraConfig/services/llm-proxy.nix:419 —
      `ExecReload = /bin/kill -SIGHUP $MAINPID`. LiteLLM per docs
      reloads YAML on SIGHUP. wavecode bundle: изменения сужают
      логирование (бэкенд-вызовы — те же)."
---

## Intent

Зафиксировать, как публичный LiteLLM принимает браузерные запросы
от новых приложений на `*.kosov.online`, и попутно убрать копипастный
баг в `LiveLLMClient`.

## What this is NOT

- Не wildcard `*` в allowlist — credentials-flow + Caddy preflight.
- Не Caddy-level OPTIONS handler — дублирует логику auth/rate-limit.
- Не новый vhost вне `*.kosov.online` — wildcard LE cert shared,
  taxonomy сделана by-subdomain.
- Не direct MiniMax API — фикс бы обошёлся без LLM proxy, но пакет
  `wavecode-llm-litellm-proxy` уже applied и поставляет bearer-key
  management + spend tracking.

## Worked example

Клиент `wavecode.kosov.online` шлёт:

```http
POST https://llm.kosov.online/v1/chat/completions HTTP/1.1
Origin: https://wavecode.kosov.online
Authorization: Bearer sk-litellm-...
Content-Type: application/json
```

Браузер сначала шлёт OPTIONS preflight. После `nixos-rebuild switch`:

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://wavecode.kosov.online
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: *
Access-Control-Allow-Headers: Authorization, Content-Type
```

→ реальный POST проходит, стрим читается до конца.

До фикса: preflight-ответ LiteLLM **без** `Access-Control-Allow-Origin`
(literal `*.kosov.online` не матчится), `header_down` нечего
переписать → `TypeError: Failed to fetch` в `Effect.tryPromise`
catch → `console.error('[AIEditPanel] LLM error: …')` в devtools.

## Notes

- **Anti-regression**: при подключении нового web-клиента на
  `*.kosov.online` обязательно:
  1. Добавить origin в `services.llm-proxy.publicInstance.corsAllowedOrigins`.
  2. Если нужен auth — выдать per-app ключ через
     `bin/install-llm-provider.sh install litellm-master` +
     `/key/generate` (см. KB AngaraConfig 50_operations/llm-proxy.md).
- **Видимость**: сейчас 6 origin'ов в allowlist. Если вырастет за ~15
  — стоит переписать на regex/whitelist через nginx middleware или
  кастомный FastAPI middleware (см. ADR кандидат).
- **Backlog для wavecode-side** (отдельный пакет):
  `LiveLLMClient.ts:75` — `Effect.tryPromise` catch теряет
  `err.cause`. Стоит сначала
  `console.error('[llm] raw error', err)` до `Effect.fail`,
  чтобы devtools получал `TypeError`/`AbortError`/etc имена.
