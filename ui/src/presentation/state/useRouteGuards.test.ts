import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';

describe('useRouteGuards — confirm branches + reset/new flows', () => {
  let originalConfirm: typeof window.confirm;
  let reloadSpy: ReturnType<typeof vi.fn>;
  let confirmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    originalConfirm = window.confirm;
    confirmMock = vi.fn<(msg?: string) => boolean>().mockReturnValue(false);
    window.confirm = confirmMock as unknown as typeof window.confirm;
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...window.location, reload: reloadSpy },
    });
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    vi.restoreAllMocks();
  });

  it('confirmNew and confirmReset are pure wrappers over window.confirm', async () => {
    const { useRouteGuards } = await import('./useRouteGuards');
    const { result: guards } = renderHook(() => useRouteGuards());
    guards.confirmNew();
    guards.confirmReset();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(confirmMock.mock.calls[0]![0]).toContain('Создать новую композицию');
    expect(confirmMock.mock.calls[1]![0]).toContain('Сбросить ВСЕ');
  });

  it('onNew is a no-op when user cancels the dialog', async () => {
    confirmMock.mockReturnValue(false);
    const { useRouteGuards } = await import('./useRouteGuards');
    const { result: guards } = renderHook(() => useRouteGuards());
    guards.onNew();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('onResetAll is a no-op when user cancels the dialog', async () => {
    confirmMock.mockReturnValue(false);
    const { useRouteGuards } = await import('./useRouteGuards');
    const { result: guards } = renderHook(() => useRouteGuards());
    guards.onResetAll();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('returned route-guards shape exposes confirmNew, confirmReset, onNew, onResetAll', async () => {
    const { useRouteGuards } = await import('./useRouteGuards');
    const { result: guards } = renderHook(() => useRouteGuards());
    expect(typeof guards.confirmNew).toBe('function');
    expect(typeof guards.confirmReset).toBe('function');
    expect(typeof guards.onNew).toBe('function');
    expect(typeof guards.onResetAll).toBe('function');
  });
});

describe('useRouteGuards — onNew creates and selects a custom preset', () => {
  let originalConfirm: typeof window.confirm;
  let stopAudioSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    originalConfirm = window.confirm;
    window.confirm = vi.fn<typeof window.confirm>().mockReturnValue(true) as unknown as typeof window.confirm;
    stopAudioSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./audioActions', () => ({
      stopAudio: stopAudioSpy,
      evalScore: vi.fn().mockResolvedValue(undefined),
    }));
    // Avoid the heavy Effect/Repo pipeline — onResetAll calls it but we only test onNew here.
    vi.doMock('~/infrastructure/composition', () => ({ AppLayer: {} }));
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    vi.doUnmock('./audioActions');
    vi.doUnmock('~/infrastructure/composition');
    vi.restoreAllMocks();
  });

  it('onNew creates a custom preset and selects it (signal + appStore)', async () => {
    const { useRouteGuards } = await import('./useRouteGuards');
    const { setSelectedPresetPersist, getSelectedPresetId } = await import('./selectedPreset');
    const { appStore } = await import('./appStore');
    const { allPresets } = await import('./presetsStore');

    // Pre-seed: pretend the user was on a built-in before pressing "Новая"
    setSelectedPresetPersist('creep');
    expect(getSelectedPresetId()).toBe('creep');

    const { result: guards } = renderHook(() => useRouteGuards());
    guards.onNew();

    // Audio was stopped synchronously (then a void promise runs).
    expect(stopAudioSpy).toHaveBeenCalled();

    // A new custom-* preset was created with the default name and template score.
    const customs = allPresets().filter((p) => p.custom);
    expect(customs).toHaveLength(1);
    const created = customs[0]!;
    expect(created.id).toMatch(/^custom-/);
    expect(created.name).toBe('Новая композиция');
    expect(created.score).toContain('Начни новую композицию');

    // The selected preset signal points at the new composition (NOT 'creep').
    expect(getSelectedPresetId()).toBe(created.id);

    // appStore.activePresetId is in sync with the signal.
    expect(appStore.activePresetId).toBe(created.id);

    // appStore.score holds the template (replaceScore was dispatched).
    expect(appStore.score).toBe(created.score);
  });

  it('onNew dialog thread is cleared (no leaking messages from the previous preset)', async () => {
    const { useRouteGuards } = await import('./useRouteGuards');
    const { appStore, dispatch } = await import('./appStore');

    const { result: guards } = renderHook(() => useRouteGuards());

    // Seed dialogs on 'creep' so we can verify they're not glued onto the new thread.
    dispatch({ type: 'userMessage', text: 'old message on creep' });
    expect(appStore.dialogs['creep']?.length).toBe(1);

    guards.onNew();

    // clearMessages — dialogues должен быть сброшен. На новом preset
    // уже пустой (switchPreset инициализирует dialogs[id] = []),
    // а clearMessages обнуляет activePresetId — теперь это custom-*,
    // так что глобально чистый.
    const activeId = appStore.activePresetId;
    expect(activeId).toMatch(/^custom-/);
    expect(appStore.dialogs[activeId]).toEqual([]);
  });
});
