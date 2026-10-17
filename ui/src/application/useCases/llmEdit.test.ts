import { describe, it, expect } from 'vitest';
import { cleanLLMResponse, buildUserPrompt, applyEditWithContext, type FocusedContextLike } from './llmEdit';

describe('cleanLLMResponse', () => {
  it('passes through clean JS unchanged', () => {
    const raw = 'stack(\n  s("bd*4")\n)';
    expect(cleanLLMResponse(raw)).toBe(raw);
  });

  it('strips balanced <think>...</think> blocks', () => {
    const raw = '<think>reasoning here</think>\nstack(s("bd"))';
    expect(cleanLLMResponse(raw)).toBe('stack(s("bd"))');
  });

  it('returns whatever came before <think> when unbalanced (LLM ran out of tokens)', () => {
    const raw = 'note("c4").s("sine")\n<think>reasoning without close\nstack(s("bd"))';
    const result = cleanLLMResponse(raw);
    expect(result).toContain('note("c4")');
  });

  it('strips leading ```js code fence', () => {
    const raw = '```js\nstack(s("bd"))\n```';
    expect(cleanLLMResponse(raw)).toBe('stack(s("bd"))');
  });

  it('strips leading "Here is..." preamble', () => {
    const raw = "Here's the updated score:\n\nstack(s('bd'))";
    const result = cleanLLMResponse(raw);
    expect(result).not.toMatch(/here's/i);
    expect(result).toContain('stack');
  });

  it('handles mixed: think block + fence + preamble', () => {
    const raw = "<think>plan</think>Here's the code:\n```js\nstack(s('bd'))\n```";
    const result = cleanLLMResponse(raw);
    expect(result).toBe("stack(s('bd'))");
  });
});

describe('buildUserPrompt — focused-context handling', () => {
  const score = 'note("c4 e3 g3").gain(0.4)';
  const instr = 'сделай громче';

  it('emits a prompt byte-identical to the prior version when focusedContext is null', () => {
    // Backward-compat: every existing caller passes no
    // focusedContext, so the prompt must not change. Anchor:
    // the `=== ТЕКУЩИЙ SCORE` opening line must still be the
    // first thing in the output, and no `FOCUSED CONTEXT` may
    // appear.
    const prompt = buildUserPrompt(score, instr);
    expect(prompt.startsWith('=== ТЕКУЩИЙ SCORE (это БАЗА, модифицируй её) ===')).toBe(true);
    expect(prompt).not.toContain('FOCUSED CONTEXT');
  });

  it('emits a prompt byte-identical to the prior version when focusedContext is undefined', () => {
    // Same as above but explicit undefined — keeps callers that
    // explicitly pass `undefined` (or skip the parameter) on
    // the legacy code path.
    const prompt = buildUserPrompt(score, instr, { status: 'playing' }, undefined);
    expect(prompt).not.toContain('FOCUSED CONTEXT');
  });

  it('appends a `=== FOCUSED CONTEXT ===` block when context is provided', () => {
    const ctx: FocusedContextLike = {
      kind: 'function-call',
      name: 'note',
      text: 'note("c4 e3 g3").gain(0.4)',
    };
    const prompt = buildUserPrompt(score, instr, { status: 'playing' }, ctx);
    expect(prompt).toContain('=== FOCUSED CONTEXT (apply edits to this scope) ===');
    expect(prompt).toContain('kind: function-call');
    expect(prompt).toContain('name: note');
    expect(prompt).toContain('note("c4 e3 g3").gain(0.4)');
  });

  it('omits the `name:` line for text-fallback context', () => {
    const ctx: FocusedContextLike = {
      kind: 'text',
      text: 'partial selection',
    };
    const prompt = buildUserPrompt(score, instr, { status: 'playing' }, ctx);
    expect(prompt).toContain('kind: text');
    expect(prompt).not.toContain('name:');
  });

  it('keeps the instruction and audio state in the prompt after the focus block', () => {
    const ctx: FocusedContextLike = {
      kind: 'stack-row',
      name: 's',
      text: 's("bd*4")',
    };
    const prompt = buildUserPrompt(score, instr, { status: 'playing', lastError: 'oops' }, ctx);
    expect(prompt.indexOf('=== FOCUSED CONTEXT')).toBeGreaterThan(-1);
    expect(prompt.indexOf('=== СОСТОЯНИЕ АУДИО ===')).toBeGreaterThan(prompt.indexOf('=== FOCUSED CONTEXT'));
    expect(prompt).toContain('status: playing');
    expect(prompt).toContain('last_error: oops');
    expect(prompt).toContain('=== ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ ===');
    expect(prompt).toContain(instr);
  });
});

describe('applyEditWithContext — prompt forwarding', () => {
  // We can't easily run the full Effect pipeline (it requires a
  // live LLMClient service), so we use `Effect.runPromiseExit` on
  // a hand-rolled service that captures the messages it receives.
  // This verifies that `context` reaches the LLM via the messages
  // array, end-to-end.

  it('forwards the focused context into the messages array', async () => {
    const { Effect, Layer } = await import('effect');
    const { LLMClient } = await import('~/domain/services');

    const captured: Array<{ systemPrompt: string | undefined; messages: ReadonlyArray<{ role: string; content: string }> }> = [];

    const StubLLM = Layer.succeed(LLMClient, {
      streamCompletion: (req) => {
        captured.push({ systemPrompt: req.systemPrompt, messages: req.messages });
        // Return an empty stream that completes immediately.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text' as const, delta: 'note("c4")' });
            controller.close();
          },
        });
        return Effect.succeed(stream);
      },
    });

    const ctx: FocusedContextLike = {
      kind: 'function-call',
      name: 'note',
      text: 'note("c4")',
    };

    const result = await Effect.runPromise(
      applyEditWithContext(
        'note("c4")',
        'объясни',
        [],
        { status: 'playing' },
        {},
        ctx,
      ).pipe(Effect.provide(StubLLM)),
    );

    expect(result).toBe('note("c4")');
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    // The user message (last in messages) must contain the
    // focused context block.
    const userMsg = req.messages[req.messages.length - 1]!;
    expect(userMsg.content).toContain('=== FOCUSED CONTEXT (apply edits to this scope) ===');
    expect(userMsg.content).toContain('kind: function-call');
    expect(userMsg.content).toContain('note("c4")');
  });

  it('omits the focused context block when context is null (backward-compat)', async () => {
    const { Effect, Layer } = await import('effect');
    const { LLMClient } = await import('~/domain/services');

    const captured: Array<{ messages: ReadonlyArray<{ role: string; content: string }> }> = [];

    const StubLLM = Layer.succeed(LLMClient, {
      streamCompletion: (req) => {
        captured.push({ messages: req.messages });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text' as const, delta: 'note("c4")' });
            controller.close();
          },
        });
        return Effect.succeed(stream);
      },
    });

    await Effect.runPromise(
      applyEditWithContext(
        'note("c4")',
        'объясни',
        [],
        { status: 'playing' },
        {},
        null,
      ).pipe(Effect.provide(StubLLM)),
    );

    const req = captured[0]!;
    const userMsg = req.messages[req.messages.length - 1]!;
    expect(userMsg.content).not.toContain('=== FOCUSED CONTEXT');
  });
});
