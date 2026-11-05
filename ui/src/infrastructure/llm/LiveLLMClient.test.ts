import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { LLMClient, type CompletionChunk } from '~/domain/services';
import { makeLiveLLMClient } from './LiveLLMClient';

/**
 * LiveLLMClient.streamCompletion — streaming + JSON-fallback contracts.
 *
 * We stub `globalThis.fetch` with a fake that yields a sequence of
 * Uint8Array chunks; the production code reads them through the
 * ReadableStream's reader and dispatches one `CompletionChunk` per
 * `delta.content` field. Each test asserts a specific behaviour
 * (multi-chunk SSE, single-chunk JSON fallback, malformed line skip,
 * [DONE] terminator, error in stream, etc.).
 */

type FakeResponseInit = {
  status?: number;
  contentType?: string;
  chunks?: ReadonlyArray<string>;
  body?: ReadableStream<Uint8Array>;
};

const fakeResponse = (init: FakeResponseInit): Response => {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? 'text/event-stream';
  const body = init.body ?? (() => {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of init.chunks ?? []) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  })();
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType },
  });
};

const collectChunks = async (
  stream: ReadableStream<CompletionChunk>,
): Promise<ReadonlyArray<CompletionChunk>> => {
  const out: CompletionChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out.push(value);
  }
  return out;
};

const makeRequest = (overrides: Partial<{
  systemPrompt: string;
  messages: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string; id: string; ts: number }>;
  model: 'smart' | 'fast';
  thinking: 'low' | 'high' | 'off';
}> = {}) => ({
  systemPrompt: overrides.systemPrompt ?? 'SYSTEM',
  messages: overrides.messages ?? [
    { role: 'user' as const, content: 'hello', id: 'm1', ts: 0 },
  ],
  model: overrides.model ?? 'fast' as const,
  thinking: overrides.thinking ?? 'low' as const,
});

describe('LiveLLMClient.streamCompletion — SSE streaming', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits one CompletionChunk per delta.content over SSE', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        chunks: [
          'data: {"choices":[{"delta":{"content":"stack("}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"note(\\"c4\\")"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":")"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
      }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        return yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    const chunks = await collectChunks(stream);
    expect(chunks).toEqual([
      { type: 'text', delta: 'stack(' },
      { type: 'text', delta: 'note("c4")' },
      { type: 'text', delta: ')' },
    ]);
  });

  it('returns the first chunk before the stream is closed (perceived-latency)', async () => {
    // Verifies that the ReadableStream emits chunks eagerly — the
    // consumer can call reader.read() once and get the first delta
    // without waiting for the full body. We hand-craft a multi-chunk
    // SSE body and assert the first read returns a single delta.
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        chunks: [
          'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"second"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
      }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        return yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ type: 'text', delta: 'first' });
    await reader.cancel();
  });

  it('falls back to single-chunk JSON when the proxy ignores stream:true', async () => {
    const json = JSON.stringify({
      choices: [{ message: { content: 'note("c4")' } }],
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        contentType: 'application/json',
        chunks: [json],
      }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        return yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    const chunks = await collectChunks(stream);
    expect(chunks).toEqual([{ type: 'text', delta: 'note("c4")' }]);
  });

  it('skips malformed SSE lines without crashing', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        chunks: [
          'data: not json\n\n',
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          '\n',
          'event: foo\n',
          'data: {"choices":[{"delta":{"content":"two"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
      }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        return yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    const chunks = await collectChunks(stream);
    expect(chunks.map((c) => c.delta)).toEqual(['ok', 'two']);
  });

  it('rejects with descriptive HTTP error on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { type: 'auth_error', message: 'Authentication Error' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMClient;
          yield* llm.streamCompletion(makeRequest());
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow(/Authentication Error/);
  });

  it('passes stream: true and the model name in the request body', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'] }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        yield* llm.streamCompletion(makeRequest({ model: 'fast', thinking: 'off' }));
      }).pipe(Effect.provide(layer)),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/chat/completions');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['stream']).toBe(true);
    expect(body['model']).toBe('fast');
    // DeepSeek-профиль (по умолчанию): reasoning_effort едет в extra_body,
    // потому что LiteLLM дропает provider-специфичные поля верхнего уровня.
    // 'off' → 'none': DeepSeek РЕАЛЬНО выключает reasoning на 'none'
    // (замер 2026-11-02: 0 символов reasoning, первый токен через 1.0-1.4 с
    // против 4.6-12.1 с у low/high).
    expect(body['extra_body']).toEqual({ reasoning_effort: 'none' });
    expect(body['reasoning_effort']).toBeUndefined();
  });

  it('encodes the reasoning level into `user` so the proxy cache separates effort levels', async () => {
    // Ключ диск-кэша LiteLLM НЕ включает extra_body: запрос с
    // effort=low, затем с effort=none по тому же промпту → второй вернул
    // кэш за 0.02 с, т.е. отдал ответ, посчитанный с ДРУГИМ уровнем
    // размышления. `user` в ключ входит — поэтому уровень кодируется в
    // него (замер 2026-11-02).
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fakeResponse({ chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'] }),
      ),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    const bodyFor = async (thinking: 'low' | 'high' | 'off'): Promise<Record<string, unknown>> => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMClient;
          yield* llm.streamCompletion(makeRequest({ model: 'fast', thinking }));
        }).pipe(Effect.provide(layer)),
      );
      const calls = fetchMock.mock.calls;
      const [, init] = calls[calls.length - 1] as [string, RequestInit];
      return JSON.parse(init.body as string) as Record<string, unknown>;
    };

    expect((await bodyFor('off'))['user']).toBe('wavecode-effort-none');
    expect((await bodyFor('low'))['user']).toBe('wavecode-effort-low');
    expect((await bodyFor('high'))['user']).toBe('wavecode-effort-high');
  });

  it('passes an AbortSignal so a hung upstream can be cancelled', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fakeResponse({ chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'] }),
      ),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends max_tokens=4000 so reasoning cannot eat the whole budget', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'] }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['max_tokens']).toBe(4000);
  });

  it('maps thinking=high to reasoning_effort=high in extra_body', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'] }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        yield* llm.streamCompletion(makeRequest({ model: 'smart', thinking: 'high' }));
      }).pipe(Effect.provide(layer)),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['extra_body']).toEqual({ reasoning_effort: 'high' });
  });

  it('keeps the MiniMax body shape when the upstream profile is minimax', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ chunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'] }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
      upstream: 'minimax',
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        yield* llm.streamCompletion(makeRequest({ model: 'fast', thinking: 'off' }));
      }).pipe(Effect.provide(layer)),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['extra_body']).toEqual({ thinking: { type: 'disabled' } });
  });

  it('explains an exhausted provider plan instead of blaming the proxy', async () => {
    // Fresh Response per call — a Response body is single-use, so a shared
    // instance would make the second assertion read an empty body.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              type: 'rate_limit_error',
              message:
                'Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage. (2056)',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMClient;
          yield* llm.streamCompletion(makeRequest());
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow(/исчерпан лимит\/баланс upstream-провайдера/);
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMClient;
          yield* llm.streamCompletion(makeRequest());
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.not.toThrow(/rate-limited by proxy/);
  });

  it('reports a provider rate limit as a rate limit, with the reason attached', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { type: 'rate_limit_error', message: 'Too many requests, slow down' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMClient;
          yield* llm.streamCompletion(makeRequest());
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow(/rate limit от провайдера: Too many requests/);
  });

  it('fails loudly when the model spent the whole budget on reasoning', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        chunks: [
          'data: {"choices":[{"delta":{"reasoning_content":"сколько тут ещё Think"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          'data: [DONE]\n\n',
        ],
      }),
    );
    const layer = makeLiveLLMClient({
      apiKey: 'sk-litellm-test',
      apiUrl: 'https://example.test/v1',
    });
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMClient;
        return yield* llm.streamCompletion(makeRequest());
      }).pipe(Effect.provide(layer)),
    );
    await expect(collectChunks(stream)).rejects.toThrow(/лимит токенов исчерпан на размышления/);
  });
});