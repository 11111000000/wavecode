/// <reference types="vitest" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
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
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'strudel-vendor',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 30 },
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