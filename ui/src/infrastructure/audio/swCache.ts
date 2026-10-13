/**
 * Service Worker cache helpers.
 *
 * `isInServiceWorkerCache(url)` cheaply probes the Cache Storage
 * API without touching the network. The Service Worker (registered
 * by vite-plugin-pwa) precaches JS/CSS/HTML/SVG/PNG/ICO/WOFF2 assets
 * and runtime-caches vendor JS + llm.kosov.online responses; sample
 * MP3 URLs are NOT in `globPatterns` (see vite.config.ts), but the
 * browser still routes them through the SW once installed. So
 * `caches.match()` is a fast pre-check before decoding.
 *
 * The promise-dedupe map (`inFlight`) collapses concurrent calls for
 * the same URL into a single `caches.match()` roundtrip — important
 * because `preloadAllBuffers` runs 24 URLs at concurrency=4 and each
 * URL would otherwise trigger its own cache lookup. We cache the
 * BOOLEAN result (not the Response object) so the map survives a single
 * resolve without holding onto large Response instances.
 *
 * `waitForServiceWorkerReady` resolves `navigator.serviceWorker.ready`
 * with a 2-second timeout. We don't want to block `preloadAllBuffers`
 * on a slow SW activation (cold install can take >1s on first visit).
 * If the SW never becomes ready (no SW registered at all, e.g. dev mode
 * with `devOptions.enabled: false`), we fall through to the timeout
 * branch and resolve with `null`. `preloadAllBuffers` then treats every
 * URL as uncached → it calls `loadBuffer()` as before. No regression.
 */

type SWCacheStore = {
  inFlight: Map<string, Promise<boolean>>;
};

const SW_CACHE_TIMEOUT_MS = 2000;

const store: SWCacheStore = { inFlight: new Map() };

const hasCacheApi = (): boolean =>
  typeof globalThis.caches !== 'undefined'
  && typeof globalThis.caches.keys === 'function'
  && typeof globalThis.caches.open === 'function';

const matchInCache = async (cacheName: string, url: string): Promise<boolean> => {
  if (!hasCacheApi()) return false;
  const cache = await globalThis.caches.open(cacheName);
  const hit = await cache.match(url);
  return hit !== undefined;
};

/**
 * Returns true if `url` is present in any active Cache Storage
 * (precache + runtime caches). Returns false when the Cache API is
 * unavailable (private mode in some browsers, or no SW registered) so
 * `preloadAllBuffers` can fall back to `loadBuffer()`.
 *
 * Multiple concurrent calls for the same URL share one Promise — the
 * underlying `caches.keys()` + `caches.open()` + `cache.match()`
 * roundtrip runs once per URL per call site, not once per caller.
 */
export const isInServiceWorkerCache = (url: string): Promise<boolean> => {
  const existing = store.inFlight.get(url);
  if (existing) return existing;

  const run = (async (): Promise<boolean> => {
    if (!hasCacheApi()) return false;
    try {
      const names = await globalThis.caches.keys();
      for (const name of names) {
        const hit = await matchInCache(name, url);
        if (hit) return true;
      }
      return false;
    } catch {
      // caches.keys() / caches.match() can throw in some browsers
      // (e.g. when the SW is in a weird state). Treat as uncached
      // so the loader falls through to loadBuffer().
      return false;
    } finally {
      store.inFlight.delete(url);
    }
  })();

  store.inFlight.set(url, run);
  return run;
};

/**
 * Wait for the Service Worker to be activated. Times out after 2s
 * to avoid blocking `preloadAllBuffers` on a slow cold install.
 * Resolves with `null` when no SW is registered or the timeout fires —
 * callers should treat that as "cache check is a no-op, fall through".
 */
export const waitForServiceWorkerReady = (): Promise<ServiceWorker | null> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  return new Promise<ServiceWorker | null>((resolve) => {
    let settled = false;
    const finish = (sw: ServiceWorker | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sw);
    };
    const timer = setTimeout(() => finish(null), SW_CACHE_TIMEOUT_MS);
    navigator.serviceWorker.ready.then((reg) => {
      // `ServiceWorkerRegistration.active` is the just-activated worker.
      // It is the worker we want to interact with — `controller` lives on
      // `ServiceWorkerContainer` (i.e. navigator.serviceWorker.controller)
      // and is null on the first visit before reload.
      const sw = reg.active ?? navigator.serviceWorker.controller ?? null;
      finish(sw);
    }).catch(() => finish(null));
  });
};