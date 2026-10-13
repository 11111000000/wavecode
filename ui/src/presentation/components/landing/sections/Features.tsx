import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import {
  AgentIcon, PatternIcon, AudioIcon, EditorIcon,
  StorageIcon, ShareIcon24,
} from '../icons';

type Feature = {
  readonly title: string;
  readonly body: string;
  readonly tone: 'amber' | 'cyan' | 'magenta';
  readonly Icon: (p: { size?: number }) => JSX.Element;
};

const FEATURES: ReadonlyArray<Feature> = [
  {
    title: 'AI понимает по-русски',
    body:
      'Опиши, что хочешь услышать, обычными словами. AI превратит ' +
      'их в музыкальный код прямо в редакторе. Можно править и ' +
      'слова, и код — они обновляются вместе.',
    tone: 'amber',
    Icon: AgentIcon,
  },
  {
    title: 'Простой синтаксис',
    body:
      'Код — это обычный JavaScript с понятными командами: «нота», ' +
      '«ударные», «быстрее», «тише». Учится за 10 минут, знание ' +
      'музыкальной теории не нужно.',
    tone: 'cyan',
    Icon: PatternIcon,
  },
  {
    title: 'Играет прямо в браузере',
    body:
      'Никаких загрузок, никаких плагинов. Открыл вкладку — ' +
      'и через секунду уже звучит. Работает в Chrome, Firefox, Safari, ' +
      'на телефоне и на десктопе.',
    tone: 'magenta',
    Icon: AudioIcon,
  },
  {
    title: 'Удобный редактор',
    body:
      'Подсветка кода, подсказки, быстрые кнопки для нот и ' +
      'эффектов. Видно, что играет прямо сейчас, и можно ' +
      'вернуться на любой шаг назад.',
    tone: 'amber',
    Icon: EditorIcon,
  },
  {
    title: 'Не потеряется',
    body:
      'Всё, что ты написал, автоматически сохраняется на твоём ' +
      'устройстве. Закрыл вкладку, выключил компьютер — откроешь ' +
      'завтра, всё на месте.',
    tone: 'cyan',
    Icon: StorageIcon,
  },
  {
    title: 'Поделиться одним кликом',
    body:
      'Нажал «поделиться» — получил ссылку. Отправил другу — ' +
      'у него откроется та же мелодия, и он сможет её править.',
    tone: 'magenta',
    Icon: ShareIcon24,
  },
];

/**
 * Features — 6 основных возможностей продукта.
 * Текст без жаргона: никаких «tool-calling», «mini-notation»,
 * «edit_score», «runtime» — только то, что имеет смысл для нового человека.
 */
export function Features(): JSX.Element {
  return (
    <section id="how" class="l-section" aria-labelledby="how-title">
      <header class="l-section__head">
        <span class="l-section__kicker">02 · как это работает</span>
        <h2 class="l-section__title" id="how-title">
          Шесть вещей, которые делают wavecode wavecode'ом.
        </h2>
        <p class="l-section__sub">
          Никакой магии. Всё это работает в обычном браузере, без
          установки и без своих серверов.
        </p>
      </header>

      <div class="l-features" role="list">
        <For each={FEATURES}>
          {(f) => (
            <article
              class="l-feature"
              data-tone={f.tone}
              role="listitem"
            >
              <span class="l-feature__icon" aria-hidden="true">
                <f.Icon size={22} />
              </span>
              <h3 class="l-feature__title">{f.title}</h3>
              <p class="l-feature__body">{f.body}</p>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
