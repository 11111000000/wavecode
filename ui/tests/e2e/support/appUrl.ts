/**
 * Single source of truth for the URLs the e2e specs navigate to.
 *
 * Why this exists: the specs used to hardcode `http://127.0.0.1:4173`
 * (and, in one file, `:5173`) while `playwright.config.ts` declared a
 * different `baseURL`. The mismatch is silent — the browser simply
 * reaches a different origin, the `storageState` consent flag is seeded
 * for the wrong origin, and the run fails far away from its cause.
 *
 * Every route is now relative, so Playwright resolves it against
 * `baseURL` from the config. Changing the host or the port is a
 * one-line change in `playwright.config.ts`.
 *
 * The two routes the app actually has:
 *   - `/`       — the landing page (marketing surface, default route).
 *   - `/#/app`  — the editor shell (`<main class="app">`, AppShellView).
 *
 * A spec that waits for `main.app` belongs on `APP_URL`; a spec that
 * asserts the landing does NOT navigate away belongs on `LANDING_URL`.
 */

/** The editor shell. Hash route — Caddy serves the SPA from `/`. */
export const APP_URL = '/#/app';

/** The landing page. Default route. */
export const LANDING_URL = '/';
