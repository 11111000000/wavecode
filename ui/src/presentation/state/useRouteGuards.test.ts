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
