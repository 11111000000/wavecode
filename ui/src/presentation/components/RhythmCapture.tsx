import { For, type JSX } from 'solid-js';
import {
  RHYTHM_COLUMNS,
  RHYTHM_STEPS,
  applyRhythmToScore,
  clearRhythmTake,
  nudgeRhythmTempo,
  rhythmCountIn,
  rhythmPlayStep,
  rhythmRunning,
  rhythmSteps,
  rhythmStepVoice,
  rhythmTempoBpm,
  startRhythmTake,
  stopRhythmTake,
  tapRhythmStep,
  toggleRhythmStep,
} from '../state/rhythmStore';
import { evalScore } from '../state/audioActions';
import { appStore } from '../state/appStore';
import { closeInputSheet } from '../state/inputMode';

/**
 * RhythmCapture — вкладка «Ритм» листа ввода.
 *
 * Что здесь
 * ---------
 *   - темп (BPM) кнопками «−/＋» и числовым readout'ом;
 *   - сетка 4×4 = 16 шагов (строка = одна доля такта);
 *   - отсчёт и указатель на текущем шаге;
 *   - «Очистить» (вторичное) и «Применить к партитуре» (основное).
 *
 * Как это работает
 * ----------------
 * Take — это ПРОХОД по сетке: сначала отсчёт, потом указатель едет по
 * шестнадцатым со скоростью темпа, а палец отмечает шаги. Кнопка
 * «Отметить» ставит отметку на текущем шаге, а сама клетка сетки
 * кликается — так шаг можно поставить точно.
 *
 * Чего здесь нет
 * --------------
 *   - микрофона: ритм — это пальцы, а не звук;
 *   - кнопки закрытия: лист ввода закрывается сам, и закрытие гасит
 *     проход (часы не крутятся в фоне, пока листа нет).
 */

const STEP_INDICES: readonly number[] = Array.from(
  { length: RHYTHM_STEPS },
  (_, i) => i,
);

/**
 * Как называется голос шага по-русски — для подсказки на клетке.
 *
 * Подпись нужна, чтобы человек понимал, ЧТО он отметит: шаг на
 * сильной доле — бочка, на второй и четвёртой — малый барабан,
 * остальные — хай-хэт.
 */
const STEP_VOICE_LABEL: Record<'bd' | 'sd' | 'hh', string> = {
  bd: 'бочка',
  sd: 'малый барабан',
  hh: 'хай-хэт',
};

export function RhythmCapture(): JSX.Element {
  const tappedCount = (): number =>
    rhythmSteps().filter((on) => on === true).length;

  /** Одна фраза о том, что происходит — как строка статуса у голоса. */
  const statusText = (): string => {
    const countIn = rhythmCountIn();
    if (countIn > 0) return `Отсчёт: ${countIn} — услышите щелчок и начните`;
    if (rhythmRunning()) {
      return `Идёт · шаг ${rhythmPlayStep() + 1} из ${RHYTHM_STEPS}`;
    }
    const count = tappedCount();
    if (count > 0) return `Готово · шагов: ${count}`;
    return 'Нажмите «Старт» — пойдут щелчки, отмечайте шаги';
  };

  const onStartStop = (): void => {
    if (rhythmRunning()) {
      stopRhythmTake();
      return;
    }
    startRhythmTake();
  };

  /**
   * Применить паттерн к партитуре.
   *
   * После вставки закрываем лист ввода. Иначе результат остаётся
   * ЗА листом: партитура изменилась, а пользователь её не видит —
   * лист занимает пол-экрана и закрывает редактор. Вместе с тишиной
   * (паттерн не переоценивался) это и давало «настучать Ритм — ничего
   * не происходит». Теперь партитура сразу на экране и сразу звучит.
   */
  const onApply = (): void => {
    const ok = applyRhythmToScore();
    if (!ok) return;
    void evalScore(appStore.score);
    closeInputSheet();
  };

  return (
    <div class="rhythm-capture" data-state={rhythmRunning() ? 'running' : 'idle'}>
      <div class="rhythm-capture__head">
        <div
          class="rhythm-capture__tempo"
          role="group"
          aria-label="Темп, ударов в минуту"
        >
          <button
            type="button"
            class="rhythm-capture__tempo-btn"
            aria-label="Темп минус"
            title="Темп минус"
            onClick={() => { nudgeRhythmTempo(-1); }}
          >
            −
          </button>
          <span class="rhythm-capture__tempo-value" aria-live="polite">
            {rhythmTempoBpm()}
            <span class="rhythm-capture__tempo-unit">BPM</span>
          </span>
          <button
            type="button"
            class="rhythm-capture__tempo-btn"
            aria-label="Темп плюс"
            title="Темп плюс"
            onClick={() => { nudgeRhythmTempo(1); }}
          >
            +
          </button>
        </div>

        <button
          type="button"
          class="rhythm-capture__start"
          aria-pressed={rhythmRunning() ? 'true' : 'false'}
          title={
            rhythmRunning()
              ? 'Остановить проход по сетке'
              : 'Начать проход по сетке (с отсчётом)'
          }
          onClick={onStartStop}
        >
          {rhythmRunning() ? 'Стоп' : 'Старт'}
        </button>

        {/* wavecode-unified-input-entry: раньше тап по текущему шагу
         * делала плавающая круглая кнопка — та же самая, что начинала
         * запись голоса, только молча меняла смысл. Теперь у ритма
         * своя кнопка рядом с кнопкой «Старт», и микрофон здесь не
         * открывается НИКОГДА: ритм — это пальцы по сетке.
         *
         * wavecode-sound-choice-and-rhythm-feedback: кнопка больше НЕ
         * задизейблена. Раньше она была мёртвой до нажатия «Старт»,
         * а подсказка жила только в title — на тач-экране её нет, и
         * кнопка выглядела как «сломалась». Теперь она всегда живая:
         * нажатие вне прохода запускает проход (это уже умел сам
         * store), нажатие во время прохода отмечает текущий шаг. */}
        <button
          type="button"
          class="rhythm-capture__tap"
          aria-label={
            rhythmRunning()
              ? 'Отметить текущий шаг'
              : 'Отметить шаг — запустит проход по сетке'
          }
          title={
            rhythmRunning()
              ? 'Отметить текущий шаг'
              : 'Запустить проход по сетке и отмечать шаги'
          }
          onClick={() => { tapRhythmStep(); }}
        >
          Отметить
        </button>

        <span class="rhythm-capture__status" aria-live="polite">
          {statusText()}
        </span>
      </div>

      <div
        class="rhythm-capture__grid"
        role="group"
        aria-label="Сетка ритма: 16 шагов"
      >
        <For each={STEP_INDICES}>
          {(index) => (
            <button
              type="button"
              class="rhythm-capture__step"
              data-on={rhythmSteps()[index] === true ? 'true' : 'false'}
              data-current={
                rhythmRunning() && rhythmPlayStep() === index ? 'true' : 'false'
              }
              data-beat-start={index % RHYTHM_COLUMNS === 0 ? 'true' : 'false'}
              aria-label={`Шаг ${index + 1} — ${STEP_VOICE_LABEL[rhythmStepVoice(index)]}`}
              aria-pressed={rhythmSteps()[index] === true ? 'true' : 'false'}
              title={`Шаг ${index + 1} — ${STEP_VOICE_LABEL[rhythmStepVoice(index)]}`}
              onClick={() => { toggleRhythmStep(index); }}
            />
          )}
        </For>
      </div>

      <p class="rhythm-capture__hint">
        Строка — доля такта, клетка — шестнадцатая. Щёлкните клетку,
        чтобы поставить удар, или жмите «Отметить» на ходу.
      </p>

      <div class="rhythm-capture__actions">
        <button
          type="button"
          class="rhythm-capture__btn"
          title="Очистить сетку"
          onClick={() => { clearRhythmTake(); }}
        >
          Очистить
        </button>
        <button
          type="button"
          class="rhythm-capture__btn rhythm-capture__btn--primary"
          title="Добавить паттерн в партитуру"
          onClick={onApply}
        >
          Применить к партитуре
        </button>
      </div>
    </div>
  );
}
