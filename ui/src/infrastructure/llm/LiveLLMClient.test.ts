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
    expect(body['extra_body']).toEqual({ thinking: { type: 'disabled' } });
  });
});