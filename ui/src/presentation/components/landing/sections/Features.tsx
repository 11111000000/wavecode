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
  readonly chips: ReadonlyArray<string>;
  readonly Icon: (p: { size?: number }) => JSX.Element;
};

const FEATURES: ReadonlyArray<Feature> = [
  {
    title: 'AI-агент правит в реальном времени',
    body:
      'LLM через tool-calling: read_score, edit_score, replace_score, ' +
      'eval_snippet, undo_score. Streaming-ответы, отмена на Esc, ' +
      'сохранение истории диалога в IndexedDB.',
    tone: 'amber',
    chips: ['tool-calling', 'streaming', 'M3 / LiteLLM'],
    Icon: AgentIcon,
  },
  {
    title: 'Strudel mini-notation',
    body:
      'Партитуры — это JS со встроенным парсером pattern-нотации: ' +
      '<bd sd hh>, [bd sd]*, ~ и : для rests / slow / every-cycle. ' +
      'Полный Tonal + 200+ функций для синтеза и эффектов.',
    tone: 'cyan',
    chips: ['mini-notation', '@strudel/core', '@strudel/tonal'],
    Icon: PatternIcon,
  },
  {
    title: 'Web Audio, без бэкенда',
    body:
      '@strudel/webaudio поднимает AudioContext в main thread и ' +
      'играет паттерны через oscillators + sample-banks прямо из ' +
      'твоего браузера. Никакого серверного аудио.',
    tone: 'magenta',
    chips: ['Web Audio API', 'evalScope', 'sample banks'],
    Icon: AudioIcon,
  },
  {
    title: 'CodeMirror 6 + автокомплит',
    body:
      'Strudel-aware подсветка mini-notation, keyMap с quick-actions, ' +
      'линтер на синтаксические ошибки, undo/redo в редакторе и ' +
      'в чате — независимо.',
    tone: 'amber',
    chips: ['@codemirror/state', '@codemirror/lint', 'keymap'],
    Icon: EditorIcon,
  },
  {
    title: 'Persistence из коробки',
    body:
      'Autosave score + история чата в IndexedDB через idb-keyval. ' +
      'Пользовательские пресеты — в localStorage. После reload всё ' +
      'на месте, включая непрочитанные правки агента.',
    tone: 'cyan',
    chips: ['idb-keyval', 'autosave', 'zero-config'],
    Icon: StorageIcon,
  },
  {
    title: 'Поделиться одной ссылкой',
    body:
      'Snapshot score → LZ-string → URL hash ?s=. Открыл — редактор ' +
      'спрашивает: «Загрузить сниппет и перезаписать локальный score?» ' +
      'Без бэкенда и без аккаунтов.',
    tone: 'magenta',
    chips: ['lz-string', '?s=...', 'no auth'],
    Icon: ShareIcon24,
  },
];

/**
 * Features — 6 user-facing-фич в виде карточек 3 × 2.
 * Каждая карточка: иконка (spectrum-tone), заголовок, описание,
 * meta-чипы. Hover подсвечивает карточку цветом tone.
 */
export function Features(): JSX.Element {
  return (
    <section id="features" class="l-section" aria-labelledby="features-title">
      <header class="l-section__head">
        <span class="l-section__kicker">04 · features</span>
        <h2 class="l-section__title" id="features-title">
          Шесть систем, которые работают вместе.
        </h2>
        <p class="l-section__sub">
          Внутри — четыре слоя (domain → application → infrastructure →
          presentation), Effect-TS для DI, ESLint, не пускающий
          инфраструктуру в домен. Фичи ниже — внешний фасад всего этого.
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
              <div class="l-feature__chips" aria-hidden="true">
                <For each={f.chips}>
                  {(c) => <span class="l-feature__chip">{c}</span>}
                </For>
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
