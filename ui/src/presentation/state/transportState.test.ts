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

  it('setSwingAmountLocal debounces rapid slider drags to single dispatch', async () => {
    const { setSwingAmountLocal } = await import('./transportState');
    const { appStore } = await import('./appStore');

    const initial = appStore.transportState.swingAmount;

    setSwingAmountLocal(0.1);
    setSwingAmountLocal(0.2);
    setSwingAmountLocal(0.3);

    expect(appStore.transportState.swingAmount).toBe(initial);

    await new Promise((r) => setTimeout(r, 200));

    expect(appStore.transportState.swingAmount).toBeCloseTo(0.3, 5);
  }, 5000);

  it('setSwingAmountLocal clamps to [0, 1]', async () => {
    const { setSwingAmountLocal } = await import('./transportState');
    const { appStore } = await import('./appStore');

    setSwingAmountLocal(2.5);
    await new Promise((r) => setTimeout(r, 200));
    expect(appStore.transportState.swingAmount).toBe(1);

    setSwingAmountLocal(-0.5);
    await new Promise((r) => setTimeout(r, 200));
    expect(appStore.transportState.swingAmount).toBe(0);
  }, 5000);

  it('setSwingDivisorLocal dispatches synchronously (no debounce)', async () => {
    const { setSwingDivisorLocal } = await import('./transportState');
    const { appStore } = await import('./appStore');

    setSwingDivisorLocal('1/3');
    expect(appStore.transportState.swingDivisor).toBe('1/3');
  }, 5000);

  it('swingAmount signal stays in sync when reducer is dispatched externally', async () => {
    const { swingAmount } = await import('./transportState');
    const { dispatch } = await import('./appStore');

    dispatch({ type: 'setSwingAmount', amount: 0.42 });
    expect(swingAmount()).toBeCloseTo(0.42, 5);
  });

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

