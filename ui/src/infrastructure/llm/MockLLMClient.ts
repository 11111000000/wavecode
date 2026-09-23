import { Effect, Layer } from 'effect';
import { LLMClient, type CompletionRequest, type CompletionChunk } from '~/domain/services';

/**
 * Mock LLM-клиент. Используется пока нет реального @ai-sdk подключения.
 * Возвращает фиксированный ответ, чтобы можно было тестировать wiring.
 */

export const MockLLMClient: Layer.Layer<LLMClient, never, never> = Layer.succeed(
  LLMClient,
  {
    streamCompletion: (_req: CompletionRequest) =>
      Effect.succeed(
        new ReadableStream<CompletionChunk>({
          start(controller) {
            controller.enqueue({
              type: 'text',
              delta: '[mock] Это ответ мокового LLM. Замени на LiveLLMClient для реального стрима.',
            });
            controller.close();
          },
        }),
      ),
  },
);