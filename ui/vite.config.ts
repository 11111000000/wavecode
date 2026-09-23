import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [solid()],

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
          strudel: [
            '@strudel/core',
            '@strudel/webaudio',
            '@strudel/mini-notation',
            '@strudel/tonal',
            '@strudel/transpiler',
            '@strudel/serialism',
          ],
          audio: ['tone'],
          codemirror: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/language',
            '@codemirror/commands',
            '@codemirror/search',
            '@codemirror/autocomplete',
            '@codemirror/lint',
          ],
          effect: ['effect', '@effect/schema', '@effect/platform', '@effect/platform-browser'],
          ai: ['ai', '@ai-sdk/openai-compatible'],
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
});