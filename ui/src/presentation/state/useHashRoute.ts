import { createSignal, onMount, onCleanup } from 'solid-js';

export type Route = 'landing' | 'app' | 'admin';

/**
 * Detect the active route from BOTH the URL hash and the path name.
 *
 * The router started hash-only (`#/app`, `#/admin`) because Caddy serves
 * `index.html` for every path and the SPA runs on whatever the browser
 * sent. That meant a fresh navigation to `/app` (no hash) — including
 * every share-URL of the form `https://…/app?s=<lz-string>` — landed on
 * the marketing page instead of the editor, and the encoded payload
 * was silently discarded. Footer link `<a href="/app">` had the same
 * symptom.
 *
 * Resolution order (most-specific first):
 *   1. `#/admin`        — hash form, kept for backwards-compat
 *   2. `#/app`          — hash form, kept for backwards-compat
 *   3. `/admin` (path)  — restored for the `Open admin` deep-link
 *   4. `/app`  (path)   — restored for direct URL entry + share-URLs
 *   5. `/`     (path)   — landing
 *   6. otherwise        — landing (defensive)
 *
 * `useHashRoute` still listens only to `hashchange`; direct path-only
 * navigations are picked up on initial render via `readHashRoute()`. If
 * the user pastes a `/app` URL while the SPA is already mounted in
 * another route, a full document navigation is the right behaviour
 * anyway (Caddy serves `index.html` for unknown paths).
 */
const matchesPath = (pathname: string, target: string): boolean =>
  pathname === target || pathname === `${target}/` || pathname.startsWith(`${target}?`);

const matchesHash = (hash: string, target: string): boolean =>
  hash === `#${target}` || hash.startsWith(`#${target}?`) || hash.startsWith(`#${target}&`);

export const readHashRoute = (): Route => {
  if (typeof window === 'undefined') return 'landing';
  const h = window.location.hash;
  if (matchesHash(h, '/admin')) return 'admin';
  if (matchesHash(h, '/app')) return 'app';
  const p = window.location.pathname;
  if (matchesPath(p, '/admin')) return 'admin';
  if (matchesPath(p, '/app')) return 'app';
  return 'landing';
};

export const useHashRoute = (): (() => Route) => {
  const [route, setRoute] = createSignal<Route>(readHashRoute());
  onMount(() => {
    const onHash = (): void => { setRoute(readHashRoute()); };
    window.addEventListener('hashchange', onHash);
    onCleanup(() => window.removeEventListener('hashchange', onHash));
  });
  return route;
};

export const openAdmin = (): void => {
  window.history.pushState(null, '', '#/admin');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};