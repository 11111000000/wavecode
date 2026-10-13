import type { JSX } from 'solid-js';
import { A } from '@solidjs/router';
import { ArrowRight } from '../icons';

export function QuickStart(): JSX.Element {
  return (
    <section id="start" class="l-section" aria-labelledby="start-title">
      <header class="l-section__head">
        <span class="l-section__kicker">08 · start</span>
        <h2 class="l-section__title" id="start-title">
          Открыть редактор — 3 шага, без регистрации.
        </h2>
        <p class="l-section__sub">
          Никаких аккаунтов, никаких API-ключей: сразу пишешь, сразу
          слышишь. Если хочешь LLM-агента — добавь один ключ от
          llm.kosov.online (LiteLLM-прокси с OpenAI-совместимым API).
        </p>
      </header>

      <div class="l-quickstart">
        <article class="l-step">
          <span class="l-step__num">1</span>
          <h3 class="l-step__title">Открой редактор</h3>
          <p class="l-step__body">
            Кнопка «Открыть редактор» на этой странице — и ты в
            живом Strudel-окружении. Звук играет сразу после клика на
            «Play».
          </p>
          <pre class="l-step__cmd">
            <span class="prompt">$</span>{' '}
            <span style={{ color: 'var(--fg)' }}>open</span>{' '}
            <span style={{ color: 'var(--ok)' }}>wavecode.kosov.online/app</span>
          </pre>
        </article>

        <article class="l-step">
          <span class="l-step__num">2</span>
          <h3 class="l-step__title">Выбери пресет или пиши свой</h3>
          <p class="l-step__body">
            В шапке — 8 встроенных мелодий (Creep, EDM, Jazz ii-V-I…).
            Меняешь — пересчитывается мгновенно. Пресет можно
            сохранить в localStorage.
          </p>
          <pre class="l-step__cmd">
            <span class="prompt">$</span>{' '}
            <span class="comment">{'// eval мгновенно по Enter'}</span>{'\n'}
            <span style={{ color: 'var(--amber)' }}>stack(</span>
            {'\n  '}
            <span class="tk-fn" style={{ color: 'var(--magenta)' }}>note</span>
            <span style={{ color: 'var(--fg)' }}>(</span>
            <span style={{ color: 'var(--amber)' }}>"&lt;a2 e3&gt;"</span>
            <span style={{ color: 'var(--fg)' }}>)</span>
            <span style={{ color: 'var(--cyan)' }}>.s</span>
            <span style={{ color: 'var(--fg)' }}>(</span>
            <span style={{ color: 'var(--ok)' }}>"sawtooth"</span>
            <span style={{ color: 'var(--fg)' }}>)</span>
            <span style={{ color: 'var(--amber)' }}>,</span>
            {'\n)'}
          </pre>
        </article>

        <article class="l-step">
          <span class="l-step__num">3</span>
          <h3 class="l-step__title">Спроси AI-агента</h3>
          <p class="l-step__body">
            Чат-панель: «Сделай bass глубже», «Добавь swing 16ths».
            Агент вызывает <code style={{ color: 'var(--amber)', background: 'transparent', border: 'none', padding: 0 }}>edit_score</code> и
            применяет правку мгновенно, авто-eval’ит и сообщает о
            результате.
          </p>
          <pre class="l-step__cmd">
            <span class="prompt">💬</span>{' '}
            <span style={{ color: 'var(--fg)' }}>«добавь swing и reverb»</span>{'\n'}
            <span class="comment">{'↳ edit_score + eval_snippet'}</span>
          </pre>
        </article>
      </div>

      <div style={{ 'margin-top': 'var(--space-2xl)', display: 'flex', 'justify-content': 'center' }}>
        <A
          class="l-cta-primary"
          href="/app"
          aria-label="Запустить редактор"
        >
          <span>Запустить редактор</span>
          <span class="l-arrow"><ArrowRight size={18} /></span>
        </A>
      </div>
    </section>
  );
}
