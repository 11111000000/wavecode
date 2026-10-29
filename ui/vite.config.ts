/// <reference types="vitest" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  define: {
    // Landing footer prints the real package version — see src/version.ts.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon-180.png', 'manifest.webmanifest'],
      manifest: {
        name: 'wavecode',
        short_name: 'wavecode',
        description: 'Live-coding music with AI assistance',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        lang: 'ru',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // html is intentionally excluded: navigateFallback handles HTML
        // via the network on every navigation, so mobile users who kept
        // a stale PWA tab open always pick up the new bundle hash on
        // their next visit. Without this, Workbox precaches index.html
        // and the navigation fallback serves the cached copy, so a
        // deploy's new bundle hash is never reached until the user
        // hard-reloads (which is the bug we hit 2026-10-13 with the
        // LLM-401 regression). See math/wavecode-pwa-auto-update.
        globPatterns: ['**/*.{js,css,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // navigationFallback / html cache strategy:
        //   Workbox precache list excludes index.html (intentional — see
        //   comment above globPatterns). For navigations, the SW fetches
        //   /index.html from the network on every visit, so the browser
        //   always sees the current bundle URL. The remaining stale-html
        //   window is the BROWSER HTTP cache (no SW involvement): when
        //   the SW has been unregistered or hasn't installed yet, the
        //   browser can serve yesterday's html from disk cache. Fix lives
        //   in Caddy: `Cache-Control: no-cache, must-revalidate` on
        //   index.html forces a conditional GET every navigation, which
        //   always returns the current html. See decisions/fix-pwa-cache-
        //   control and AngaraConfig/services/kosov-reverse-proxy.
        runtimeCaching: [
          // Stable vendor chunks only — filenames match the manualChunks
          // aliases in rollupOptions.output.manualChunks. The browser cache
          // (with `Cache-Control: immutable` from Caddy, see AngaraConfig
          // kosov-reverse-proxy) is the long-term store; this SW layer is
          // purely for offline-first boot when the browser cache is cold
          // (first install) and the user is offline.
          //
          // Critical: the broad pattern `/assets/.*\.js$` was REMOVED.
          // It used CacheFirst for ALL assets, including the main
          // `index-<hash>.js` which changes every deploy. With CacheFirst
          // + a 30-day expiration, the SW would happily serve a stale
          // index bundle even after the server had rotated the filename.
          // The vite hash already makes the new bundle a brand-new URL
          // (cache miss → network → 200), so CacheFirst offered no real
          // benefit for hashed bundles — only the false sense of safety.
          {
            urlPattern: /\/assets\/(strudel|vendor-solid|codemirror|effect)-[A-Za-z0-9_-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vendor-stable',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // Sample banks. `globPatterns` deliberately excludes mp3, so
          // without this rule every MP3 hits the network twice per boot:
          // once from the decode Worker and once more from superdough's
          // own runtime fetch at first hap. CacheFirst makes the second
          // one a cache hit. The manifest JSON is bundled alongside the
          // samples it describes, so cache it with them.
          {
            urlPattern: /\/samples\/[^/]+\/(strudel\.json|[^/]+\.mp3)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sample-banks',
              expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'llm.kosov.online',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'llm-responses',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],

  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 5173,
    strictPort: false,
  },

  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // `vendor-solid` — Solid.js runtime. Pulled out of the main
          // chunk so the main entry stays small and the Solid runtime is
          // cached across deploys (Solid changes less often than app code).
          'vendor-solid': ['solid-js', 'solid-js/web', 'solid-js/store'],
          // Strudel runtime (~660 KB raw, ~213 KB gz). All five packages
          // are imported dynamically from LiveAudioEngine.ensureRepl(); they
          // are pulled into a single chunk so the user's first ▶ click loads
          // them in one round-trip and the audio stack can evaluate.
          strudel: [
            '@strudel/core',
            '@strudel/webaudio',
            '@strudel/mini',
            '@strudel/tonal',
            '@strudel/transpiler',
          ],
          // CodeMirror 6 (~386 KB raw, ~125 KB gz). Imported via
          // `lazy()` in CodeMirrorEditor.tsx — only loads when the user
          // first opens the Score tab.
          codemirror: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/commands',
            '@codemirror/search',
            '@codemirror/autocomplete',
            '@codemirror/lint',
          ],
          // Effect-TS family + supporting packages. Loaded eagerly with
          // the main chunk because the AppLayer composition and the
          // appStore Effect.gen pipelines both depend on it at boot.
          effect: ['effect', '@effect/schema', '@effect/platform', '@effect/platform-browser'],
        },
      },
    },
  },

  worker: {
    format: 'es',
  },

  optimizeDeps: {
    exclude: ['@strudel/core', '@strudel/webaudio'],
  },

  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    passWithNoTests: true,
  },
});