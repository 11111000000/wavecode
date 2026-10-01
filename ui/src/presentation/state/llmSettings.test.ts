import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('llmSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('getLLMSettings returns defaults when localStorage is empty', async () => {
    const { getLLMSettings } = await import('./llmSettings');
    expect(getLLMSettings()).toEqual({ model: 'smart', thinking: 'low' });
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
    expect(getLLMSettings()).toEqual({ model: 'smart', thinking: 'high' });

    const raw = localStorage.getItem('wavecode-llm-settings-v1');
    expect(JSON.parse(raw!)).toEqual({ model: 'smart', thinking: 'high' });
  });

  it('falls back to defaults when localStorage has invalid JSON', async () => {
    localStorage.setItem('wavecode-llm-settings-v1', '{not valid json');
    const { getLLMSettings } = await import('./llmSettings');
    expect(getLLMSettings()).toEqual({ model: 'smart', thinking: 'low' });
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

  });