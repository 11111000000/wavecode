import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';

/**
 * useBootstrap — композиция useAppBootstrap + useAutoSave.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): из контракта убран
 * `audioRunning` — производный от состояния AudioContext. Кнопка
 * play/stop и строка состояния читают честный `appStore.audio.status`
 * (см. `audioRunning` в audioActions.ts), а состояние контекста
 * осталось телеметрией в подсказке.
 */
describe('useBootstrap — composes useAppBootstrap + useAutoSave', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ctxState accessor with state and sampleRate fields (parity with useAppBootstrap contract)', async () => {
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'uninitialized', sampleRate: null }),
      }),
    }));
    vi.doMock('./useAutoSave', () => ({ useAutoSave: () => undefined }));
    const { useBootstrap } = await import('./useBootstrap');
    const { result } = renderHook(() => useBootstrap());
    expect(typeof result.ctxState).toBe('function');
    expect(result.ctxState()).toEqual({ state: 'uninitialized', sampleRate: null });
  });

  it('returns ctxState from useAppBootstrap when ctx is suspended', async () => {
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'suspended', sampleRate: 44100 }),
      }),
    }));
    vi.doMock('./useAutoSave', () => ({ useAutoSave: () => undefined }));
    const { useBootstrap } = await import('./useBootstrap');
    const { result } = renderHook(() => useBootstrap());
    expect(result.ctxState().state).toBe('suspended');
    expect(result.ctxState().sampleRate).toBe(44100);
  });

  it('returns ctxState from useAppBootstrap when ctx is running', async () => {
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'running', sampleRate: 48000 }),
      }),
    }));
    vi.doMock('./useAutoSave', () => ({ useAutoSave: () => undefined }));
    const { useBootstrap } = await import('./useBootstrap');
    const { result } = renderHook(() => useBootstrap());
    expect(result.ctxState().state).toBe('running');
  });

  it('invokes useAutoSave on each mount', async () => {
    const autoSaveSpy = vi.fn();
    vi.doMock('./useAutoSave', () => ({ useAutoSave: autoSaveSpy }));
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'uninitialized', sampleRate: null }),
      }),
    }));
    const { useBootstrap } = await import('./useBootstrap');
    renderHook(() => useBootstrap());
    expect(autoSaveSpy).toHaveBeenCalledTimes(1);
  });

  it('does not invoke useAutoSave twice on a single mount', async () => {
    const autoSaveSpy = vi.fn();
    vi.doMock('./useAutoSave', () => ({ useAutoSave: autoSaveSpy }));
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'uninitialized', sampleRate: null }),
      }),
    }));
    const { useBootstrap } = await import('./useBootstrap');
    renderHook(() => useBootstrap());
    expect(autoSaveSpy).toHaveBeenCalledTimes(1);
  });
});
