/**
 * Playwright storageState that marks the site terms as accepted.
 *
 * Every e2e spec runs in a fresh browser context, so `localStorage`
 * starts empty and the blocking consent gate
 * (decisions/wavecode-disclaimer-gate.yaml) would sit on top of the app
 * under test. Seeding the acceptance at context creation keeps the specs
 * exercising the product instead of the gate — the gate's own behaviour
 * is covered by `src/presentation/components/DisclaimerGate.test.tsx`.
 *
 * Caveat: this seeds once, at context creation. A spec that calls
 * `localStorage.clear()` and then reloads drops it — which is why
 * `preset-id-hydration.spec.mjs` clears the app keys by name rather
 * than wiping the whole store.
 */
export const acceptedTermsStorageState = (origin: string) => ({
  cookies: [],
  origins: [
    {
      origin,
      localStorage: [{ name: 'wavecodeTermsAccepted', value: 'v1' }],
    },
  ],
});