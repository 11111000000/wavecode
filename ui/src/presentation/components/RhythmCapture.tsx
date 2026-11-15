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
  rhythmTempoBpm,
  startRhythmTake,
  stopRhythmTake,
  tapRhythmStep,
  toggleRhythmStep,
} from '../state/rhythmStore';

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

export function RhythmCapture(): JSX.Element {
  const tappedCount = (): number =>
    rhythmSteps().filter((on) => on === true).length;

  /** Одна фраза о том, что происходит — как строка статуса у голоса. */
  const statusText = (): string => {
    const countIn = rhythmCountIn();
    if (countIn > 0) return `Счёт: ${countIn}`;
    if (rhythmRunning()) {
      return `Идёт · шаг ${rhythmPlayStep() + 1} из ${RHYTHM_STEPS}`;
    }
    const count = tappedCount();
    if (count > 0) return `Готово · шагов: ${count}`;
    return 'Старт — и простучите шаги';
  };

  const onStartStop = (): void => {
    if (rhythmRunning()) {
      stopRhythmTake();
      return;
    }
    startRhythmTake();
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
         * открывается НИКОГДА: ритм — это пальцы по сетке. */}
        <button
          type="button"
          class="rhythm-capture__tap"
          aria-label="Отметить текущий шаг"
          title={
            rhythmRunning()
              ? 'Отметить текущий шаг'
              : 'Сначала запустите проход по сетке'
          }
          disabled={!rhythmRunning()}
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
              aria-label={`Шаг ${index + 1}`}
              aria-pressed={rhythmSteps()[index] === true ? 'true' : 'false'}
              title={`Шаг ${index + 1}`}
              onClick={() => { toggleRhythmStep(index); }}
            />
          )}
        </For>
      </div>

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
          onClick={() => { applyRhythmToScore(); }}
        >
          Применить к партитуре
        </button>
      </div>
    </div>
  );
}
