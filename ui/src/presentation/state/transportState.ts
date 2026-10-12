import { createSignal, createEffect, createRoot, untrack } from 'solid-js';
import { dispatch, appStore } from './appStore';
import type { TransportState } from '~/domain/types';

/**
 * Presentation-layer signals for transport (cps, swingAmount, swingDivisor).
 *
 * Read source of truth: `appStore.transportState` (Solid store, reducer).
 * Local signals mirror the store on init and on subsequent reducer updates,
 * so the UI (slider, button) can be driven imperatively without rerunning
 * the whole reactive graph on every input event.
 *
 * Sync path:
 *   - UI → reducer (debounced 100ms — slider drags fire rapid events).
 *   - cps → AudioEngine.setCps — реализован ОТДЕЛЬНО в `App.tsx` через
 *     `useTransportAudioSync()`, чтобы изолировать тесты от
 *     Effect.runPromise.
 */

const SYNC_DEBOUNCE_MS = 100;

const initialTransport = (): TransportState => ({
  cps: appStore.transportState.cps,
  swingAmount: appStore.transportState.swingAmount,
  swingDivisor: appStore.transportState.swingDivisor,
});

export const [cps, setCpsSignal] = createSignal<number>(initialTransport().cps);
export const [swingAmount, setSwingAmountSignal] = createSignal<number>(initialTransport().swingAmount);
export const [swingDivisor, setSwingDivisorSignal] = createSignal<string>(initialTransport().swingDivisor);

/** Apply a TransportState seeded from the store (используется App.tsx). */
export const syncFromReducer = (next: TransportState): void => {
  setCpsSignal(next.cps);
  setSwingAmountSignal(next.swingAmount);
  setSwingDivisorSignal(next.swingDivisor);
};

let pendingDispatchCps: number | null = null;
let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

const flushDispatch = (): void => {
  dispatchTimer = null;
  if (pendingDispatchCps === null) return;
  const value = pendingDispatchCps;
  pendingDispatchCps = null;
  dispatch({ type: 'setCps', cps: value });
};

export const setCpsLocal = (next: number): void => {
  setCpsSignal(next);
  pendingDispatchCps = next;
  if (dispatchTimer !== null) clearTimeout(dispatchTimer);
  dispatchTimer = setTimeout(flushDispatch, SYNC_DEBOUNCE_MS);
};

let pendingSwingAmount: number | null = null;
let swingDispatchTimer: ReturnType<typeof setTimeout> | null = null;
const flushSwingDispatch = (): void => {
  swingDispatchTimer = null;
  if (pendingSwingAmount === null) return;
  const value = pendingSwingAmount;
  pendingSwingAmount = null;
  dispatch({ type: 'setSwingAmount', amount: value });
};

/** Imperative setter for swing amount. Debounced 100ms. */
export const setSwingAmountLocal = (next: number): void => {
  const clamped = Math.max(0, Math.min(1, next));
  setSwingAmountSignal(clamped);
  pendingSwingAmount = clamped;
  if (swingDispatchTimer !== null) clearTimeout(swingDispatchTimer);
  swingDispatchTimer = setTimeout(flushSwingDispatch, SYNC_DEBOUNCE_MS);
};

export const setSwingDivisorLocal = (divisor: string): void => {
  setSwingDivisorSignal(divisor);
  dispatch({ type: 'setSwingDivisor', divisor });
};

createRoot((d) => {
  createEffect(() => {
    const t = appStore.transportState;
    if (t.cps !== untrack(cps)) setCpsSignal(t.cps);
    if (t.swingAmount !== untrack(swingAmount)) setSwingAmountSignal(t.swingAmount);
    if (t.swingDivisor !== untrack(swingDivisor)) setSwingDivisorSignal(t.swingDivisor);
  });
  if (import.meta.hot) {
    import.meta.hot.dispose(() => d());
  }
});
