import { For, Show, createEffect, type JSX } from 'solid-js';
import { BottomSheet } from '../BottomSheet';
import { SpeechInput, cancelSpeechOnSheetClose } from '../SpeechInput';
import { MicPanel } from '../MicPanel';
import { RhythmCapture } from '../RhythmCapture';
import {
  INPUT_MODES,
  getInputMode,
  setInputMode,
  isInputSheetOpen,
  type InputMode,
} from '../../state/inputMode';
import { INPUT_MODE_LABEL, INPUT_MODE_VERB } from '../../state/labels';
import { stopMic } from '../../state/micStore';
import { stopRhythmTake } from '../../state/rhythmStore';

/**
 * InputSheet — лист ввода: единственная точка, где что-то записывается.
 *
 * Что было
 * --------
 * Четыре кнопки ввода на трёх местах:
 *
 *   - плавающая круглая «Голос» — она же REC, она же тап-пад в ритме;
 *   - пункт рельса «Ввод» — открывал тот же док;
 *   - пункт листа «Инструменты» «Микрофон» — а это был свист;
 *   - переключатель «Голос | Ритм» в доке.
 *
 * Пользователь не мог отличить «голос записывает мелодию» от
 * «микрофон снимает высоту тона»: обе кнопки назывались устройством.
 *
 * Что стало
 * ---------
 * Одна круглая кнопка «Ввод» открывает этот лист. В листе — три
 * вкладки, названные по намерению:
 *
 *   ┌────────────────────────────────────────────┐
 *   │  Речь  │  Свист  │  Ритм                   │
 *   ├────────────────────────────────────────────┤
 *   │  (●) Записать   Готов к записи…            │
 *   │  [ текст ]                                  │
 *   │                          [ → В ИИ ]        │
 *   └────────────────────────────────────────────┘
 *
 * Почему именно вкладки, а не переключатель «Голос | Ритм»
 * -------------------------------------------------------
 * Модальностей стало три, а не две, и у них РАЗНЫЕ результаты: текст,
 * ноты, ритм. Переключатель из двух сегментов третью модальность уже
 * не вместил бы, а полоска вкладок показывает все сразу — пользователь
 * видит, что вариантов три, и выбирает осознанно.
 *
 * Почему названия — «Речь / Свист / Ритм»
 * -------------------------------------
 * Прежние названия были по устройству («Голос», «Микрофон»), а
 * устройство одно и то же. Названия по намерению отвечают на вопрос
 * пользователя «я сейчас что делаю?» прямо в подписи вкладки.
 *
 * Что видно в каждый момент
 * -------------------------
 *   - вкладка — что за модальность сейчас открыта;
 *   - глагол в статусной строке — что происходит с микрофоном
 *     («Слушаю речь…», «Слушаю высоту тона…», «Отсчёт: 4 из 8»);
 *   - кнопка записи — внутри вкладки, рядом со статусом.
 *
 * Три ответа на один вопрос, всегда рядом: расхождение между ними
 * физически невозможно.
 */
export function InputSheet(): JSX.Element {
  const mode = (): InputMode => getInputMode();
  let tabsRef: HTMLDivElement | undefined;

  /**
   * Переключение вкладки — это освобождение микрофона прежней
   * модальности. «Свист» и «Речь» делят один физический микрофон, и
   * оставить свистящий воронку включённой при переходе к речи значило
   * бы держать микрофон занятым без видимой причины.
   */
  const onTab = (next: InputMode): void => {
    if (next === mode()) return;
    if (next !== 'speech') void cancelSpeechOnSheetClose();
    if (next !== 'whistle') stopMic();
    if (next !== 'rhythm') stopRhythmTake();
    setInputMode(next);
  };

  /**
   * Клавиатура в полосе вкладок.
   *
   * Вкладки — это настоящий `role="tablist"` с бегущим `tabindex`
   * (в фокус попадает только активная). Такой паттерн требует
   * стрелок: без них две из трёх вкладок недостижимы с клавиатуры
   * вообще — Tab перескакивает на активную, а на остальные не
   * встать.
   *
   * Переход сразу активирует вкладку (automatic activation по ARIA):
   * пользователь не делает два нажатия ради одного перехода, а тело
   * вкладки меняется вместе с фокусом.
   */
  const onTabKey = (e: KeyboardEvent): void => {
    const order = INPUT_MODES;
    const current = order.indexOf(mode());
    if (current < 0) return;

    let next = -1;
    switch (e.key) {
      case 'ArrowRight':
        next = (current + 1) % order.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + order.length) % order.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = order[next];
    if (!target) return;
    onTab(target);
    // Фокус переезжает на новую вкладку: иначе стрелки перемещали бы
    // только подсветку, а клавиатурный пользователь остался бы на
    // прежней кнопке.
    const buttons = tabsRef?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  };

  /**
   * Закрытие листа гасит всё, что могло остаться включённым.
   *
   * Лист закрывают четырьмя путями (крестик, свайп вниз, клик по
   * фону, Esc), и ловить их по одному — надёжный способ забыть один.
   * Реактивная проверка «лист закрыт» ловит все четыре сразу.
   *
   * Готовый текст речи переживает закрытие (черновик можно дописать и
   * отправить позже), незавершённая запись отбрасывается.
   */
  createEffect(() => {
    if (isInputSheetOpen()) return;
    void cancelSpeechOnSheetClose();
    stopMic();
    stopRhythmTake();
  });

  return (
    <BottomSheet kind="input" title="Ввод" subtitle="что записать">
      <div class="input-sheet">
        <div
          class="input-tabs"
          role="tablist"
          aria-label="Способ ввода"
          ref={tabsRef}
          onKeyDown={onTabKey}
        >
          <For each={INPUT_MODES}>
            {(m) => (
              <button
                type="button"
                role="tab"
                class="input-tab"
                data-active={mode() === m ? 'true' : 'false'}
                aria-selected={mode() === m ? 'true' : 'false'}
                tabindex={mode() === m ? 0 : -1}
                title={INPUT_MODE_VERB[m]}
                onClick={() => { onTab(m); }}
              >
                {INPUT_MODE_LABEL[m]}
              </button>
            )}
          </For>
        </div>

        <div class="input-body" role="tabpanel">
          <Show when={mode() === 'speech'}>
            <SpeechInput />
          </Show>
          <Show when={mode() === 'whistle'}>
            <div class="input-mic">
              <MicPanel />
            </div>
          </Show>
          <Show when={mode() === 'rhythm'}>
            <RhythmCapture />
          </Show>
        </div>
      </div>
    </BottomSheet>
  );
}
