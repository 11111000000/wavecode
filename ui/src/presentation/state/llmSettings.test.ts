import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('llmSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('getLLMSettings returns defaults when localStorage is empty', async () => {
    const { getLLMSettings } = await import('./llmSettings');
    expect(getLLMSettings()).toEqual({ model: 'fast', thinking: 'low' });
    expect(localStorage.getItem('wavecode-llm-settings-v1')).toBeNull();
  });

  it('setModel persists and updates getLLMSettings', async () => {
    const { setModel, getLLMSettings } = await import('./llmSettings');
    setModel('fast');
    expect(getLLMSettings()).toEqual({ model: 'fast', thinking: 'low' });

    const raw = localStorage.getItem('wavecode-llm-settings-v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ model: 'fast', thinking: 'low' });
  });

  it('setThinking persists and updates getLLMSettings', async () => {
    const { setThinking, getLLMSettings } = await import('./llmSettings');
    setThinking('high');
    expect(getLLMSettings()).toEqual({ model: 'fast', thinking: 'high' });

    const raw = localStorage.getItem('wavecode-llm-settings-v1');
    expect(JSON.parse(raw!)).toEqual({ model: 'fast', thinking: 'high' });
  });

  it('falls back to defaults when localStorage has invalid JSON', async () => {
    localStorage.setItem('wavecode-llm-settings-v1', '{not valid json');
    const { getLLMSettings } = await import('./llmSettings');
    expect(getLLMSettings()).toEqual({ model: 'fast', thinking: 'low' });
  });

  it('merges partial stored state with defaults', async () => {
    localStorage.setItem('wavecode-llm-settings-v1', JSON.stringify({ model: 'fast' }));
    const { getLLMSettings } = await import('./llmSettings');
    expect(getLLMSettings()).toEqual({ model: 'fast', thinking: 'low' });
  });

  it('chained mutations persist and survive a fresh module load', async () => {
    const { setModel, setThinking, getLLMSettings } = await import('./llmSettings');
    setModel('fast');
    setThinking('high');
    expect(getLLMSettings()).toEqual({ model: 'fast', thinking: 'high' });

    vi.resetModules();
    const { getLLMSettings: reloaded } = await import('./llmSettings');
    expect(reloaded()).toEqual({ model: 'fast', thinking: 'high' });
  });

  it('advertises the models the proxy actually routes to', async () => {
    // 2026-10-26: прокси переключён на DeepSeek. Лейблы 'M3'/'M2.1' и
    // routesTo 'MiniMax-*' были ложью: UI обещал MiniMax, а отдавался
    // DeepSeek. Этот тест — регекс-guard: смена маршрутизации прокси
    // обязана обновлять и подписи в UI.
    const { MODEL_TIERS } = await import('./llmSettings');
    expect(MODEL_TIERS.map((t) => [t.value, t.routesTo])).toEqual([
      ['smart', 'deepseek-v4-pro'],
      ['fast', 'deepseek-flash'],
    ]);
    const joined = MODEL_TIERS.map((t) => `${t.label} ${t.routesTo}`).join(' ');
    expect(joined).not.toMatch(/MiniMax|M3|M2\.1/);
  });

  it('labels the thinking option "off" as minimum, because DeepSeek cannot disable reasoning', async () => {
    const { thinkingLabel } = await import('./llmSettings');
    expect(thinkingLabel('off')).toBe('min');
    expect(thinkingLabel('low')).toBe('low');
    expect(thinkingLabel('high')).toBe('high');
  });
});