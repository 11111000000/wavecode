import type { JSX } from 'solid-js';

/**
 * Architecture — что происходит, когда ты нажал Play.
 * Простым языком: браузер → код → звук.
 */
export function Architecture(): JSX.Element {
  return (
    <section id="architecture" class="l-section" aria-labelledby="arch-title">
      <header class="l-section__head">
        <span class="l-section__kicker">06 · что внутри</span>
        <h2 class="l-section__title" id="arch-title">
          Что происходит, когда ты нажал «Play».
        </h2>
        <p class="l-section__sub">
          Если интересно, как именно код становится звуком — вот
          упрощённая схема. Если не интересно — пропусти, всё и
          так работает.
        </p>
      </header>

      <div class="l-arch" role="figure" aria-label="Поток данных wavecode">
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--src">ты пишешь текст</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node">AI понимает и пишет код</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node">код сохраняется</div>
        </div>
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--src">ты пишешь код</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node">браузер читает</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node l-arch__node--sink">звук играет</div>
        </div>
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--src">автосейв</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node">твоё устройство</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node l-arch__node--src">всё сохранено</div>
        </div>

        <div class="l-arch__legend" aria-hidden="true">
          <span class="l-arch__legend-item">
            <span class="l-arch__legend-swatch" style={{ background: 'var(--cyan-soft)', border: '1px solid var(--cyan)' }} />
            <span>ты пишешь</span>
          </span>
          <span class="l-arch__legend-item">
            <span class="l-arch__legend-swatch" style={{ background: 'var(--primary-soft)', border: '1px solid var(--primary)' }} />
            <span>звучит</span>
          </span>
          <span class="l-arch__legend-item">
            <span class="l-arch__legend-swatch" style={{ background: 'transparent', border: '1px dashed var(--border-strong)' }} />
            <span>промежуточное</span>
          </span>
        </div>
      </div>
    </section>
  );
}
