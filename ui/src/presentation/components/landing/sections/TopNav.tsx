import type { JSX } from 'solid-js';
import { A } from '@solidjs/router';
import { ArrowRight, GitHubIcon, WavecodeLogo } from '../icons';

/**
 * TopNav — sticky nav лендинга.
 * Лого + навигация по якорям + CTA «Открыть редактор».
 * Реализован на @solidjs/router A: навигация — SPA-friendly, без
 * перезагрузки страницы. BrowserRouter (clean URL, без hash).
 */
export function TopNav(): JSX.Element {
  return (
    <nav class="l-topnav" aria-label="Главная навигация">
      <A class="l-topnav__brand" href="/" aria-label="wavecode — на главную">
        <WavecodeLogo size={26} />
        <span>wavecode</span>
      </A>

      <div class="l-topnav__nav">
        <a href="#snippet">Снипплет</a>
        <a href="#features">Фичи</a>
        <a href="#architecture">Архитектура</a>
        <a href="#tools">Инструменты</a>
        <a href="#start">Старт</a>
      </div>

      <a
        class="l-topnav__github"
        href="https://github.com/11111000000/wavecode"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub"
        title="GitHub"
      >
        <GitHubIcon size={18} />
      </a>

      <A
        class="l-topnav__cta"
        href="/app"
        aria-label="Открыть редактор"
      >
        <span>Открыть редактор</span>
        <ArrowRight size={14} />
      </A>
    </nav>
  );
}
