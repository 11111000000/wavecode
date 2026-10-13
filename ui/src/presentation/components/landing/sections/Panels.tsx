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
    name: 'Transport',
    body: 'Play · Stop · Cycle (cps) · BPM. Loop-сегмент, A/B playhead для stage-сетапов.',
    tone: 'amber',
    Icon: TransportIcon,
  },
  {
    name: 'Mixer',
    body: 'Per-track gain, pan, reverb send, mute. Звук микшируется на лету без перезапуска eval.',
    tone: 'cyan',
    Icon: MixerIcon,
  },
  {
    name: 'Piano',
    body: 'Экранная MIDI-клавиатура 2 октавы. Клик + MIDI-in через WebMIDI. Active-notes indicator.',
    tone: 'magenta',
    Icon: PianoIcon24,
  },
  {
    name: 'Step Grid',
    body: 'Drum-machine: 16 шагов × 8 треков. Click → toggle. Изменения сразу попадают в pattern.',
    tone: 'amber',
    Icon: StepGridIcon,
  },
  {
    name: 'Recording',
    body: 'Record в .mid прямо в браузере через @tonejs/midi. Share-link — без бэкенда.',
    tone: 'cyan',
    Icon: RecordIcon24,
  },
  {
    name: 'MIDI I/O',
    body: 'WebMIDI-устройства: in/out. Auto-reconnect на devicechange. 60 fps без блокировок.',
    tone: 'magenta',
    Icon: MidiIcon,
  },
  {
    name: 'Sample Bank',
    body: 'Freesound CC0: drums, piano, bass, toms. Прогресс через Service Worker cache, pre-load на старте.',
    tone: 'amber',
    Icon: SampleIcon,
  },
  {
    name: 'Console',
    body: 'Bottom-right FAB. Кольцо ошибок Strudel / source auto-detect. Клик — вкладки Errors / All / By source.',
    tone: 'silver',
    Icon: ConsoleIcon,
  },
];

export function Panels(): JSX.Element {
  return (
    <section id="tools" class="l-section" aria-labelledby="tools-title">
      <header class="l-section__head">
        <span class="l-section__kicker">06 · tools</span>
        <h2 class="l-section__title" id="tools-title">
          8 инструментов внутри редактора.
        </h2>
        <p class="l-section__sub">
          Каждая панель открывается контекстно — через FAB или chip в
          верхней панели. Никаких перекрытий, draggable bottom-sheets,
          snap-points 30% / 90%, safe-area на iPhone-notch.
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
