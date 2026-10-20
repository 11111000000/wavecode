import type { JSX } from 'solid-js';
import { ArrowRight } from '~/presentation/components/landing/icons';
import { BUILTIN_PRESETS } from '~/domain/presets';

/**
 * Russian plural for «пресет / пресета / пресетов».
 *
 * The count comes from `BUILTIN_PRESETS.length` rather than a literal:
 * the copy used to say «восемь» while the editor dropdown listed 14
 * and the landing cards 6, so three different numbers were live on one
 * page. Deriving it means adding a preset can no longer make the
 * marketing text wrong.
 */
const PRESET_COUNT = BUILTIN_PRESETS.length;

const presetWord = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'пресетов';
  switch (n % 10) {
    case 1: return 'пресет';
    case 2:
    case 3:
    case 4: return 'пресета';
    default: return 'пресетов';
  }
};

export function QuickStart(): JSX.Element {
  return (
    <section id="start" class="l-section" aria-labelledby="start-title">
      <header class="l-section__head">
        <span class="l-section__kicker">07 · с чего начать</span>
        <h2 class="l-section__title" id="start-title">
          Три шага до первой мелодии.
        </h2>
        <p class="l-section__sub">
          Без регистрации, без своих ключей. Просто открой редактор.
        </p>
      </header>

      <div class="l-quickstart">
        <article class="l-step">
          <span class="l-step__num">1</span>
          <h3 class="l-step__title">Выбери готовую мелодию</h3>
          <p class="l-step__body">
            {PRESET_COUNT} готовых {presetWord(PRESET_COUNT)} — кликни
            на любую на лендинге или выбери из списка в редакторе,
            он откроется с уже заполненным кодом.
          </p>
          <pre class="l-step__cmd">
            <span class="prompt">1.</span>{' '}
            <span style={{ color: 'var(--fg-dim)' }}>нажми «Открыть»</span>{'\n'}
            <span class="prompt">2.</span>{' '}
            <span style={{ color: 'var(--fg-dim)' }}>редактор загрузится</span>
          </pre>
        </article>

        <article class="l-step">
          <span class="l-step__num">2</span>
          <h3 class="l-step__title">Нажми «Play»</h3>
          <p class="l-step__body">
            Кнопка <span style={{ color: 'var(--primary)' }}>▶</span>{' '}
            внизу справа. Через секунду зазвучит. Громкость, пауза,
            перемотка — всё там же.
          </p>
          <pre class="l-step__cmd">
            <span class="prompt">→</span>{' '}
            <span style={{ color: 'var(--primary)' }}>▶</span>
            <span style={{ color: 'var(--fg-dim)' }}>{' '}кнопка снизу справа</span>
          </pre>
        </article>

        <article class="l-step">
          <span class="l-step__num">3</span>
          <h3 class="l-step__title">Меняй как хочешь</h3>
          <p class="l-step__body">
            Пиши в AI-чат «сделай быстрее» или «добавь басов».
            Или правь код руками — музыка меняется мгновенно.
          </p>
          <pre class="l-step__cmd">
            <span class="prompt">💬</span>{' '}
            <span style={{ color: 'var(--fg)' }}>«сделай быстрее в два раза»</span>
          </pre>
        </article>
      </div>

      <div style={{ 'margin-top': 'var(--space-2xl)', display: 'flex', 'justify-content': 'center' }}>
        <a
          class="l-cta-primary"
          href="#/app"
          aria-label="Открыть редактор"
        >
          <span>Открыть редактор</span>
          <span class="l-arrow"><ArrowRight size={18} /></span>
        </a>
      </div>
    </section>
  );
}
