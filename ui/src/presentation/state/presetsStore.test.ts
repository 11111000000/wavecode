import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BUILTIN_PRESETS } from '~/domain/presets';

describe('presetsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('allPresets() returns BUILTIN_PRESETS when no custom presets are saved', async () => {
    const { allPresets } = await import('./presetsStore');
    const presets = allPresets();
    expect(presets.length).toBe(BUILTIN_PRESETS.length);
    expect(presets.every((p) => !p.custom)).toBe(true);
    expect(localStorage.getItem('wavecode-custom-presets-v1')).toBeNull();
  });

  it('saveCustomPreset adds the preset to allPresets and to localStorage', async () => {
    const { allPresets, saveCustomPreset } = await import('./presetsStore');
    const saved = saveCustomPreset('My Song', 's("bd*4")');
    expect(saved.id).toMatch(/^custom-/);
    expect(saved.name).toBe('My Song');
    expect(saved.score).toBe('s("bd*4")');
    expect(saved.custom).toBe(true);

    const presets = allPresets();
    expect(presets.length).toBe(BUILTIN_PRESETS.length + 1);
    expect(presets.some((p) => p.id === saved.id)).toBe(true);

    const raw = localStorage.getItem('wavecode-custom-presets-v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Array<{ id: string; name: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(saved.id);
  });

  it('saveCustomPreset trims the name and falls back to "Без названия" when empty', async () => {
    const { saveCustomPreset } = await import('./presetsStore');
    const empty = saveCustomPreset('   ', 's("bd")');
    expect(empty.name).toBe('Без названия');
    const trimmed = saveCustomPreset('  hi  ', 's("bd")');
    expect(trimmed.name).toBe('hi');
  });

  it('getPreset("creep") returns the Creep builtin', async () => {
    const { getPreset } = await import('./presetsStore');
    const creep = getPreset('creep');
    expect(creep).toBeDefined();
    expect(creep?.name).toBe('Creep');
    expect(creep?.artist).toBe('Radiohead');
    expect(creep?.score).toContain('note(');
  });

  it('getPreset("nonexistent") returns undefined', async () => {
    const { getPreset } = await import('./presetsStore');
    expect(getPreset('nonexistent')).toBeUndefined();
  });

  it('getPreset resolves a saved custom preset', async () => {
    const { saveCustomPreset, getPreset } = await import('./presetsStore');
    const saved = saveCustomPreset('Sketch', 'note("c4 e4 g4")');
    const fetched = getPreset(saved.id);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('Sketch');
    expect(fetched?.custom).toBe(true);
  });

  it('deleteCustomPreset removes the preset from allPresets and from localStorage', async () => {
    const { saveCustomPreset, deleteCustomPreset, allPresets } = await import('./presetsStore');
    const saved = saveCustomPreset('To delete', 's("bd")');
    expect(allPresets().length).toBe(BUILTIN_PRESETS.length + 1);

    deleteCustomPreset(saved.id);
    expect(allPresets().length).toBe(BUILTIN_PRESETS.length);
    expect(allPresets().some((p) => p.id === saved.id)).toBe(false);

    const raw = localStorage.getItem('wavecode-custom-presets-v1');
    expect(JSON.parse(raw!)).toHaveLength(0);
  });

  it('deleteCustomPreset is a no-op for a non-existent id', async () => {
    const { deleteCustomPreset, allPresets } = await import('./presetsStore');
    expect(() => deleteCustomPreset('does-not-exist')).not.toThrow();
    expect(allPresets().length).toBe(BUILTIN_PRESETS.length);
  });

  it('resetAllBrowserData clears custom presets, llm settings, and ui state', async () => {
    const { saveCustomPreset, resetAllBrowserData, allPresets } = await import('./presetsStore');
    saveCustomPreset('A', 's("bd")');
    saveCustomPreset('B', 's("sd")');
    localStorage.setItem('wavecode-ui-state-v1', '{"foo":1}');
    localStorage.setItem('wavecode-llm-settings-v1', '{"model":"fast"}');
    localStorage.setItem('unrelated-key', 'keep me');

    expect(allPresets().length).toBe(BUILTIN_PRESETS.length + 2);

    resetAllBrowserData();

    expect(localStorage.getItem('wavecode-ui-state-v1')).toBeNull();
    expect(localStorage.getItem('wavecode-llm-settings-v1')).toBeNull();
    expect(localStorage.getItem('wavecode-custom-presets-v1')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep me');
    expect(allPresets().length).toBe(BUILTIN_PRESETS.length);
  });

  it('custom presets survive a fresh module load (localStorage persistence)', async () => {
    const { saveCustomPreset } = await import('./presetsStore');
    const saved = saveCustomPreset('Persisted', 's("bd")');

    vi.resetModules();
    const { allPresets: reloaded } = await import('./presetsStore');
    const list = reloaded();
    expect(list.length).toBe(BUILTIN_PRESETS.length + 1);
    expect(list.some((p) => p.id === saved.id)).toBe(true);
  });

  it('falls back to builtins when localStorage holds invalid JSON', async () => {
    localStorage.setItem('wavecode-custom-presets-v1', '{not valid json');
    const { allPresets } = await import('./presetsStore');
    expect(allPresets().length).toBe(BUILTIN_PRESETS.length);
  });

  it('drops custom presets whose name shadows a builtin on load', async () => {
    // Stale custom preset saved from an older version of a builtin.
    // (Using 'Creep' as the shadow since it's a current builtin.)
    localStorage.setItem(
      'wavecode-custom-presets-v1',
      JSON.stringify([
        { id: 'custom-stale', name: 'Creep', score: 'old code', custom: true },
        { id: 'custom-fresh', name: 'My Sketch', score: 's("bd")', custom: true },
      ]),
    );
    const { allPresets } = await import('./presetsStore');
    const list = allPresets();
    // 'Creep' builtin remains, but the custom 'Creep' is dropped.
    expect(list.filter((p) => p.name === 'Creep')).toHaveLength(1);
    expect(list.some((p) => p.id === 'custom-stale')).toBe(false);
    expect(list.some((p) => p.id === 'custom-fresh')).toBe(true);

    // localStorage is also updated so the stale entry doesn't return.
    const raw = localStorage.getItem('wavecode-custom-presets-v1');
    const stored = JSON.parse(raw!) as Array<{ id: string }>;
    expect(stored.some((p) => p.id === 'custom-stale')).toBe(false);
    expect(stored.some((p) => p.id === 'custom-fresh')).toBe(true);
  });

  it('addCustomPreset creates a custom preset with default name "Новая композиция"', async () => {
    const { addCustomPreset, allPresets } = await import('./presetsStore');
    const { NEW_COMPOSITION_DEFAULT_NAME } = await import('./presetsStore');
    const created = addCustomPreset('s("bd*4")');
    expect(created.custom).toBe(true);
    expect(created.id).toMatch(/^custom-/);
    expect(created.name).toBe(NEW_COMPOSITION_DEFAULT_NAME);
    expect(created.score).toBe('s("bd*4")');
    expect(allPresets().some((p) => p.id === created.id)).toBe(true);
  });

  it('addCustomPreset appends a numeric suffix when the bare name is taken', async () => {
    const { addCustomPreset, saveCustomPreset } = await import('./presetsStore');
    const { NEW_COMPOSITION_DEFAULT_NAME } = await import('./presetsStore');
    const first = addCustomPreset('s("bd")');
    expect(first.name).toBe(NEW_COMPOSITION_DEFAULT_NAME);

    // Занимаем вручную "Новая композиция 2"
    saveCustomPreset(`${NEW_COMPOSITION_DEFAULT_NAME} 2`, 's("sd")');
    const third = addCustomPreset('s("hh")');
    expect(third.name).toBe(`${NEW_COMPOSITION_DEFAULT_NAME} 3`);
  });

  it('addCustomPreset increments the suffix until it finds a free slot', async () => {
    const { addCustomPreset, saveCustomPreset } = await import('./presetsStore');
    const { NEW_COMPOSITION_DEFAULT_NAME } = await import('./presetsStore');
    addCustomPreset('s("bd")');                           // "Новая композиция"
    saveCustomPreset(`${NEW_COMPOSITION_DEFAULT_NAME} 2`, 's("sd")');
    saveCustomPreset(`${NEW_COMPOSITION_DEFAULT_NAME} 3`, 's("hh")');
    const created = addCustomPreset('s("cp")');
    expect(created.name).toBe(`${NEW_COMPOSITION_DEFAULT_NAME} 4`);
  });

  it('addCustomPreset is case-insensitive about taken names', async () => {
    const { addCustomPreset, saveCustomPreset } = await import('./presetsStore');
    const { NEW_COMPOSITION_DEFAULT_NAME } = await import('./presetsStore');
    saveCustomPreset(`${NEW_COMPOSITION_DEFAULT_NAME.toUpperCase()}`, 's("bd")');
    const created = addCustomPreset('s("sd")');
    // "НОВАЯ КОМПОЗИЦИЯ" уже занята → ожидаем "Новая композиция 2"
    expect(created.name).toBe(`${NEW_COMPOSITION_DEFAULT_NAME} 2`);
  });

  it('renameCustomPreset updates name + persists to localStorage', async () => {
    const { addCustomPreset, renameCustomPreset, getPreset, allPresets } = await import('./presetsStore');
    const created = addCustomPreset('s("bd")');
    const ok = renameCustomPreset(created.id, 'My Sketch');
    expect(ok).toBe(true);
    expect(getPreset(created.id)?.name).toBe('My Sketch');
    expect(allPresets().find((p) => p.id === created.id)?.name).toBe('My Sketch');

    const raw = localStorage.getItem('wavecode-custom-presets-v1');
    const stored = JSON.parse(raw!) as Array<{ id: string; name: string }>;
    expect(stored.find((p) => p.id === created.id)?.name).toBe('My Sketch');
  });

  it('renameCustomPreset trims whitespace and rejects empty names', async () => {
    const { addCustomPreset, renameCustomPreset, getPreset } = await import('./presetsStore');
    const created = addCustomPreset('s("bd")');
    expect(renameCustomPreset(created.id, '   ')).toBe(false);
    expect(renameCustomPreset(created.id, '  Padded  ')).toBe(true);
    expect(getPreset(created.id)?.name).toBe('Padded');
  });

  it('renameCustomPreset is a no-op for unknown ids', async () => {
    const { renameCustomPreset, allPresets } = await import('./presetsStore');
    const beforeCount = allPresets().length;
    expect(renameCustomPreset('custom-does-not-exist', 'Anything')).toBe(false);
    expect(allPresets().length).toBe(beforeCount);
  });

  it('renameCustomPreset does not write when the name is identical (no-op cheap path)', async () => {
    const { addCustomPreset, renameCustomPreset } = await import('./presetsStore');
    const created = addCustomPreset('s("bd")');
    // Identical name → returns true (UI may use to close the prompt)
    expect(renameCustomPreset(created.id, created.name)).toBe(true);
    // localStorage unchanged in terms of content (still just one entry)
    const raw = localStorage.getItem('wavecode-custom-presets-v1');
    const stored = JSON.parse(raw!) as Array<{ id: string }>;
    expect(stored.filter((p) => p.id === created.id)).toHaveLength(1);
  });
});