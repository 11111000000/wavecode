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
        const errMsg = `LLM HTTP ${response.status}: ${text.slice(0, 500)}`;
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
      `Key" 401s, prepend 'sk-litellm-' to the key.`,
    );
  }

  return Layer.succeed(LLMClient, make({ apiUrl, apiKey, defaultModel, defaultThinking }) as never);
};
