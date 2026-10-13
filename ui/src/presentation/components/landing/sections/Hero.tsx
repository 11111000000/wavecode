import { createSignal, type JSX } from 'solid-js';
import { ArrowRight, ChevronDown } from '~/presentation/components/landing/icons';

/**
 * Hero — первый экран лендинга.
 *
 * Главная идея проекта: «русский текст → код → музыка». Должна быть
 * понятна сразу, без жаргона. Поэтому:
 *   - Заголовок про «слова → музыку» (а не «AI-агент tool-calling Strudel»).
 *   - Поле ввода с placeholder'ом, в который хочется что-то написать.
 *   - Quick-chips: 4 примера одним кликом. Клик заполняет input — это
 *     даёт мгновенный feedback, что лендинг «живой», а не статичный.
 *   - Кнопка «Создать» отправляет в редактор с ?prompt=… (App.tsx сейчас
 *     этот query не читает, но ввод текста пользователя — это и есть
 *     мотивация: «AI сгенерирует по нему»). Для рабочего цикла
 *     prompt→генерация нужен бэкенд; пока что prompt попадает в редактор
 *     как локальная «подсказка» через query-параметр.
 *   - Альтернативный CTA: «Открыть редактор» → /app.
 */
const QUICK_EXAMPLES = [
  { label: 'Грустный джаз', prompt: 'грустный джаз с пианино' },
  { label: 'Космос', prompt: 'космический эмбиент, спокойный и глубокий' },
  { label: 'Дождливый вечер', prompt: 'lofi для дождливого вечера' },
  { label: 'Буги-вуги', prompt: 'энергичный буги-вуги' },
] as const;

export function Hero(): JSX.Element {
  const [text, setText] = createSignal('');

  // Hash-router navigation: pushState + dispatch hashchange so the
  // existing useHashRoute in App.tsx reacts. We use pushState
  // (not location.hash = …) because direct assignment does not
  // re-fire hashchange if the value is already what we set.
  const goHash = (hash: string): void => {
    window.history.pushState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const goApp = (e: Event): void => {
    e.preventDefault();
    const q = text().trim()
      ? `?prompt=${encodeURIComponent(text().trim())}`
      : '';
    goHash(`#/app${q}`);
  };

  const goEditor = (): void => goHash('#/app');

  return (
    <section class="l-hero" id="top" aria-labelledby="hero-title">
      <div class="l-hero__text">
        <span class="l-hero__eyebrow">
          <span class="pulse-dot" />
          <span>Живой код · Без бэкенда · Всё в браузере</span>
        </span>

        <h1 class="l-hero__title" id="hero-title">
          Скажи словами —{' '}
          <span class="accent-amber">получится музыка</span>
        </h1>

        <p class="l-hero__sub">
          Опиши, что хочешь услышать, обычными словами — AI превратит их в
          музыкальный код, и браузер сыграет. Или пиши код сам — это
          простой синтаксис, похожий на обычный JavaScript.
        </p>

        <form class="l-hero__form" onSubmit={goApp} role="search">
          <label class="l-hero__label" for="hero-input">
            Что хочешь послушать?
          </label>
          <div class="l-hero__inputrow">
            <input
              id="hero-input"
              class="l-hero__input"
              type="text"
              autocomplete="off"
              spellcheck={false}
              placeholder="например: спокойная музыка для чтения, с пианино"
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <button class="l-cta-primary l-hero__submit" type="submit">
              <span>Создать</span>
              <span class="l-arrow"><ArrowRight size={18} /></span>
            </button>
          </div>
        </form>

        <div class="l-hero__examples" role="group" aria-label="Быстрые примеры">
          <span class="l-hero__examples-label">Попробуй:</span>
          {QUICK_EXAMPLES.map((ex) => (
            <button
              type="button"
              class="l-hero__chip"
              onClick={() => setText(ex.prompt)}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div class="l-hero__ctas">
          <button
            class="l-cta-ghost"
            type="button"
            onClick={goEditor}
          >
            <span>Или открой редактор</span>
            <ArrowRight size={16} />
          </button>
          <a class="l-hero__learn" href="#how" aria-label="Как это работает">
            <ChevronDown size={14} />
            <span>Как это работает</span>
          </a>
        </div>

        <ul class="l-hero__meta" aria-label="Что не нужно">
          <li class="l-hero__meta-item">
            <span class="ico">◇</span> Без регистрации
          </li>
          <li class="l-hero__meta-item">
            <span class="ico">◇</span> Без своих серверов
          </li>
          <li class="l-hero__meta-item">
            <span class="ico">◇</span> Работает офлайн после загрузки
          </li>
        </ul>
      </div>

      <HeroViz />
    </section>
  );
}

/**
 * HeroViz — большая визуальная подсказка справа от текста.
 * Три соединённых блока «текст → код → звук» со стрелками.
 * Чисто визуальный, без логики — для объяснения «как это работает».
 */
function HeroViz(): JSX.Element {
  return (
    <div class="l-hero__viz" role="presentation" aria-hidden="true">
      <div class="l-hero__viz-step">
        <div class="l-hero__viz-num">1</div>
        <div class="l-hero__viz-text">грустный джаз</div>
        <div class="l-hero__viz-label">текст</div>
      </div>
      <div class="l-hero__viz-arrow">→</div>
      <div class="l-hero__viz-step l-hero__viz-step--code">
        <div class="l-hero__viz-num">2</div>
        <pre class="l-hero__viz-code">
{`stack(
  note("a3 c4 e4"),
  s("piano").slow(2)
)`}
        </pre>
        <div class="l-hero__viz-label">код</div>
      </div>
      <div class="l-hero__viz-arrow">→</div>
      <div class="l-hero__viz-step l-hero__viz-step--audio">
        <div class="l-hero__viz-num">3</div>
        <div class="l-hero__viz-audio" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
        <div class="l-hero__viz-label">звук</div>
      </div>
    </div>
  );
}
