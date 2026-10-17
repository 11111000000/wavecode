import { createSignal, onMount, onCleanup } from 'solid-js';

export type Route = 'landing' | 'app' | 'admin';

export const readHashRoute = (): Route => {
  if (typeof window === 'undefined') return 'landing';
  const h = window.location.hash;
  if (h === '#/admin' || h.startsWith('#/admin?')) return 'admin';
  if (h === '#/app' || h.startsWith('#/app?') || h.startsWith('#/app&')) return 'app';
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
