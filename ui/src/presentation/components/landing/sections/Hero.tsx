import type { JSX } from 'solid-js';
import { A } from '@solidjs/router';
import { ArrowRight, ChevronDown } from '../icons';

/**
 * Hero — главный экран лендинга.
 * Левая колонка: бэйдж версии + H1 + subtitle + 2 CTA + meta.
 * Правая колонка: визуализация — виртуальный wave-дисплей.
 */
export function Hero(): JSX.Element {
  return (
    <section class="l-hero" id="top" aria-labelledby="hero-title">
      <div class="l-hero__text">
        <span class="l-hero__eyebrow">
          <span class="pulse-dot" />
          <span>v0.1 · beta · pure-frontend</span>
        </span>

        <h1 class="l-hero__title" id="hero-title">
          Live-coding музыки
          <br />
          с <span class="accent-amber">AI-агентом</span>
          <br />
          прямо в браузере
        </h1>

        <p class="l-hero__sub">
          <strong>wavecode</strong> — это браузерный SPA для живого
          программирования музыки. Score — JS-код со{' '}
          <code>Strudel&nbsp;mini-notation</code>, агент правит его через
          tool-calls в реальном времени, ты тоже можешь править. Strudel
          runtime играет через Web Audio API — <strong>без бэкенда</strong>.
        </p>

        <div class="l-hero__ctas">
          <A
            class="l-cta-primary"
            href="/app"
            aria-label="Открыть редактор"
          >
            <span>Открыть редактор</span>
            <span class="l-arrow"><ArrowRight size={18} /></span>
          </A>
          <a
            class="l-cta-ghost"
            href="#architecture"
            aria-label="Как это работает"
          >
            <span>Как это работает</span>
            <ChevronDown size={16} />
          </a>
        </div>

        <div class="l-hero__meta" aria-label="Стек лендинга">
          <span class="l-hero__meta-item">
            <span class="ico">◇</span> 0 KB серверного кода
          </span>
          <span class="l-hero__meta-item">
            <span class="ico">◇</span> Тип: SPA, статический деплой
          </span>
          <span class="l-hero__meta-item">
            <span class="ico">◇</span> Persist: IndexedDB
          </span>
        </div>
      </div>

      <HeroViz />
    </section>
  );
}

/**
 * HeroViz — анимированный wave-дисплей в правой колонке.
 * SVG-синусоида + grid-overlay + corner-labels. Заменяет «живой»
 * Strudel-snippet, который не может играть без user-gesture.
 */
function HeroViz(): JSX.Element {
  return (
    <div class="l-hero__viz" role="presentation">
      <div class="l-hero__viz-wave">
        <svg
          viewBox="0 0 360 240"
          width="92%"
          height="62%"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="wave-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0"   stop-color="#ffaa3b" stop-opacity="0.0" />
              <stop offset="0.2" stop-color="#ffaa3b" stop-opacity="1.0" />
              <stop offset="0.5" stop-color="#5eead4" stop-opacity="1.0" />
              <stop offset="0.8" stop-color="#f472b6" stop-opacity="1.0" />
              <stop offset="1"   stop-color="#f472b6" stop-opacity="0.0" />
            </linearGradient>
            <linearGradient id="wave-grad-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0"   stop-color="#ffaa3b" stop-opacity="0.0" />
              <stop offset="0.3" stop-color="#ffaa3b" stop-opacity="0.18" />
              <stop offset="0.7" stop-color="#f472b6" stop-opacity="0.18" />
              <stop offset="1"   stop-color="#f472b6" stop-opacity="0.0" />
            </linearGradient>
            <filter id="wave-glow" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          {/* горизонтальная центральная линия */}
          <line
            x1="0" y1="120" x2="360" y2="120"
            stroke="#27272a" stroke-width="1"
          />

          {/* заливка под волной */}
          <path
            d="M0,120 Q30,80 60,120 T120,120 T180,120 T240,120 T300,120 T360,120 L360,240 L0,240 Z"
            fill="url(#wave-grad-fill)"
          />

          {/* тень glow */}
          <path
            class="wave-main"
            d="M0,120 Q30,80 60,120 T120,120 T180,120 T240,120 T300,120 T360,120"
            fill="none"
            stroke="url(#wave-grad)"
            stroke-width="2.4"
            stroke-linecap="round"
            filter="url(#wave-glow)"
            opacity="0.85"
          />

          {/* основная линия */}
          <path
            class="wave-main"
            d="M0,120 Q30,80 60,120 T120,120 T180,120 T240,120 T300,120 T360,120"
            fill="none"
            stroke="url(#wave-grad)"
            stroke-width="1.8"
            stroke-linecap="round"
          />

          {/* циан-ноты поверх */}
          <g>
            <circle cx="60"  cy="90"  r="3.5" fill="#5eead4" />
            <circle cx="180" cy="110" r="3.5" fill="#5eead4" />
            <circle cx="260" cy="92"  r="3.5" fill="#5eead4" />
          </g>
        </svg>
      </div>

      <div class="l-hero__viz-mono">
        <span class="info">[strudel]</span> live ·{' '}
        <span class="ok">▶ running</span>
      </div>

      <div class="l-hero__viz-caption">
        Web Audio · 44.1 kHz · latency 5 ms
      </div>
    </div>
  );
}
