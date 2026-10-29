/**
 * preloadLandingSamples — fire-and-forget sample-bank preload
 * triggered by the Landing page mount.
 *
 * Why this exists: SnippetShowcase renders per-card preview buttons
 * for built-in presets (see `decisions/wavecode-landing-preset-preview`).
 * Three of those presets — Creep, Hip-hop, Trap — depend on sample
 * banks (`drums_bd`, `drums_sd`, `drums_hh`, `drums_crash`,
 * `synth_bass-c2`, etc.). The Strudel live-eval path resolves
 * sound names through `getTrigger`, which throws
 * "sound <X> not found" when the bank has not been registered.
 *
 * Before this commit, `SampleLoader.loadAllSamples()` was wired
 * only to `useAppBootstrap` on the `/#/app` route, so a landing
 * visitor who tapped a sample-based preset preview heard only
 * the synth layer — not the advertised full mix. By triggering
 * the same loader from the Landing page mount, the SW cache and
 * the decode-worker warm-cache get populated during the user's
 * read-through of the marketing surface, and by the time they
 * tap ▶ the bank is registered.
 *
 * Idempotency: `loadAllSamples()` short-circuits on already-loaded
 * banks (see `SampleLoader.ts:586` — `if (state.status === 'loaded')
 * return Promise.resolve()`); the `/#/app` route's `useAppBootstrap`
 * call later in the session is a no-op. This helper does NOT track
 * its own flag — the idempotency lives in SampleLoader.
 *
 * Non-blocking: the dynamic `import()` and the worker-decoded
 * preload both run off the main thread. The Landing page is
 * interactive immediately on mount.
 *
 * Testable in isolation: this module is a one-liner. The unit test
 * in `preloadLandingSamples.test.ts` mocks
 * `~/infrastructure/audio/SampleLoader` and asserts the loader is
 * invoked exactly once per call — no Landing component mount
 * required.
 */
export const preloadLandingSamples = (): void => {
  void import('~/infrastructure/audio/SampleLoader').then((m) => m.loadAllSamples());
};