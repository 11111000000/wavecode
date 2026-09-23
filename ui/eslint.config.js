import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { solid },
    rules: {
      ...solid.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  {
    // domain/: no UI, no IO, no AI, no audio
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['solid-js', '@solidjs/*'], message: 'domain: нет зависимостей от UI-фреймворка' },
            { group: ['@strudel/*', 'tone'], message: 'domain: нет зависимостей от аудио-DSP' },
            { group: ['@ai-sdk/*', 'ai'], message: 'domain: нет зависимостей от AI SDK' },
            { group: ['@effect/platform*'], message: 'domain: только effect (core), не platform (IO)' },
            { group: ['idb-keyval'], message: 'domain: нет зависимостей от IndexedDB' },
          ],
        },
      ],
    },
  },

  {
    // application/: no UI, no IO frameworks
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['solid-js', '@solidjs/*'], message: 'application: нет зависимостей от UI-фреймворка' },
            { group: ['@strudel/*', 'tone'], message: 'application: нет зависимостей от аудио-DSP напрямую (только через AudioEngine-интерфейс)' },
            { group: ['@ai-sdk/*', 'ai'], message: 'application: нет зависимостей от AI SDK напрямую (только через LLMClient-интерфейс)' },
            { group: ['idb-keyval'], message: 'application: нет зависимостей от IndexedDB напрямую' },
          ],
        },
      ],
    },
  },

  {
    // infrastructure/: no UI
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['solid-js', '@solidjs/*'], message: 'infrastructure: нет зависимостей от UI-фреймворка' },
          ],
        },
      ],
    },
  },

  {
    // presentation/: no DSP, no AI, no DB
    files: ['src/presentation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@strudel/*', 'tone'], message: 'presentation: нет зависимостей от аудио-DSP (только через AudioEngine)' },
            { group: ['@ai-sdk/*', 'ai'], message: 'presentation: нет зависимостей от AI SDK (только через LLMClient)' },
            { group: ['idb-keyval'], message: 'presentation: нет зависимостей от IndexedDB (только через Repo)' },
          ],
        },
      ],
    },
  },
];