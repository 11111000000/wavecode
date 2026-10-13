---
proposition: |
  LLM-запросы возвращают 401:
    «Authentication Error, Malformed API Key passed in.
    Ensure Key has `Bearer ` prefix.»

  Код клиента корректен: `ui/src/infrastructure/llm/LiveLLMClient.ts:63`
  формирует `Authorization: \`Bearer ${deps.apiKey}\``. Сам код не
  сломан. Сломан **сам ключ** в `ui/.env.local:2`:

    VITE_LLM_PROXY_KEY=ea6d97e948e72da6ba6ef529116bf2f3e63a7d2694875d776ab4001fddbb6f6a

  Согласно witness пакета `math/wavecode-llm-revert-basicauth/witness:25`,
  тот же самый ключ работал именно с префиксом `sk-litellm-`:

    Authorization: Bearer sk-litellm-ea6d97e9…(genium key)
    → 200 OK, 548 bytes LiteLLM JSON

  То есть литеральная последовательность `ea6d97e9…` это **per-app
  LiteLLM key** (genium-приложение), а префикс `sk-litellm-` — обязательная
  часть формата, которую при правке `.env.local` случайно убрали
  (файл в `.gitignore`, история не отслеживается, mtime = 2026-09-26).

  Решение — восстановить `sk-litellm-` префикс в `.env.local`. Это
  единственный необходимый фикс; никаких изменений в коде не нужно.

  Дополнительно: для устойчивости к будущим подобным регрессиям —
  добавить префикс-валидацию в `LiveLLMClient.ts:215-216` (warning при
  загрузке, если ключ задан, но не начинается с `sk-` — soft-check,
  не блокирует работу). Это не починит 401, но даст оператору ранний
  сигнал в `console.warn`.
antithesis: |
  (1) «Префикс это формат LiteLLM, а реальная причина может быть
  в ротации `LITELLM_MASTER_KEY` на сервере — тогда клиентский
  ключ мёртв независимо от префикса». Возражение: witness явно
  показывает, что этот же литерал работал с префиксом. Если бы
  master был ротирован, witness curl тоже бы упал. Сначала
  пробуем минимальный фикс (префикс); если не поможет — следующий
  пакет про ротацию.
  (2) «Может быть проблема в Caddy tier — опять public-auth».
  Возражение: `wavecode-llm-revert-basicauth` откатил это 2026-10-09.
  Если бы tier вернулся к public-auth, текст ошибки был бы
  `Www-Authenticate: Basic realm=...`, а не «Malformed API Key».
  LiteLLM не говорит «Bearer prefix» если preflight 401 от Caddy.
  (3) «Жёстко требовать `sk-` префикс в коде — это валидация
  серверного формата, не наше дело». Возражение: только warning,
  не блокировка. `sk-` префикс — это LiteLLM convention
  задокументированный в `.env.example:27`. Warning оператору —
  минимальное вмешательство.
  (4) «Файл `.env.local` в `.gitignore`, история не сохранилась —
  как понять что префикс был?». Возражение: witness `wavecode-llm-
  revert-basicauth` — это literal evidence: «verified рабочий
  curl с `sk-litellm-ea6d97e9…`» — это контрактное подтверждение
  от живого теста в момент `applied_at_system: 2026-10-09T08:52Z».
synthesis: |
  Две правки:

  1. **`ui/.env.local`** (modify, файл в `.gitignore`):
     `VITE_LLM_PROXY_KEY=ea6d97e9…`
     → `VITE_LLM_PROXY_KEY=sk-litellm-ea6d97e9…`
     Литеральная последовательность символов после `sk-litellm-`
     остаётся ровно той же. URL тоже без изменений.

  2. **`ui/src/infrastructure/llm/LiveLLMClient.ts`** (modify, +4 line):
     В `makeLiveLLMClient` после блока `if (!apiKey) {...}` (line 220-222)
     добавить мягкий warning, если ключ задан, но не начинается с `sk-`:

     ```ts
     if (apiKey && !apiKey.startsWith('sk-')) {
       console.warn(
         `[llm] VITE_LLM_PROXY_KEY does not start with 'sk-' — LiteLLM
         expects the sk-litellm-… format. If you see "Malformed API
         Key" 401s, prepend 'sk-litellm-' to the key.`,
       );
     }
     ```

     Это **soft check**, не блокирует работу: некоторые деплои
     LiteLLM могут принимать голый master key; warning всё равно
     полезен как подсказка оператору.

  Verification (post-apply):
    - Production deploy (`bin/deploy.sh`) ребилдит с новым `.env.local`.
    - В браузере: `console.log('[llm] VITE_LLM_PROXY_KEY …')` отсутствует
      (ключ задан, нет warning).
    - В браузере: AI-edit запрос уходит → `[llm] ✓ content length: …`
      в консоли.
    - Network tab: POST `/v1/chat/completions` → 200 OK.
  Минимальная правка, точечная, не трогает код клиента.
status: draft
witness:
  applied_at: pending
  commit: pending
  notes: |
    To be populated after implementation.
    Verification:
      - .env.local восстановлен
      - typecheck clean (LiveLLMClient.ts изменён)
      - vitest 628/628 passing (LLM-тесты мокают env, должны быть
        unaffected)
      - manual: prod deploy + curl 200 OK
---