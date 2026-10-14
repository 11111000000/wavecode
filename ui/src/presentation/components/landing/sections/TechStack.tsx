import type { JSX } from 'solid-js';
import { For } from 'solid-js';

type Stack = {
  readonly name: string;
  readonly note: string;
  readonly tone: 'primary' | 'cyan' | 'magenta' | 'ok' | 'silver';
};

const CORE: ReadonlyArray<Stack> = [
  { name: 'TypeScript',      note: 'строгая типизация',     tone: 'cyan'    },
  { name: 'Solid.js',        note: 'быстрый UI',            tone: 'primary'   },
  { name: 'Effect-TS',       note: 'архитектура',           tone: 'magenta' },
  { name: 'CodeMirror 6',   note: 'редактор кода',         tone: 'cyan'    },
  { name: 'Strudel',         note: 'музыкальный движок',    tone: 'primary'   },
  { name: 'Web Audio',       note: 'звук в браузере',       tone: 'magenta' },
];

const QUALITY: ReadonlyArray<Stack> = [
  { name: 'Vitest',            note: 'тесты',         tone: 'ok'      },
  { name: 'Playwright',        note: 'e2e',           tone: 'ok'      },
  { name: 'ESLint 9',          note: 'линтер',        tone: 'silver'  },
  { name: 'TypeScript ESLint', note: 'типы',          tone: 'silver'  },
];

const DEPLOY: ReadonlyArray<Stack> = [
  { name: 'Vite 5',          note: 'сборка',               tone: 'cyan'    },
  { name: 'vite-plugin-pwa', note: 'кеш в браузере',       tone: 'primary'   },
  { name: 'Caddy',           note: 'reverse proxy',        tone: 'silver'  },
  { name: 'NixOS',           note: 'хостинг',              tone: 'silver'  },
];

const StackBadge = (p: { s: Stack }): JSX.Element => (
  <span class="l-stack-badge" data-tone={p.s.tone}>
    <span class="dot" aria-hidden="true" />
    <span>{p.s.name}</span>
    <small>{p.s.note}</small>
  </span>
);

/**
 * TechStack — что внутри. Простым языком, без «vite-plugin-pwa
 * с generateSW стратегией precacheAndRoute». Только названия и зачем.
 */
export function TechStack(): JSX.Element {
  return (
    <section class="l-section" aria-labelledby="stack-title">
      <header class="l-section__head">
        <span class="l-section__kicker">05 · из чего сделано</span>
        <h2 class="l-section__title" id="stack-title">
          Open source. Без своих серверов. Без vendor lock-in.
        </h2>
        <p class="l-section__sub">
          Только открытые библиотеки. Никакой проприетарной магии.
        </p>
      </header>

      <h3 class="l-stack__group-title"
          style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--fg-dim)', 'margin-bottom': 'var(--space-md)' }}>
        В работе
      </h3>
      <div class="l-stack" role="list">
        <For each={CORE}>{(s) => <StackBadge s={s} />}</For>
      </div>

      <h3 class="l-stack__group-title"
          style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--fg-dim)', 'margin': 'var(--space-2xl) 0 var(--space-md)' }}>
        Качество
      </h3>
      <div class="l-stack" role="list">
        <For each={QUALITY}>{(s) => <StackBadge s={s} />}</For>
      </div>

      <h3 class="l-stack__group-title"
          style={{ 'font-family': 'var(--font-mono)', 'font-size': 'var(--fs-xs)', 'letter-spacing': '0.10em', 'text-transform': 'uppercase', color: 'var(--fg-dim)', 'margin': 'var(--space-2xl) 0 var(--space-md)' }}>
        Хостинг
      </h3>
      <div class="l-stack" role="list">
        <For each={DEPLOY}>{(s) => <StackBadge s={s} />}</For>
      </div>
    </section>
  );
}
