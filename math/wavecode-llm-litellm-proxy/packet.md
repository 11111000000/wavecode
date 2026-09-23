---
proposition: |
  LLM-клиент wavecode подключается к https://llm.kosov.online/v1 через
  @ai-sdk/openai-compatible; аутентификация — per-app Bearer-токен
  (sk-litellm-...), прокси — LiteLLM с upstream MiniMax.
antithesis: |
  Прямой MiniMax API (https://api.minimax.io/anthropic/v1) даёт более
  низкую латентность (без прокси) и доступ к фичам, которые LiteLLM может
  не поддерживать. Claude (Anthropic) качественнее пишет код, чем MiniMax
  M2.1-highspeed. Альтернативы: локальный LLM (WebLLM/MLC) — без
  бэкенда вообще, но слабее и тяжёлый.
synthesis: |
  LiteLLM прокси уже настроен (AngaraConfig), per-app-ключи scoped и
  revocable, CORS allowlist для *.kosov.online. OpenAI-compatible
  протокол даёт единый клиент для всех провайдеров (Claude, MiniMax,
  Kimi) через тот же AI SDK. Качество текущей модели (`smart` →
  MiniMax-M3) приемлемо для правки кода. Если понадобится Claude —
  добавляется через конфиг, без правок кода.
substrate: none
status: draft
axiom: A5
epistemics:
  - statement: "LiteLLM proxy llm.kosov.online поддерживает OpenAI-compatible API"
    marker: fact
    evidence: "AngaraConfig/KB/50_operations/llm-proxy.md — endpoint /v1/chat/completions"
  - statement: "Per-app ключи scoped к моделям [smart, fast]"
    marker: fact
    evidence: "AngaraConfig KB: POST /key/generate с key_alias и models"
  - statement: "Модель 'smart' = MiniMax-M3, 'fast' = MiniMax-M2.1-highspeed"
    marker: fact
    evidence: "AngaraConfig configuration.nix: services.llm-proxy.models"
---

## Intent

LLMClient в `infrastructure/llm/` использует AI SDK с провайдером
`@ai-sdk/openai-compatible`. baseURL и apiKey берутся из env (Vite
подставляет `VITE_LLM_PROXY_URL` и `VITE_LLM_PROXY_KEY` на client-side).

## What this is NOT

- Не прямой MiniMax API (минуем прокси → риск утечки ключей в bundle).
- Не Claude / Anthropic SDK напрямую (провайдеро-зависимо).
- Не локальный LLM (WebLLM) — bundle +1-4 GB, модели слабее.
- Не кастомный HTTP-клиент без streaming (теряем real-time UX).

## Worked example

```ts
// ui/src/infrastructure/llm/LiveLLMClient.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const llmBaseUrl = import.meta.env.VITE_LLM_PROXY_URL ?? 'https://llm.kosov.online/v1';
const llmApiKey = import.meta.env.VITE_LLM_PROXY_KEY;

const provider = createOpenAICompatible({
  baseURL: llmBaseUrl,
  apiKey: llmApiKey,
  name: 'llm-kosov',
});

export const streamCompletion = (req: CompletionRequest) =>
  streamText({
    model: provider(req.model === 'smart' ? 'smart' : 'fast'),
    messages: req.messages,
    tools: req.tools,
    temperature: req.temperature ?? 0.4,
  });
```

## Notes

- **Модели по умолчанию**:
  - `smart` для правки кода (temperature=0.2, topP=0.9)
  - `fast` для чата/REPL (temperature=0.7)
- **Dev-конфиг**: `VITE_LLM_PROXY_URL=https://llm.kosov.online/v1`,
  `VITE_LLM_PROXY_KEY=sk-litellm-...`. В dev-режиме возможен Vite-proxy
  на `http://127.0.0.1:11435` (tailnet, без auth) — но требует
  CORS-allowlist, может не работать.
- **CORS**: production через `*.kosov.online` allowlist. Dev через
  `http://localhost:5173` может потребовать workaround (Vite proxy
  или header injection).
- **Tool calling**: AI SDK поддерживает tool calling в OpenAI-формате;
  LiteLLM проксирует. Протестировано в Genium-clean (AngaraConfig).
- **Безопасность**: per-app ключ revocable; upstream MiniMax ключ
  остаётся на сервере, в bundle клиента не попадает.