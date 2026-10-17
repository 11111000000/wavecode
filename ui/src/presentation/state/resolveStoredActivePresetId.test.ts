import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('resolveStoredActivePresetId — validate IDB activePresetId', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('returns "creep" when activeId is null (first-ever launch)', async () => {
    const { resolveStoredActivePresetId } = await import('./selectedPreset');
    expect(resolveStoredActivePresetId(null)).toBe('creep');
  });

  it('returns "creep" when activeId points at a non-existent preset', async () => {
    const { resolveStoredActivePresetId } = await import('./selectedPreset');
    expect(resolveStoredActivePresetId('this-preset-does-not-exist')).toBe('creep');
    expect(resolveStoredActivePresetId('custom-deleted')).toBe('creep');
  });

  it('returns the same id when it resolves to a built-in', async () => {
    const { resolveStoredActivePresetId } = await import('./selectedPreset');
    expect(resolveStoredActivePresetId('creep')).toBe('creep');
  });

  it('returns a custom id when the preset is still present in storage', async () => {
    const custom = { id: 'custom-abc', name: 'Sketch', score: 's("bd")', custom: true };
    localStorage.setItem('wavecode-custom-presets-v1', JSON.stringify([custom]));
    const { resolveStoredActivePresetId } = await import('./selectedPreset');
    expect(resolveStoredActivePresetId('custom-abc')).toBe('custom-abc');
  });
});
