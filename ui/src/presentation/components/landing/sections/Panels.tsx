import { For, type JSX } from 'solid-js';
import {
  TransportIcon, MixerIcon, PianoIcon24, StepGridIcon,
  RecordIcon24, MidiIcon, SampleIcon, ConsoleIcon,
} from '../icons';

type Panel = {
  readonly name: string;
  readonly body: string;
  readonly tone: 'amber' | 'cyan' | 'magenta' | 'silver';
  readonly Icon: (p: { size?: number }) => JSX.Element;
};

const PANELS: ReadonlyArray<Panel> = [
  {
    name: 'Play / Stop',
    body: 'Запустить, остановить, поставить на паузу. Одна кнопка снизу справа.',
    tone: 'amber',
    Icon: TransportIcon,
  },
  {
    name: 'Микшер',
    body: 'Громкость каждого трека, панорама, общие эффекты — ревер и эхо.',
    tone: 'cyan',
    Icon: MixerIcon,
  },
  {
    name: 'Клавиатура',
    body: 'Экранное пианино. Можно играть мышкой или подключить MIDI-клавиатуру.',
    tone: 'magenta',
    Icon: PianoIcon24,
  },
  {
    name: 'Бит-бокс',
    body: 'Сетка 16×8 для ударных. Клик — нота звучит. Меняешь сетку — меняется бит.',
    tone: 'amber',
    Icon: StepGridIcon,
  },
  {
    name: 'Запись',
    body: 'Сыграй что-нибудь — получится .mid файл, который можно скачать.',
    tone: 'cyan',
    Icon: RecordIcon24,
  },
  {
    name: 'MIDI',
    body: 'Подключай любые MIDI-устройства — клавиатуры, контроллеры, синтезаторы.',
    tone: 'magenta',
    Icon: MidiIcon,
  },
  {
    name: 'Библиотека звуков',
    body: 'Готовые наборы ударных, фортепиано, баса — не нужно ничего скачивать.',
    tone: 'amber',
    Icon: SampleIcon,
  },
  {
    name: 'Подсказки',
    body: 'Если что-то пошло не так — внизу справа кнопка, покажет подробности ошибки.',
    tone: 'silver',
    Icon: ConsoleIcon,
  },
];

/**
 * Panels — восемь инструментов редактора простым языком.
 * Без «MIDI I/O», «WebMIDI devicechange» — только то, что
 * имеет смысл для нового пользователя.
 */
export function Panels(): JSX.Element {
  return (
    <section id="tools" class="l-section" aria-labelledby="tools-title">
      <header class="l-section__head">
        <span class="l-section__kicker">04 · что внутри</span>
        <h2 class="l-section__title" id="tools-title">
          Восемь инструментов в редакторе.
        </h2>
        <p class="l-section__sub">
          Каждый открывается в отдельной панели. Не нужно изучать
          всё сразу — начни с кнопки Play и пресетов.
        </p>
      </header>

      <div class="l-panels" role="list">
        <For each={PANELS}>
          {(p) => (
            <article class="l-panel-card" data-tone={p.tone} role="listitem">
              <span class="l-panel-card__icon" aria-hidden="true">
                <p.Icon size={20} />
              </span>
              <h3 class="l-panel-card__title">{p.name}</h3>
              <p class="l-panel-card__body">{p.body}</p>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
