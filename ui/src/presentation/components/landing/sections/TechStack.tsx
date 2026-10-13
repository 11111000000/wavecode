import type { JSX } from 'solid-js';
import { For } from 'solid-js';

type Stack = {
  readonly name: string;
  readonly note: string;
  readonly tone: 'amber' | 'cyan' | 'magenta' | 'ok' | 'silver';
};

const CORE: ReadonlyArray<Stack> = [
  { name: 'TypeScript',      note: 'strict',         tone: 'cyan'    },
  { name: 'Solid.js 1.8',    note: 'reactive UI',    tone: 'amber'   },
  { name: 'Effect-TS',       note: 'DI · Layer',     tone: 'magenta' },
  { name: 'CodeMirror 6',    note: 'editor',         tone: 'cyan'    },
  { name: '@strudel/webaudio', note: 'runtime',      tone: 'amber'   },
  { name: 'idb-keyval',      note: 'persistence',    tone: 'magenta' },
];

const TEST: ReadonlyArray<Stack> = [
  { name: 'Vitest',          note: 'unit',           tone: 'ok'      },
  { name: 'Playwright',      note: 'e2e',            tone: 'ok'      },
  { name: '@solidjs/testing-library', note: 'DOM',  tone: 'silver'  },
  { name: 'ESLint 9',        note: 'lint',           tone: 'silver'  },
  { name: 'typescript-eslint', note: 'typecheck',    tone: 'silver'  },
];

const DEPLOY: ReadonlyArray<Stack> = [
  { name: 'Vite 5',          note: 'bundler',        tone: 'cyan'    },
  { name: 'vite-plugin-pwa', note: 'service worker', tone: 'amber'   },
  { name: 'No Nix / Docker', note: 'pure static',    tone: 'silver'  },
  { name: 'Web Audio + WebMIDI', note: 'native',     tone: 'cyan'    },
];

const StackBadge = (p: { s: Stack }): JSX.Element => (
  <span class="l-stack-badge" data-tone={p.s.tone}>
    <span class="dot" aria-hidden="true" />
    <span>{p.s.name}</span>
    <small>{p.s.note}</small>
  </span>
);

export function TechStack(): JSX.Element {
  return (
    <section class="l-section" aria-labelledby="stack-title">
      <header class="l-section__head">
        <span class="l-section__kicker">07 · stack</span>
        <h2 class="l-section__title" id="stack-title">
          Стек, который держит лендинг и редактор на одной базе.
        </h2>
        <p class="l-section__sub">
          Только first-party зависимости Vite-экосистемы и Web API.
          Никаких кастомных серверов, никаких обёрток над апи
          фреймворков.
        </p>
      </header>

      <h3 class="l-stack__group-title"
          style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--fg-dim)', 'margin-bottom': 'var(--space-md)' }}>
        Runtime
      </h3>
      <div class="l-stack" role="list">
        <For each={CORE}>{(s) => <StackBadge s={s} />}</For>
      </div>

      <h3 class="l-stack__group-title"
          style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--fg-dim)', 'margin': 'var(--space-2xl) 0 var(--space-md)' }}>
        Quality
      </h3>
      <div class="l-stack" role="list">
        <For each={TEST}>{(s) => <StackBadge s={s} />}</For>
      </div>

      <h3 class="l-stack__group-title"
          style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--fg-dim)', 'margin': 'var(--space-2xl) 0 var(--space-md)' }}>
        Deploy
      </h3>
      <div class="l-stack" role="list">
        <For each={DEPLOY}>{(s) => <StackBadge s={s} />}</For>
      </div>
    </section>
  );
}
