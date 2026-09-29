import { describe, it, expect } from 'vitest';
import { cleanLLMResponse } from './llmEdit';

describe('cleanLLMResponse', () => {
  it('passes through clean JS unchanged', () => {
    const raw = 'stack(\n  s("bd*4")\n)';
    expect(cleanLLMResponse(raw)).toBe(raw);
  });

  it('strips balanced <think>...</think> blocks', () => {
    const raw = '<think>reasoning here</think>\nstack(s("bd"))';
    expect(cleanLLMResponse(raw)).toBe('stack(s("bd"))');
  });

  it('returns empty when <think> is unbalanced (LLM ran out of tokens)', () => {
    const raw = '<think>reasoning without close\nstack(s("bd"))';
    expect(cleanLLMResponse(raw)).toBe('');
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
