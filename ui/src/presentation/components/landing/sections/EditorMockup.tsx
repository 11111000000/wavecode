import type { JSX } from 'solid-js';

/**
 * EditorMockup — статичный мокап UI редактора (то, что увидит
 * пользователь после клика «Открыть редактор»):
 *   - TopBar с логотипом и LED-индикатором AudioContext;
 *   - PresetRow с чипсами;
 *   - split между CodeMirror panel и AI-чатом с typing-индикатором.
 *
 * Делает лендинг «честным» — пользователь видит, что его ждёт.
 */
export function EditorMockup(): JSX.Element {
  return (
    <section id="mockup" class="l-section" aria-labelledby="mockup-title">
      <header class="l-section__head">
        <span class="l-section__kicker">03 · editor</span>
        <h2 class="l-section__title" id="mockup-title">
          То, что ты увидишь через секунду после клика.
        </h2>
        <p class="l-section__sub">
          Редактор полностью в браузере: <strong>CodeMirror 6</strong> для
          score, чат с AI-агентом справа (tool-calling, streaming ответы,
          отмена на Esc), FAB-кнопка запуска снизу. Все тулбары —
          контекстные, появляются только когда нужны.
        </p>
      </header>

      <div class="l-mockup">
        <div class="l-mockup__frame">
          <div class="l-mockup__topbar">
            <span class="l-mockup__logo" />
            <span class="l-mockup__title">wavecode</span>
            <span class="l-mockup__spacer" />
            <span class="l-mockup__led">
              <span class="dot" />
              <span>▶ running · 44.1 kHz</span>
            </span>
            <div class="l-mockup__icons" aria-hidden="true">
              <span class="ico">↺</span>
              <span class="ico">↻</span>
              <span class="ico">↗</span>
              <span class="ico">≡</span>
            </div>
          </div>

          <div class="l-mockup__presets">
            <span class="l-mockup__chip" data-active="true">Creep</span>
            <span class="l-mockup__chip">EDM 4-on-floor</span>
            <span class="l-mockup__chip">Hip-hop boom-bap</span>
            <span class="l-mockup__chip">Jazz ii-V-I</span>
            <span class="l-mockup__chip">Bossa Nova</span>
            <span class="l-mockup__chip">Trap</span>
            <span class="l-mockup__chip">IDM glitch</span>
          </div>

          <div class="l-mockup__body">
            <div class="l-mockup__panel">
              <div class="l-mockup__panel-head">score · creep.strudel</div>
              <pre class="l-mockup__code" aria-hidden="true">
{`// Creep (Radiohead) — G → B → C → Cm, ~92 BPM
cat(
  // verse: clean arpeggio, один аккорд на такт
  stack(
    note("g3 b3 d4 b3 g3 b3 d4 b3")
      .s("triangle").decay(.28).sustain(0).gain(0.16).room(.5),
    note("g2").s("sawtooth").gain(0.3).lpf(300),
  ),
  stack(
    note("f#3 b3 d#4 b3 f#3 b3 d#4 b3")
      .s("triangle").decay(.28).sustain(0).gain(0.16).room(.5),
    note("b2").s("sawtooth").gain(0.3).lpf(300),
  ),
  // … C, Cm, затем chorus: distorted triads + drums
).slow(1.3)`}
              </pre>
            </div>

            <div class="l-mockup__panel">
              <div class="l-mockup__panel-head">chat · agent</div>
              <div class="l-mockup__chat">
                <div class="l-mockup__msg l-mockup__msg-user">
                  <span class="l-mockup__msg-role">U</span>
                  <span class="l-mockup__msg-text">
                    Сделай bass чуть глубже и добавь swing 16ths
                  </span>
                </div>
                <div class="l-mockup__msg l-mockup__msg-ai">
                  <span class="l-mockup__msg-role">A</span>
                  <span class="l-mockup__msg-text">
                    <div>edit_score(oldText: ".gain(0.4).lpf(300),", newText: ".gain(0.45).lpf(220).swing(0.4),")</div>
                    <div style={{ opacity: 0.5, 'font-size': '11px', 'margin-top': '4px' }}>
                      Tool call · applied · audio re-eval
                    </div>
                  </span>
                </div>
                <div class="l-mockup__msg l-mockup__msg-ai">
                  <span class="l-mockup__msg-role">A</span>
                  <span class="l-mockup__msg-text">
                    Готово. Bass стал 220 Hz на низком срезе, swing 0.4
                    с 1/16 делает звук живее. Проверь сцену: stack
                    теперь дышит <span style={{ color: 'var(--primary)' }}>★</span>
                  </span>
                </div>
                <div class="l-mockup__msg l-mockup__msg-ai">
                  <span class="l-mockup__msg-role">A</span>
                  <span class="l-mockup__msg-text">
                    <span class="l-mockup__typing">
                      <span /><span /><span />
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
