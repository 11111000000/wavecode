import { For, type JSX } from 'solid-js';
import { HERO_SNIPPET, renderSnippet } from '../snippet';

type PresetItem = {
  readonly id: string;
  readonly name: string;
  readonly genre: string;
  readonly tone: 'amber' | 'cyan' | 'magenta';
};

const PRESETS: ReadonlyArray<PresetItem> = [
  { id: 'creep',            name: 'Creep',           genre: 'Indie · 4/4',     tone: 'amber'   },
  { id: 'edm-house',        name: 'EDM 4-on-floor',  genre: 'House · 128 BPM', tone: 'cyan'    },
  { id: 'hiphop-boombap',   name: 'Hip-hop boom-bap', genre: '90s NYC · swing', tone: 'magenta' },
  { id: 'jazz-ii-v-i',      name: 'Jazz ii-V-I',     genre: 'Bebop · walking', tone: 'amber'   },
  { id: 'bossa-nova',       name: 'Bossa Nova',      genre: '3+2 clave',      tone: 'cyan'    },
  { id: 'trap',             name: 'Trap',            genre: '808 sub · rolls', tone: 'magenta' },
  { id: 'idm-glitch',       name: 'IDM glitch',      genre: '5/4 + 7/8',      tone: 'amber'   },
  { id: 'dreampop',         name: 'Dreampop',        genre: '16th-note strum', tone: 'cyan'    },
];

/**
 * SnippetShowcase — два столбца: список пресетов и подсвеченный
 * Strudel-snippet. Snippet статический: AudioContext заблокирован до
 * user-gesture, автоплей на лендинге всё равно не сработает.
 */
export function SnippetShowcase(): JSX.Element {
  return (
    <section id="snippet" class="l-section" aria-labelledby="snippet-title">
      <header class="l-section__head">
        <span class="l-section__kicker">02 · snippet</span>
        <h2 class="l-section__title" id="snippet-title">
          8 встроенных пресетов. Добавляй свои.
        </h2>
        <p class="l-section__sub">
          Каждый пресет — это <strong>stack</strong> из 4–6 партий: бас,
          chord pad, арпеджио, ударные. Snippet ниже — один из них, со
          синтаксисом mini-notation:{' '}
          <code>&lt;...&gt;</code> · <code>[...]</code> · <code>*</code> · <code>~</code>.
          В редакторе открой «💾 Сохранить», чтобы добавить свой пресет в
          localStorage.
        </p>
      </header>

      <div class="l-snippet">
        <div class="l-snippet__col-presets">
          <h3>Presets</h3>
          <div class="l-snippet__preset-list" role="list">
            <For each={PRESETS}>
              {(p) => (
                <button
                  type="button"
                  class="l-snippet__preset"
                  data-tone={p.tone}
                  role="listitem"
                  aria-label={`Пресет: ${p.name}`}
                >
                  <span class="l-snippet__preset-name">{p.name}</span>
                  <span class="l-snippet__preset-genre">{p.genre}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="l-snippet__col-code">
          <div class="l-code" role="figure" aria-label="Creep (Radiohead) — Strudel snippet">
            <div class="l-code__header">
              <span class="l-code__dots" aria-hidden="true">
                <span /><span /><span />
              </span>
              <span class="l-code__name">creep.strudel · score</span>
              <span class="l-code__live">
                <span class="l-led" />
                <span>eval: ok</span>
              </span>
            </div>
            <div class="l-code__body" aria-hidden="false">
              {renderSnippet(HERO_SNIPPET)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
