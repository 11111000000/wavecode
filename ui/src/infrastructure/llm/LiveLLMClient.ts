import { Effect, Layer, type Context } from 'effect';
import { LLMClient, type CompletionRequest, type CompletionChunk } from '~/domain/services';

/**
 * Live LLM client — real @ai-sdk/openai-compatible → llm.kosov.online.
 *
 * Per-app LiteLLM key (sk-litellm-...) baked into bundle via VITE_LLM_PROXY_KEY.
 * Keys are scoped + revocable. See ~/Projects/AngaraConfig/KB/50_operations/llm-proxy.md.
 *
 * Models exposed by proxy:
 *   - "smart"  → MiniMax-M3 (heavy, slower, better for code)
 *   - "fast"   → MiniMax-M2.1-highspeed (light, faster)
 *
 * LiteLLM возвращает SSE streaming даже при stream: false. Поэтому мы
 * всегда читаем до конца stream и парсим оба формата: JSON и SSE.
 */

type LiveLLMClientDeps = {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly defaultModel: 'smart' | 'fast';
};

const make = (deps: LiveLLMClientDeps): Context.Tag.Service<typeof LLMClient> => ({
  streamCompletion: (req: CompletionRequest) =>
    Effect.gen(function* () {
      const modelName = req.model ?? deps.defaultModel;
      const messages = [
        ...(req.systemPrompt ? [{ role: 'system' as const, content: req.systemPrompt }] : []),
        ...req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${deps.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${deps.apiKey}`,
            },
            body: JSON.stringify({
              model: modelName,
              messages,
              stream: false,
              temperature: 0.3,
              max_tokens: 2000,
            }),
          }),
        catch: (err) => new Error(`LLM HTTP request failed: ${err instanceof Error ? err.message : String(err)}`),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => '',
        }).pipe(Effect.catchAll(() => Effect.succeed('')));
        return yield* Effect.fail(
          new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`),
        );
      }
      if (!response.body) {
        return yield* Effect.fail(new Error('LLM response has no body'));
      }

      // Читаем ВСЕ chunks до полного завершения.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = yield* Effect.tryPromise(() => reader.read());
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }
      }
      // Финальный flush
      buffer += decoder.decode();

      // Пробуем JSON. Если failed — парсим SSE.
      let content = '';
      try {
        const parsed = JSON.parse(buffer) as {
          choices?: { message?: { content?: string } }[];
        };
        content = parsed.choices?.[0]?.message?.content ?? '';
      } catch {
        // Парсим SSE: строки "data: {...}\n\n" — последний "data: [DONE]"
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

      const stream = new ReadableStream<CompletionChunk>({
        start(controller) {
          if (content) {
            controller.enqueue({ type: 'text', delta: content });
          }
          controller.close();
        },
      });
      return stream;
    }),
});

export const makeLiveLLMClient = (
  config: Partial<LiveLLMClientDeps> = {},
): Layer.Layer<LLMClient, never, never> => {
  const apiUrl = config.apiUrl ?? import.meta.env.VITE_LLM_PROXY_URL ?? 'https://llm.kosov.online/v1';
  const apiKey = config.apiKey ?? import.meta.env.VITE_LLM_PROXY_KEY ?? '';
  const defaultModel = config.defaultModel ?? 'smart';

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[wavecode llm] VITE_LLM_PROXY_KEY is not set; LLM calls will fail. Set it in ui/.env.local before building.',
    );
  }

  return Layer.succeed(LLMClient, make({ apiUrl, apiKey, defaultModel }) as never);
};