import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BUILTIN_PRESETS } from '~/domain/presets';

describe('selectedPreset — persist + hydrate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('signal defaults to "creep" when localStorage has no value', async () => {
    const { getSelectedPresetId } = await import('./selectedPreset');
    expect(getSelectedPresetId()).toBe('creep');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBeNull();
  });

  it('signal reads persisted id on cold start (custom-xxx)', async () => {
    localStorage.setItem('wavecode-selected-preset-v1', 'custom-foo');
    vi.resetModules();
    const { getSelectedPresetId } = await import('./selectedPreset');
    expect(getSelectedPresetId()).toBe('custom-foo');
  });

  it('setSelectedPresetPersist updates both signal and localStorage', async () => {
    const { getSelectedPresetId, setSelectedPresetPersist } = await import('./selectedPreset');
    setSelectedPresetPersist('ambient-drone');
    expect(getSelectedPresetId()).toBe('ambient-drone');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('ambient-drone');
  });

  it('setSelectedPresetPersist always writes — even for the default value', async () => {
    // No no-op: a localStorage write is cheap, and the no-op optimization
    // would break the «first-launch writes default» invariant (signal
    // is already = default at module load, so the guard would skip
    // the persist).
    const { getSelectedPresetId, setSelectedPresetPersist } = await import('./selectedPreset');
    setSelectedPresetPersist('creep');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('creep');
    expect(getSelectedPresetId()).toBe('creep');
  });

  it('hydrateSelectedPreset with empty storage → default + persist', async () => {
    const { hydrateSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    hydrateSelectedPreset();
    expect(getSelectedPresetId()).toBe('creep');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('creep');
  });

  it('hydrateSelectedPreset with valid built-in id → adopt (no extra write)', async () => {
    localStorage.setItem('wavecode-selected-preset-v1', 'ambient-drone');
    vi.resetModules();
    const { hydrateSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    hydrateSelectedPreset();
    expect(getSelectedPresetId()).toBe('ambient-drone');
    // localStorage already had the value; no rewrite expected.
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('ambient-drone');
  });

  it('hydrateSelectedPreset with custom-xxx that exists in allPresets → adopt', async () => {
    // Inject a custom preset into localStorage first.
    const custom = { id: 'custom-abc', name: 'Sketch', score: 's("bd")', custom: true };
    localStorage.setItem(
      'wavecode-custom-presets-v1',
      JSON.stringify([custom]),
    );
    localStorage.setItem('wavecode-selected-preset-v1', 'custom-abc');
    vi.resetModules();
    const { hydrateSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    hydrateSelectedPreset();
    expect(getSelectedPresetId()).toBe('custom-abc');
  });

  it('hydrateSelectedPreset with deleted custom-xxx → fallback to default + persist', async () => {
    // localStorage has selectedPreset pointing at a custom that no longer exists.
    localStorage.setItem('wavecode-selected-preset-v1', 'custom-deleted');
    vi.resetModules();
    const { hydrateSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    hydrateSelectedPreset();
    expect(getSelectedPresetId()).toBe('creep');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('creep');
  });

  it('hydrateSelectedPreset does NOT fallback when stored id exists but score diverges', async () => {
    // Load 'ambient-drone' (built-in, then mutate score away from its source).
    localStorage.setItem('wavecode-selected-preset-v1', 'ambient-drone');
    vi.resetModules();
    const { hydrateSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    const { dispatch: dispatchFresh, appStore: freshStore } = await import('./appStore');
    dispatchFresh({ type: 'replaceScore', text: 's("bd")' });
    expect(freshStore.score).toBe('s("bd")');
    hydrateSelectedPreset();
    // «правленый clean» — kept, not fallback to 'creep'.
    expect(getSelectedPresetId()).toBe('ambient-drone');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('ambient-drone');
  });

  it('hydrateSelectedPreset with unknown built-in id → fallback to default', async () => {
    localStorage.setItem('wavecode-selected-preset-v1', 'this-preset-does-not-exist');
    vi.resetModules();
    const { hydrateSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    hydrateSelectedPreset();
    expect(getSelectedPresetId()).toBe('creep');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBe('creep');
  });

  it('resetSelectedPreset removes the key and resets the signal', async () => {
    localStorage.setItem('wavecode-selected-preset-v1', 'ambient-drone');
    vi.resetModules();
    const { resetSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');
    resetSelectedPreset();
    expect(getSelectedPresetId()).toBe('creep');
    // Physical remove, not a write of 'creep' — matches resetAllBrowserData
    // semantics where EVERY localStorage key for the app is wiped.
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBeNull();
  });
});

describe('selectedPreset — integration with resetAllBrowserData', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('App-level onResetAll wipes selectedPreset key alongside custom presets', async () => {
    // Simulate the exact App.tsx onResetAll sequence (without IDB writes
    // and the reload — both side-effects unrelated to this invariant).
    localStorage.setItem('wavecode-selected-preset-v1', 'ambient-drone');
    const { resetAllBrowserData } = await import('./presetsStore');
    const { resetSelectedPreset, getSelectedPresetId } = await import('./selectedPreset');

    resetAllBrowserData();
    resetSelectedPreset();

    expect(getSelectedPresetId()).toBe('creep');
    expect(localStorage.getItem('wavecode-selected-preset-v1')).toBeNull();
    expect(localStorage.getItem('wavecode-custom-presets-v1')).toBeNull();
    expect(localStorage.getItem('wavecode-ui-state-v1')).toBeNull();
  });
});

describe('selectedPreset — BUILTIN_PRESETS sanity', () => {
  it('every preset id has a non-empty score (sanity for hydrate validity)', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.score).toBeTruthy();
    }
  });
});