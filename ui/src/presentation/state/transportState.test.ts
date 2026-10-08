import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('transportState — debounce & reducer sync', () => {
  beforeEach(() => {
    // Reset transport state modules per test — top-level signals + createRoot
    // populate once on import; resetModules гарантирует чистый slate.
    vi.resetModules();
  });

  afterEach(() => {
    // Ничего — реальные таймеры (с async wait) не нужно чистить.
  });

  it('setCpsLocal debounces rapid slider changes to a single reducer dispatch', async () => {
    const { setCpsLocal } = await import('./transportState');
    const { appStore } = await import('./appStore');

    const initial = appStore.transportState.cps;

    // Имитируем быстрый drag слайдера: пять «input» событий в одном кадре.
    setCpsLocal(0.55);
    setCpsLocal(0.6);
    setCpsLocal(0.65);
    setCpsLocal(0.7);
    setCpsLocal(0.75);

    // До истечения debounce — store ещё не обновился.
    expect(appStore.transportState.cps).toBe(initial);

    // Ждём debounce + запас — реальные таймеры, 100ms debounce.
    await new Promise((r) => setTimeout(r, 200));

    // После debounce — в store ровно последнее значение.
    expect(appStore.transportState.cps).toBe(0.75);
  }, 5000);

  it('toggleSwingLocal synchronously dispatches reducer (no debounce)', async () => {
    const { toggleSwingLocal } = await import('./transportState');
    const { appStore } = await import('./appStore');

    const start = appStore.transportState.swing;

    toggleSwingLocal();

    // Без задержки — store обновился сразу.
    expect(appStore.transportState.swing).toBe(!start);

    // Повторный toggle — обратно.
    toggleSwingLocal();
    expect(appStore.transportState.swing).toBe(start);
  }, 5000);

  it('cps signal stays in sync when reducer is dispatched externally', async () => {
    const { cps } = await import('./transportState');
    const { dispatch } = await import('./appStore');

    dispatch({ type: 'setCps', cps: 1.25 });
    expect(cps()).toBe(1.25);

    dispatch({ type: 'setCps', cps: 0.85 });
    expect(cps()).toBe(0.85);
  });

  it('setCpsLocal accepts values across the documented slider range', async () => {
    const { setCpsLocal } = await import('./transportState');
    const { appStore } = await import('./appStore');

    setCpsLocal(0.05);
    await new Promise((r) => setTimeout(r, 200));
    expect(appStore.transportState.cps).toBe(0.05);

    setCpsLocal(2.0);
    await new Promise((r) => setTimeout(r, 200));
    expect(appStore.transportState.cps).toBe(2.0);

    setCpsLocal(1.0);
    await new Promise((r) => setTimeout(r, 200));
    expect(appStore.transportState.cps).toBe(1.0);
  }, 5000);
});

