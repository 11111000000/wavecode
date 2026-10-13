import { For, type JSX } from 'solid-js';
import { WavecodeLogo } from '../icons';

type Link = {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
};

const SECTIONS: ReadonlyArray<{ title: string; links: ReadonlyArray<Link> }> = [
  {
    title: 'Продукт',
    links: [
      { label: 'Открыть редактор', href: '#/app' },
      { label: 'Пресеты',           href: '#snippet' },
      { label: 'Архитектура',       href: '#architecture' },
      { label: 'Quick start',       href: '#start' },
    ],
  },
  {
    title: 'Стек',
    links: [
      { label: 'Solid.js',     href: 'https://solidjs.com',    external: true },
      { label: 'CodeMirror 6', href: 'https://codemirror.net', external: true },
      { label: 'Strudel',      href: 'https://strudel.cc',     external: true },
      { label: 'Effect-TS',    href: 'https://effect.website', external: true },
    ],
  },
  {
    title: 'Поддержка',
    links: [
      { label: 'README',       href: 'https://github.com/anomalyco/wavecode/blob/master/README.md', external: true },
      { label: 'Issues',       href: 'https://github.com/anomalyco/wavecode/issues',                 external: true },
      { label: 'AGENTS',       href: 'https://github.com/anomalyco/wavecode/blob/master/AGENTS.md', external: true },
      { label: 'Discussions',  href: 'https://github.com/anomalyco/wavecode/discussions',             external: true },
    ],
  },
];

export function Footer(): JSX.Element {
  return (
    <footer class="l-footer" role="contentinfo">
      <div class="l-footer__inner">
        <div class="l-footer__brand">
          <span class="l-footer__brand-name">
            <WavecodeLogo size={24} />
            <span>wavecode</span>
          </span>
          <span class="l-footer__brand-tag">
            Браузерный live-coding инструмент для музыки с
            AI-агентом. Pure frontend, без backend, без аккаунтов.
          </span>
        </div>

        <For each={SECTIONS}>
          {(col) => (
            <nav class="l-footer__col" aria-label={col.title}>
              <h4>{col.title}</h4>
              <ul>
                <For each={col.links}>
                  {(l) => (
                    <li>
                      <a
                        href={l.href}
                        {...(l.external
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {l.label}
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </nav>
          )}
        </For>
      </div>

      <div class="l-footer__bottom">
        <span>© 2026 wavecode · pure-frontend SPA · v0.1</span>
        <span class="l-footer__bottom-links">
          <span>Geist Sans + Geist Mono</span>
          <span>Webkit · Chrome · Firefox · Safari 16+</span>
        </span>
      </div>
    </footer>
  );
}
