/**
 * Playwright `storageState` that pre-accepts everything a first-time
 * visitor is asked to accept.
 *
 * Every e2e spec runs in a fresh browser context, so `localStorage`
 * starts empty. Two first-run surfaces would then sit on top of the
 * app under test:
 *
 *   1. The terms/disclaimer consent gate — a blocking overlay
 *      (see decisions/wavecode-disclaimer-gate.yaml).
 *   2. The welcome/onboarding tour — a pointer-event-capturing overlay
 *      that intercepts clicks on anything underneath it
 *      (`wavecode-onboarding-complete-v1`, see tourState.ts).
 *
 * Both are seeded here so the specs exercise the product rather than
 * the onboarding path. The gate's own behaviour is covered by
 * `src/presentation/components/DisclaimerGate.test.tsx` and the tour's
 * by `src/presentation/components/tour/tourState.test.ts`.
 *
 * Caveat: this seeds once, at context creation. A spec that calls
 * `localStorage.clear()` and then reloads drops it — which is why
 * `preset-id-hydration.spec.mjs` clears the app keys by name rather
 * than wiping the whole store.
 */
export const appStorageState = (origin: string) => ({
  cookies: [],
  origins: [
    {
      origin,
      localStorage: [
        { name: 'wavecodeTermsAccepted', value: 'v1' },
        { name: 'wavecode-onboarding-complete-v1', value: 'true' },
      ],
    },
  ],
});
