import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';
import { LLMClient, type CompletionChunk, type CompletionRequest } from '~/domain/services';
import {
  applyEditStream,
  applyEdit,
  isScoreBroken,
  SELF_HEAL_RETRY_BUDGET,
  cleanLLMResponse,
  type DialogTurn,
} from './llmEdit';

/**
 * Tests for `applyEditStream` and the self-heal retry budget.
 *
 * We stub the `LLMClient` service with a fake that returns a
 * pre-baked sequence of `ReadableStream<CompletionChunk>` responses
 * (one per call). The fake records every `streamCompletion` call so
 * the retry-budget assertion can count attempts directly.
 */

type FakeResponse = ReadableStream<CompletionChunk>;

const chunk = (delta: string): FakeResponse =>
  new ReadableStream<CompletionChunk>({
    start(controller) {
      controller.enqueue({ type: 'text', delta });
      controller.close();
    },
  });

const sseTokens = (tokens: ReadonlyArray<string>): FakeResponse => {
  const lines = tokens.map((t) => `data: {"choices":[{"delta":{"content":${JSON.stringify(t)}}}]}\n\n`);
  return new ReadableStream<CompletionChunk>({
    start(controller) {
      for (const line of lines) {
        // Each line is its own delta so multi-token scenarios are
        // visible to the callback assertions. We strip the SSE
        // envelope here — production parses it; in the test we
        // already know the shape.
        const payload = line.replace(/^data: /, '').trim();
        const parsed = JSON.parse(payload) as {
          choices: { delta: { content: string } }[];
        };
        controller.enqueue({ type: 'text', delta: parsed.choices[0]!.delta.content });
      }
      controller.close();
    },
  });
};

/**
 * Shared mutable counter for "how many times did streamCompletion fire".
 * Boxed in an object so we can mutate it from inside the layer.
 */
type CallCounter = { count: number; requests: CompletionRequest[] };

const makeFakeLLMLayer = (
  responses: ReadonlyArray<(req: CompletionRequest) => FakeResponse>,
  counter: CallCounter,
): Layer.Layer<LLMClient, never, never> => {
  let idx = 0;
  return Layer.succeed(
    LLMClient,
    {
      streamCompletion: (req: CompletionRequest) => {
        counter.requests.push(req);
        const i = idx;
        idx += 1;
        counter.count = idx;
        return Effect.succeed(responses[i]!(req));
      },
    } as never,
  );
};

const runWithFakeLLM = <A, E>(
  eff: Effect.Effect<A, E, LLMClient>,
  responses: ReadonlyArray<(req: CompletionRequest) => FakeResponse>,
): Promise<{ result: A; counter: CallCounter }> => {
  const counter: CallCounter = { count: 0, requests: [] };
  const layer = makeFakeLLMLayer(responses, counter);
  return Effect.runPromise(
    Effect.provide(eff, layer) as Effect.Effect<A, never, never>,
  ).then((result) => ({ result, counter }));
};

const baseArgs = (currentScore: string, instruction: string) =>
  [currentScore, instruction, [] as ReadonlyArray<DialogTurn>, { status: 'unknown' }, { model: 'fast' as const, thinking: 'low' as const }] as const;

describe('isScoreBroken — AST structural check', () => {
  it('rejects empty string', () => {
    expect(isScoreBroken('')).toEqual({ broken: true, reason: 'empty after cleaning' });
    expect(isScoreBroken('   ')).toEqual({ broken: true, reason: 'empty after cleaning' });
  });

  it('rejects prose with no Strudel calls', () => {
    const result = isScoreBroken('Here is the code: nothing useful');
    expect(result.broken).toBe(true);
    expect(result.reason).toContain('no StackNode/CallNode');
  });

  it('rejects unbalanced parens', () => {
    const result = isScoreBroken('stack(note("c4")');
    expect(result.broken).toBe(true);
    expect(result.reason).toContain('unbalanced parens');
  });

  it('accepts a single Strudel call', () => {
    expect(isScoreBroken('note("c4")')).toEqual({ broken: false, reason: 'ok' });
  });

  it('accepts a multi-row stack', () => {
    expect(isScoreBroken('stack(s("bd*4"), s("sd*2"))')).toEqual({
      broken: false,
      reason: 'ok',
    });
  });
});

describe('applyEditStream — happy path', () => {
  it('returns the cleaned score without retrying when first attempt parses', async () => {
    const { result, counter } = await runWithFakeLLM(
      applyEditStream(...baseArgs('note("c4")', 'no change')),
      [() => chunk('note("c4")')],
    );
    expect(result.score).toBe('note("c4")');
    expect(result.wasHealed).toBe(false);
    expect(result.attempts).toBe(1);
    expect(counter.count).toBe(1);
  });

  it('invokes onToken once per delta then onComplete', async () => {
    const tokens: Array<string> = [];
    let completed: { score: string; wasHealed: boolean; attempts: 1 | 2 } | null = null;
    const eff = applyEditStream(
      ...baseArgs('note("c4")', 'wrap in stack'),
      {
        onToken: (t) => tokens.push(t),
        onComplete: (r) => {
          completed = r;
        },
      },
    );
    // 4 tokens so the joined score is `stack(note("c4"))` — balanced.
    const { result } = await runWithFakeLLM(eff, [
      () => sseTokens(['stack(', 'note("c4"', ')', ')']),
    ]);
    expect(tokens.join('')).toBe('stack(note("c4"))');
    expect(completed).not.toBeNull();
    expect(completed).toEqual(result);
    expect(result.score).toBe('stack(note("c4"))');
  });

  it('streams multiple tokens before completion', async () => {
    const tokens: Array<string> = [];
    const eff = applyEditStream(
      ...baseArgs('note("c4")', 'expand'),
      { onToken: (t) => tokens.push(t) },
    );
    // Tokens that join to a valid `stack(note("c4"))` so the happy
    // path doesn't trip self-heal.
    await runWithFakeLLM(eff, [
      () => sseTokens(['stack(', 'note', '("c4"', ')', ')']),
    ]);
    expect(tokens).toEqual(['stack(', 'note', '("c4"', ')', ')']);
  });

  it('does NOT set lastFailed-equivalent on the result when happy path succeeds', async () => {
    // The UI uses `wasHealed` and `attempts` to decide retry UX.
    // Success path → no toast, no retry button.
    const { result } = await runWithFakeLLM(
      applyEditStream(...baseArgs('note("c4")', 'ok')),
      [() => chunk('note("c4")')],
    );
    expect(result.wasHealed).toBe(false);
    expect(result.attempts).toBe(1);
  });
});

describe('applyEditStream — self-heal retry', () => {
  it('retries once on broken first attempt and returns healed result', async () => {
    const tokens: Array<string> = [];
    const { result, counter } = await runWithFakeLLM(
      applyEditStream(
        ...baseArgs('note("c4")', 'wrap in stack'),
        { onToken: (t) => tokens.push(t) },
      ),
      [
        () => chunk('stack(note("c4"'), // missing ')'
        () => chunk('stack(note("c4"))'), // healed
      ],
    );
    expect(result.score).toBe('stack(note("c4"))');
    expect(result.wasHealed).toBe(true);
    expect(result.attempts).toBe(2);
    expect(counter.count).toBe(2);
    // Tokens from BOTH attempts were forwarded.
    expect(tokens).toEqual(['stack(note("c4"', 'stack(note("c4"))']);
  });

  it('uses the FIX_SYSTEM_PROMPT on retry', async () => {
    const { counter } = await runWithFakeLLM(
      applyEditStream(...baseArgs('note("c4")', 'fix it')),
      [
        () => chunk('stack(note("c4"'),
        () => chunk('stack(note("c4"))'),
      ],
    );
    expect(counter.requests).toHaveLength(2);
    expect(counter.requests[0]?.systemPrompt).toContain('wavecode, AI-ассистент');
    expect(counter.requests[1]?.systemPrompt).toContain('ИСПРАВЛЕННУЮ ВЕРСИЮ');
  });

  it('forwards the broken attempt and parser reason in the retry user prompt', async () => {
    const { counter } = await runWithFakeLLM(
      applyEditStream(...baseArgs('note("c4")', 'wrap')),
      [
        () => chunk('stack(note("c4"'),
        () => chunk('stack(note("c4"))'),
      ],
    );
    const fixMsg = counter.requests[1]?.messages.findLast?.((m) => m.role === 'user');
    // messages is plain — findLast may not exist on older TS lib,
    // so use a manual reverse search.
    const lastUserMsg = [...(counter.requests[1]?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'user');
    expect(lastUserMsg).toBeDefined();
    expect(lastUserMsg?.content).toContain('ТВОЙ ПРЕДЫДУЩИЙ ОТВЕТ');
    expect(lastUserMsg?.content).toContain('stack(note("c4"');
    expect(lastUserMsg?.content).toContain('unbalanced parens');
    void fixMsg;
  });
});

describe('applyEditStream — retry budget = 1', () => {
  it('makes exactly 2 LLM calls when both attempts are broken', async () => {
    const counter: CallCounter = { count: 0, requests: [] };
    const layer = makeFakeLLMLayer(
      [
        () => chunk('stack(note("c4"'), // broken
        () => chunk('also broken ((('), // also broken
      ],
      counter,
    );
    const eff = applyEditStream(...baseArgs('note("c4")', 'do thing'));
    await expect(
      Effect.runPromise(Effect.provide(eff, layer) as Effect.Effect<unknown, never, never>),
    ).rejects.toThrow();
    expect(counter.count).toBe(2);
  });

  it('exports SELF_HEAL_RETRY_BUDGET = 1', () => {
    expect(SELF_HEAL_RETRY_BUDGET).toBe(1);
  });

  it('success path makes exactly 1 LLM call', async () => {
    const { counter } = await runWithFakeLLM(
      applyEditStream(...baseArgs('note("c4")', 'no-op')),
      [() => chunk('note("c4")')],
    );
    expect(counter.count).toBe(1);
  });

  it('budget exhaustion rejects the Effect with a descriptive error', async () => {
    await expect(
      runWithFakeLLM(
        applyEditStream(...baseArgs('note("c4")', 'do thing')),
        [
          () => chunk('stack(note("c4"'),
          () => chunk('still broken (('),
        ],
      ),
    ).rejects.toThrow(/self-heal failed/);
  });
});

describe('applyEdit — back-compat surface', () => {
  it('returns just the cleaned score string (old signature preserved)', async () => {
    const { result } = await runWithFakeLLM(
      applyEdit('note("c4")', 'no change'),
      [() => chunk('note("c4")')],
    );
    expect(result).toBe('note("c4")');
  });

  it('still passes through `cleanLLMResponse` on its existing logic', () => {
    expect(cleanLLMResponse('note("c4")')).toBe('note("c4")');
  });
});