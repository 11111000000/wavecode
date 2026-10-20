/**
 * Build-time app version, injected from `package.json`.
 *
 * Vite's `define` replaces `__APP_VERSION__` at bundle time (see
 * `vite.config.ts`), so there is no runtime import of `package.json`
 * and no hardcoded string to drift out of sync on the next bump.
 *
 * Previously the landing footer printed a hand-written `v0.1` while
 * `package.json` moved on — a stale string in the one place that
 * advertises the build to users.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : '0.0.0-dev';