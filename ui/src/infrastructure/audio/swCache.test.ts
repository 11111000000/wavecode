import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isInServiceWorkerCache, waitForServiceWorkerReady } from './swCache';

/**
 * Unit tests for the SW cache probes.
 *
 * We mock `globalThis.caches` (Cache Storage API) and
 * `navigator.serviceWorker` separately — each test rebuilds both to
 * keep cases isolated. The module under test reads these globals on
 * every call (no module-scope snapshot), so spy+restore is enough.
 */

type FakeCache = {
  match: ReturnType<typeof vi.fn>;
};
type CachesApi = {
  keys: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  match?: ReturnType<typeof vi.fn>;
};

const installCaches = (api: CachesApi | undefined): void => {
  if (api === undefined) {
    Object.defineProperty(globalThis, 'caches', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    return;
  }
  Object.defineProperty(globalThis, 'caches', {
    value: api,
    configurable: true,
    writable: true,
  });
};

const fakeResponse = (): Response => new Response(new ArrayBuffer(0));

describe('isInServiceWorkerCache', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    installCaches(undefined);
  });

  it('returns true when any cache has the URL', async () => {
    const cacheHit: FakeCache = { match: vi.fn().mockResolvedValue(fakeResponse()) };
    const cacheMiss: FakeCache = { match: vi.fn().mockResolvedValue(undefined) };
    installCaches({
      keys: vi.fn().mockResolvedValue(['precache-v1', 'runtime-llm1']),
      open: vi.fn(async (name: string) => {
        if (name === 'precache-v1') return cacheMiss;
        if (name === 'runtime-llm1') return cacheHit;
        throw new Error(`unexpected cache name: ${name}`);
      }),
    });

    const result = await isInServiceWorkerCache('https://x/y.mp3');
    expect(result).toBe(true);
    expect(cacheMiss.match).toHaveBeenCalledWith('https://x/y.mp3');
    expect(cacheHit.match).toHaveBeenCalledWith('https://x/y.mp3');
  });

  it('returns false when no cache has the URL', async () => {
    installCaches({
      keys: vi.fn().mockResolvedValue(['precache-v1', 'runtime-llm1']),
      open: vi.fn(async () => ({ match: vi.fn().mockResolvedValue(undefined) })),
    });
    const result = await isInServiceWorkerCache('https://x/missing.mp3');
    expect(result).toBe(false);
  });

  it('returns false when caches is undefined (no Cache API)', async () => {
    installCaches(undefined);
    const result = await isInServiceWorkerCache('https://x/y.mp3');
    expect(result).toBe(false);
  });

  it('returns false when caches.keys() throws (broken SW state)', async () => {
    installCaches({
      keys: vi.fn().mockRejectedValue(new Error('security error')),
      open: vi.fn(),
    });
    const result = await isInServiceWorkerCache('https://x/y.mp3');
    expect(result).toBe(false);
  });

  it('short-circuits to false when caches exists but has no keys() method', async () => {
    installCaches({ value: {}, keys: vi.fn(), open: vi.fn() } as unknown as CachesApi);
    // Force the defensive check by stripping keys/open to non-functions:
    const broken = { keys: 'not-a-fn' } as unknown as CachesApi;
    installCaches(broken);
    const result = await isInServiceWorkerCache('https://x/y.mp3');
    expect(result).toBe(false);
  });
});

describe('waitForServiceWorkerReady', () => {
  let originalSW: PropertyDescriptor | undefined;
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useRealTimers();
    originalSW = Object.getOwnPropertyDescriptor(globalThis.navigator, 'serviceWorker');
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  });

  afterEach(() => {
    if (originalSW) {
      Object.defineProperty(globalThis.navigator, 'serviceWorker', originalSW);
    } else {
      delete (globalThis.navigator as unknown as Record<string, unknown>)['serviceWorker'];
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
  });

  it('resolves with the active SW when ready resolves', async () => {
    const fakeSW = { scriptURL: '/sw.js', state: 'activated' } as ServiceWorker;
    const ready = Promise.resolve({ active: fakeSW } as unknown as ServiceWorkerRegistration);
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { ready, controller: null },
      configurable: true,
      writable: true,
    });
    const result = await waitForServiceWorkerReady();
    expect(result).toBe(fakeSW);
  });

  it('falls back to navigator.serviceWorker.controller when reg.active is null', async () => {
    const fakeSW = { scriptURL: '/sw.js', state: 'activated' } as ServiceWorker;
    const ready = Promise.resolve({ active: null } as unknown as ServiceWorkerRegistration);
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { ready, controller: fakeSW },
      configurable: true,
      writable: true,
    });
    const result = await waitForServiceWorkerReady();
    expect(result).toBe(fakeSW);
  });

  it('resolves with null when both reg.active and controller are null', async () => {
    const ready = Promise.resolve({ active: null } as unknown as ServiceWorkerRegistration);
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { ready, controller: null },
      configurable: true,
      writable: true,
    });
    const result = await waitForServiceWorkerReady();
    expect(result).toBeNull();
  });

  it('resolves with null when navigator.serviceWorker is missing', async () => {
    delete (globalThis.navigator as unknown as Record<string, unknown>)['serviceWorker'];
    const result = await waitForServiceWorkerReady();
    expect(result).toBeNull();
  });

  it('times out after 2s if ready never resolves', async () => {
    vi.useFakeTimers();
    const never = new Promise(() => { /* never settles */ });
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { ready: never, controller: null },
      configurable: true,
      writable: true,
    });
    const p = waitForServiceWorkerReady();
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toBeNull();
  });

  it('resolves with null when ready rejects', async () => {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: {
        ready: Promise.reject(new Error('SW crashed')),
        controller: null,
      },
      configurable: true,
      writable: true,
    });
    const result = await waitForServiceWorkerReady();
    expect(result).toBeNull();
  });
});