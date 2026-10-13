import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * useTransportAudioSync — swing re-eval trigger.
 *
 * Bug history (packet math/wavecode-swing-live-eval):
 *   installTransportAudioSync раньше подписывался только на cps()
 *   и звал `audio.setCps(c)`. Swing-слайдер двигал UI signal + reducer,
 *   но `audio.eval(swingWrappedSnippet)` никогда не вызывался — Strudel
 *   API не имеет hot-swap для `.swing(...)`, требует полного
 *   `repl.evaluate(snippet)`. Юзер жаловался «swing пропал».
 *
 * Fix: подписка на swingAmount() + swingDivisor() с debounce 100ms,
 * gate `AudioContext.state === 'running'`. Здесь — три ключевых
 * свойства:
 *   1. На изменение swingAmount при running audio → reEval вызван.
 *   2. На suspended/closed audio → reEval НЕ вызван.
 *   3. Skip при suspended (gate не пройден).
 *
 * Тест-стратегия: `vi.resetModules()` даёт чистый модуль с
 * `installed=false`, плюс `vi.doMock('./audioActions', …)` подменяет
 * `reEvalScoreWithTransport` шпионом до динамического импорта
 * useTransportAudioSync. Чтобы не зависеть от реального
 * `AudioEngine.eval` (нужен AudioContext мок), глушим звуковой путь
 * на уровне audioActions.
 */

const installCtx = (state: 'running' | 'suspended' | 'closed'): void => {
  (globalThis as unknown as {
    __wavecodeAudioCtx?: { state: string; currentTime: number };
  }).__wavecodeAudioCtx = { state, currentTime: 0 };
};

const clearCtx = (): void => {
  delete (globalThis as unknown as { __wavecodeAudioCtx?: unknown }).__wavecodeAudioCtx;
};

describe('useTransportAudioSync — swing re-eval gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    clearCtx();
    vi.restoreAllMocks();
  });

  const bootstrap = async (
    ctxState: 'running' | 'suspended' | 'closed' | 'absent',
  ): Promise<ReturnType<typeof vi.fn>> => {
    if (ctxState !== 'absent') installCtx(ctxState);
    else clearCtx();
    const reEvalSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./audioActions', () => ({
      reEvalScoreWithTransport: reEvalSpy,
    }));
    const { installTransportAudioSync, __resetTransportAudioSyncForTesting } = await import(
      './useTransportAudioSync'
    );
    __resetTransportAudioSyncForTesting();
    await import('./transportState');
    installTransportAudioSync();
    return reEvalSpy;
  };

  it('fires reEval when swingAmount changes and ctx is running', async () => {
    const spy = await bootstrap('running');
    const { setSwingAmountLocal } = await import('./transportState');

    setSwingAmountLocal(0.5);
    await new Promise((r) => setTimeout(r, 250));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not fire reEval when ctx is suspended', async () => {
    const spy = await bootstrap('suspended');
    const { setSwingAmountLocal } = await import('./transportState');

    setSwingAmountLocal(0.6);
    await new Promise((r) => setTimeout(r, 250));

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not fire reEval when no AudioContext exists yet', async () => {
    const spy = await bootstrap('absent');
    const { setSwingAmountLocal } = await import('./transportState');

    setSwingAmountLocal(0.4);
    await new Promise((r) => setTimeout(r, 250));

    expect(spy).not.toHaveBeenCalled();
  });

  it('debounces rapid swing drags to a single reEval', async () => {
    const spy = await bootstrap('running');
    const { setSwingAmountLocal } = await import('./transportState');

    setSwingAmountLocal(0.1);
    setSwingAmountLocal(0.2);
    setSwingAmountLocal(0.3);
    setSwingAmountLocal(0.4);
    setSwingAmountLocal(0.5);
    await new Promise((r) => setTimeout(r, 300));

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
