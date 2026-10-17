import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';

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
        audioRunning: () => false,
      }),
    }));
    vi.doMock('./useAutoSave', () => ({ useAutoSave: () => undefined }));
    const { useBootstrap } = await import('./useBootstrap');
    const { result } = renderHook(() => useBootstrap());
    expect(typeof result.ctxState).toBe('function');
    expect(result.ctxState()).toEqual({ state: 'uninitialized', sampleRate: null });
    expect(result.audioRunning()).toBe(false);
  });

  it('returns ctxState + audioRunning from useAppBootstrap when ctx is suspended', async () => {
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'suspended', sampleRate: 44100 }),
        audioRunning: () => false,
      }),
    }));
    vi.doMock('./useAutoSave', () => ({ useAutoSave: () => undefined }));
    const { useBootstrap } = await import('./useBootstrap');
    const { result } = renderHook(() => useBootstrap());
    expect(result.ctxState().state).toBe('suspended');
    expect(result.ctxState().sampleRate).toBe(44100);
    expect(result.audioRunning()).toBe(false);
  });

  it('returns ctxState + audioRunning from useAppBootstrap when ctx is running', async () => {
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'running', sampleRate: 48000 }),
        audioRunning: () => true,
      }),
    }));
    vi.doMock('./useAutoSave', () => ({ useAutoSave: () => undefined }));
    const { useBootstrap } = await import('./useBootstrap');
    const { result } = renderHook(() => useBootstrap());
    expect(result.ctxState().state).toBe('running');
    expect(result.audioRunning()).toBe(true);
  });

  it('invokes useAutoSave on each mount', async () => {
    const autoSaveSpy = vi.fn();
    vi.doMock('./useAutoSave', () => ({ useAutoSave: autoSaveSpy }));
    vi.doMock('./useAppBootstrap', () => ({
      useAppBootstrap: () => ({
        ctxState: () => ({ state: 'uninitialized', sampleRate: null }),
        audioRunning: () => false,
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
        audioRunning: () => false,
      }),
    }));
    const { useBootstrap } = await import('./useBootstrap');
    renderHook(() => useBootstrap());
    expect(autoSaveSpy).toHaveBeenCalledTimes(1);
  });
});
