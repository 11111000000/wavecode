import { Effect, Layer, type Context } from 'effect';
import { LLMClient, type CompletionRequest, type CompletionChunk } from '~/domain/services';

/**
 * Live LLM client — raw fetch к llm.kosov.online (LiteLLM proxy, OpenAI-compatible).
 *
 * Models: "smart" (MiniMax-M3, code), "fast" (MiniMax-M2.1-highspeed, лёгкий).
 *
 * LiteLLM может вернуть либо JSON, либо SSE. Парсим оба.
 */

type Model = 'smart' | 'fast';

type LiveLLMClientDeps = {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly defaultModel: Model;
  readonly defaultThinking: 'low' | 'high';
};

const make = (deps: LiveLLMClientDeps): Context.Tag.Service<typeof LLMClient> => ({
  streamCompletion: (req: CompletionRequest) =>
    Effect.gen(function* () {
      const modelName = req.model ?? deps.defaultModel;
      const messages = [
        ...(req.systemPrompt ? [{ role: 'system' as const, content: req.systemPrompt }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      // Получаем thinking preference из метаданных запроса (если есть).
      const thinkingRaw = (req as { thinking?: 'low' | 'high' | 'off' }).thinking;
      const includeReasoning = thinkingRaw !== 'off';
      const reasoningEffort = thinkingRaw === 'high' ? 'high' : 'low';

      // max_tokens must cover BOTH reasoning_content and message.content.
      // MiniMax-M3 is a reasoning model (always emits reasoning_content even
      // without reasoning_effort). With max_tokens=2000 the reasoning ate
      // the whole budget and the user got an empty message.content
      // ("ИИ вернул пустой ответ"). 16000 leaves headroom for both.
      const requestBody: Record<string, unknown> = {
        model: modelName,
        messages,
        stream: false,
        temperature: 0.3,
        max_tokens: 16000,
      };
      if (includeReasoning) {
        requestBody.reasoning_effort = reasoningEffort;
      }

      console.log('[llm] → request', {
        model: modelName,
        messages: messages.length,
        reasoning_effort: includeReasoning ? reasoningEffort : '(off)',
      });

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${deps.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${deps.apiKey}`,
            },
            body: JSON.stringify(requestBody),
          }),
        catch: (err) => classifyLLMTransportError(err, deps.apiUrl),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => '',
        }).pipe(Effect.catchAll(() => Effect.succeed('')));
        const errMsg = classifyLLMHttpError(response.status, text);
        console.error('[llm] ✗ HTTP error', errMsg);
        return yield* Effect.fail(new Error(errMsg));
      }
      if (!response.body) {
        const errMsg = 'LLM response has no body';
        console.error('[llm] ✗ no body');
        return yield* Effect.fail(new Error(errMsg));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const chunk = yield* Effect.tryPromise(() => reader.read());
        if (chunk.done) {
          done = true;
          break;
        }
        if (chunk.value) {
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      }
      buffer += decoder.decode();

      console.log('[llm] ← response', {
        status: response.status,
        bodyLength: buffer.length,
        bodyPreview: buffer.slice(0, 200),
      });

      if (!buffer.trim()) {
        const errMsg = 'LLM returned empty body (no chunks)';
        console.error('[llm] ✗', errMsg);
        return yield* Effect.fail(new Error(errMsg));
      }

      let content = '';
      let reasoningContent = '';
      try {
        const parsed = JSON.parse(buffer) as {
          choices?: { message?: { content?: string; reasoning_content?: string } }[];
          error?: { message?: string };
        };
        if (parsed.error) {
          const errMsg = `LLM API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`;
          console.error('[llm] ✗', errMsg);
          return yield* Effect.fail(new Error(errMsg));
        }
        content = parsed.choices?.[0]?.message?.content ?? '';
        reasoningContent = parsed.choices?.[0]?.message?.reasoning_content ?? '';
      } catch {
        const sseContent: string[] = [];
        for (const line of buffer.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]' || !data) continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) sseContent.push(delta);
          } catch {
            // skip malformed line
          }
        }
        content = sseContent.join('');
      }

      console.log('[llm] ✓ content length:', content.length, 'reasoning length:', reasoningContent.length);

      if (!content) {
        // Reasoning may have eaten the budget. Surface reasoning_content
        // length in the error so the operator can see this is a token-budget
        // issue, not a wrong-model issue.
        const hint = reasoningContent
          ? ` (reasoning used ${reasoningContent.length} chars — likely max_tokens too low)`
          : '';
        return yield* Effect.fail(
          new Error(`LLM returned empty content (parsed but no message body)${hint}`),
        );
      }

      const stream = new ReadableStream<CompletionChunk>({
        start(controller) {
          controller.enqueue({ type: 'text', delta: content });
          controller.close();
        },
      });
      return stream;
    }),
});

/**
 * Translate an HTTP error response from LiteLLM into a single actionable
 * message. We special-case the failure modes we know about so the UI can
 * give a useful hint instead of a raw 400 JSON dump.
 *
 * - 400 {"error":{"type":"no_db_connection",...}} → the bundle's
 *   VITE_LLM_PROXY_KEY does not match LITELLM_MASTER_KEY on angara-1
 *   (or the proxy is starting up and both master_key and DB are unset).
 *   We surface this explicitly because it is silent: the SPA builds
 *   and deploys, the request reaches the proxy, but auth fails because
 *   the key is wrong. See math/wavecode-llm-public-auth-key-mismatch
 *   for the post-mortem.
 * - 401 "Malformed API Key" → key doesn't start with "sk-" (rare; we
 *   already log a warning at boot in this case).
 * - 401 "Authentication Error" → key rejected (rotated? wrong?).
 * - 503 {"error":"auth_not_ready"} → our fail-closed patch on the
 *   proxy is doing its job (master_key+DB both unset). The proxy is
 *   starting up; retry.
 * - everything else: include the raw body (truncated) so the user can
 *   see the upstream error.
 */
const classifyLLMHttpError = (status: number, body: string): string => {
  let parsed: { error?: { type?: string; message?: string; code?: number | string } } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    /* not JSON — fall through to generic */
  }
  const errType = parsed.error?.type;
  const errMsg = parsed.error?.message ?? '';

  if (status === 400 && errType === 'no_db_connection') {
    return (
      `LLM HTTP 400: ${errMsg || 'no_db_connection'}\n` +
      '\n' +
      'Public LiteLLM (llm-proxy-public.service) отклонил ключ: api_key != master_key, ' +
      'поэтому LiteLLM ищет virtual key в Prisma DB, но Prisma отключён в ' +
      'services/llm-proxy.nix (Prisma не работает в Nix store).\n' +
      '\n' +
      'В bundle (ui/.env.local) лежит ключ, который НЕ совпадает с ' +
      'LITELLM_MASTER_KEY на angara-1. Скопируй значение с сервера и обнови .env.local:\n' +
      '  sudo grep ^LITELLM_MASTER_KEY /etc/secrets/llm-proxy/master.key\n' +
      '  cp ui/.env.example ui/.env.local   # if missing\n' +
      '  $EDITOR ui/.env.local             # paste the value, include the sk-litellm- prefix\n' +
      '  ./bin/deploy.sh\n' +
      '\n' +
      'bin/check-llm-key.sh (запускается из deploy.sh) теперь ловит эту ситуацию ДО pnpm build.'
    );
  }

  if (status === 503 && errType === undefined && /auth_not_ready/.test(body)) {
    return (
      `LLM HTTP 503: proxy is starting up (auth_not_ready)\n` +
      '\n' +
      'LiteLLM public instance временно без auth backend (master_key и DB оба не сконфигурены — ' +
      'это бывает во время config reload). Прокси fail-closed возвращает 503 вместо того, ' +
      'чтобы пускать всех как PROXY_ADMIN. Подожди 5-10 секунд и retry.'
    );
  }

  if (status === 401) {
    if (/malformed/i.test(errMsg) || /malformed/i.test(body)) {
      return (
        `LLM HTTP 401: Malformed API Key. Ключ должен начинаться с 'sk-' ` +
        `(например, 'sk-litellm-...'). Проверь ui/.env.local VITE_LLM_PROXY_KEY.`
      );
    }
    return (
      `LLM HTTP 401: Authentication Error. Ключ отклонён прокси. ` +
      `Возможно, LITELLM_MASTER_KEY на angara-1 был rotated. ` +
      `Проверь bin/check-llm-key.sh.`
    );
  }

  if (status === 429) {
    return `LLM HTTP 429: rate-limited by proxy. Подожди и retry.`;
  }

  if (status >= 500) {
    return `LLM HTTP ${status} (upstream/server error): ${errMsg || body.slice(0, 300)}`;
  }

  return `LLM HTTP ${status}: ${body.slice(0, 500)}`;
};

/**
 * Translate the `fetch()` failure into an `Error` whose `message` tells the
 * operator what is wrong without a packet capture.
 *
 * Chromium throws `TypeError: Failed to fetch` for THREE distinct reasons;
 * we can't tell them apart from `err.message` alone, so we list the
 * candidates so the operator can run `curl -X OPTIONS -H 'Origin: …' …`
 * to disambiguate.
 *
 * Non-Chromium browsers throw messages like `NetworkError when attempting
 * to fetch resource.` — same root causes, different surface form.
 */
const classifyLLMTransportError = (err: unknown, apiUrl: string): Error => {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const isFetchFailure = /Failed to fetch|NetworkError|fetch failed|load failed/i.test(rawMsg);
  if (!isFetchFailure) {
    return new Error(`LLM HTTP request failed: ${rawMsg}`);
  }

  const hints: string[] = [];
  try {
    const u = new URL(apiUrl);
    if (
      typeof window !== 'undefined'
      && (window.location.protocol === 'https:' && u.protocol === 'http:'
        || window.location.protocol === 'http:' && u.protocol === 'https:')
    ) {
      hints.push('mixed-content: http/https-protocol mismatch');
    }
    if (typeof window !== 'undefined' && window.location.hostname !== u.hostname) {
      hints.push(`CORS: добавить ${window.location.origin} в proxy.allow_origins`);
    }
  } catch {
    /* apiUrl invalid → leave hints empty */
  }

  return new Error(
    `LLM HTTP request failed: ${rawMsg}${hints.length > 0 ? ` (${hints.join('; ')})` : ''}`,
  );
};

export const makeLiveLLMClient = (
  config: Partial<LiveLLMClientDeps> = {},
): Layer.Layer<LLMClient, never, never> => {
  const apiUrl = config.apiUrl ?? import.meta.env.VITE_LLM_PROXY_URL ?? 'https://llm.kosov.online/v1';
  const apiKey = config.apiKey ?? import.meta.env.VITE_LLM_PROXY_KEY ?? '';
  const defaultModel = (config.defaultModel ?? 'smart') as Model;
  const defaultThinking = config.defaultThinking ?? 'low';

  if (!apiKey) {
    console.warn('[llm] VITE_LLM_PROXY_KEY is not set; LLM calls will fail.');
  } else if (!apiKey.startsWith('sk-')) {
    console.warn(
      `[llm] VITE_LLM_PROXY_KEY does not start with 'sk-' — LiteLLM ` +
      `expects the 'sk-litellm-…' format. If you see "Malformed API ` +
      `Key" 401s, prepend 'sk-litellm-' to the key.\n` +
      `Run bin/check-llm-key.sh before pnpm build to catch this at deploy time.`,
    );
  }

  return Layer.succeed(LLMClient, make({ apiUrl, apiKey, defaultModel, defaultThinking }) as never);
};
