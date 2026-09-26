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
 * Default model: "smart" — better for Strudel code generation.
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
              stream: true,
              temperature: 0.3,
              max_tokens: 1500,
              reasoning_effort: 'low',
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const stream = new ReadableStream<CompletionChunk>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            buffer += decoder.decode(value, { stream: true });

            // SSE format: "data: {...}\n\n"
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') {
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data) as {
                  choices?: { delta?: { content?: string } }[];
                };
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  controller.enqueue({ type: 'text', delta });
                }
              } catch {
                // ignore malformed SSE line
              }
            }
          } catch (err) {
            controller.error(err);
          }
        },
        cancel() {
          void reader.cancel();
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