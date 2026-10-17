import { For, createSignal, type JSX } from 'solid-js';
import { HERO_SNIPPET } from '../snippet';
import { renderSnippet } from '../snippet';
import { PlayIcon, StopIcon } from '../icons';
import { previewPreset, stopPreview } from '../../../state/audioActions';

type PresetItem = {
  readonly id: string;
  readonly name: string;
  readonly genre: string;
  readonly tone: 'primary' | 'cyan' | 'magenta';
};

const PRESETS: ReadonlyArray<PresetItem> = [
  { id: 'creep',          name: 'Creep',           genre: 'Индie-рок · Radiohead',   tone: 'primary'   },
  { id: 'edm-house',      name: 'EDM 4-on-floor',   genre: 'Хаус · 128 BPM',           tone: 'cyan'    },
  { id: 'hiphop-boombap', name: 'Хип-хоп',          genre: '90-е · Нью-Йорк',          tone: 'magenta' },
  { id: 'jazz-ii-v-i',    name: 'Джаз ii-V-I',      genre: 'Бибоп · ходячий бас',     tone: 'primary'   },
  { id: 'bossa-nova',     name: 'Босса-нова',      genre: '3+2 · клаве',              tone: 'cyan'    },
  { id: 'trap-atlanta',   name: 'Трэп',             genre: '808 · суб-бас',            tone: 'magenta' },
];

/**
 * SnippetShowcase — подборка готовых мелодий, кликабельные.
 * Клик по карточке → /app?preset=<id> → редактор загружает score.
 * Кнопка ▶ в углу карточки — превью пресета прямо на лендинге,
 * без перехода в редактор; повторный тап / тап соседней карточки
 * останавливает текущий preview (см. decisions/wavecode-landing-preset-preview).
 * Под каждой карточкой — жанр (простым языком) + кнопка «Открыть».
 * Сверху — большой snippet с подсветкой (тот же Creep) для понимания,
 * что за «код» имеется в виду.
 */
export function SnippetShowcase(): JSX.Element {
  const [playingPreviewId, setPlayingPreviewId] = createSignal<string | null>(null);

  const open = (id: string): void => {
    // Hash-router navigation (see Hero.tsx for full rationale).
    const target = `#/app?preset=${encodeURIComponent(id)}`;
    window.history.pushState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const togglePreview = (id: string, e: MouseEvent): void => {
    // The play button is INSIDE a card-wide click target that navigates
    // to the editor. Without stopPropagation, every preview tap would
    // also navigate to /#/app?preset=<id> — a regression from the
    // intended UX where audition ≠ open.
    e.stopPropagation();
    if (playingPreviewId() === id) {
      stopPreview();
      setPlayingPreviewId(null);
      return;
    }
    // New tap on a different card (or the first tap) — switch preview.
    // previewPreset() internally calls stopPreview() first, so we don't
    // need to clear `playingPreviewId()` before launching.
    setPlayingPreviewId(id);
    void previewPreset(id).then(() => {
      // If the eval promise resolves AFTER the user already toggled to
      // another preset, do not flip the signal back — the new card owns
      // the playing state. Same if it rejects: leave signal as-is so
      // the UI is consistent with what was clicked.
      if (playingPreviewId() !== id) return;
    });
  };

  return (
    <section id="presets" class="l-section" aria-labelledby="presets-title">
      <header class="l-section__head">
        <span class="l-section__kicker">01 · примеры</span>
        <h2 class="l-section__title" id="presets-title">
          Готовые мелодии. Нажми — откроется в редакторе.
        </h2>
        <p class="l-section__sub">
          Не нужно писать ничего с нуля. Кликни на любую — редактор
          загрузит её в код, останется нажать <kbd>▶</kbd> внизу справа.
          Дальше меняй что хочешь — хоть словами через AI, хоть руками
          прямо в коде.
        </p>
      </header>

      <div class="l-presets" role="list">
        <For each={PRESETS}>
          {(p) => {
            const isPlaying = (): boolean => playingPreviewId() === p.id;
            return (
              <button
                type="button"
                class="l-preset"
                data-tone={p.tone}
                data-previewing={isPlaying() ? 'true' : 'false'}
                role="listitem"
                aria-label={`Открыть пресет «${p.name}» в редакторе`}
                onClick={() => open(p.id)}
              >
                <span class="l-preset__name">{p.name}</span>
                <span class="l-preset__genre">{p.genre}</span>
                <span class="l-preset__cta">
                  Открыть →
                </span>
                <span
                  class="l-preset__play"
                  data-playing={isPlaying() ? 'true' : 'false'}
                  role="button"
                  tabindex="0"
                  aria-label={isPlaying() ? `Остановить превью «${p.name}»` : `Послушать превью «${p.name}»`}
                  aria-pressed={isPlaying() ? 'true' : 'false'}
                  onClick={(e) => togglePreview(p.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      togglePreview(p.id, e as unknown as MouseEvent);
                    }
                  }}
                >
                  {isPlaying() ? <StopIcon size={12} /> : <PlayIcon size={12} />}
                </span>
              </button>
            );
          }}
        </For>
      </div>

      <div class="l-snippet-hint">
        <span class="l-snippet-hint__q">А что за «код»?</span>
        <p>
          Вот как выглядит мелодия «Creep» на языке, который понимает браузер.
          Меняй любую строчку — музыка меняется сразу.
        </p>
        <div class="l-code" role="figure" aria-label="Пример кода мелодии">
          <div class="l-code__header">
            <span class="l-code__dots" aria-hidden="true">
              <span /><span /><span />
            </span>
            <span class="l-code__name">creep.strudel</span>
            <span class="l-code__live">
              <span class="l-led" />
              <span>пример</span>
            </span>
          </div>
          <div class="l-code__body" aria-hidden="false">
            {renderSnippet(HERO_SNIPPET)}
          </div>
        </div>
      </div>
    </section>
  );
}