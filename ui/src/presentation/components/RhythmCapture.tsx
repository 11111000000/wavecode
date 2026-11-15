import { For, type JSX } from 'solid-js';
import { CloseIcon } from '../icons';
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
  toggleRhythmStep,
} from '../state/rhythmStore';
import { closeInputDock } from '../state/inputMode';

/**
 * RhythmCapture — поверхность ритм-ввода внутри входного дока.
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
 * ввода (единственная плавающая кнопка приложения) в режиме «Ритм»
 * делает ровно это — ставит отметку на текущем шаге. Сама клетка
 * сетки тоже кликается: так шаг можно поставить точно.
 *
 * Чего здесь нет
 * --------------
 *   - микрофона: ритм — это пальцы, а не звук (микрофонная ветка
 *     `feat/rhythm-recorder` осталась отдельной идеей);
 *   - второго «Применить»-сценария: паттерн уходит в партитуру
 *     ровно одним действием — тем же путём `appendToTopStack` +
 *     `replaceScore`, что и микрофонный док.
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

        <span class="rhythm-capture__status" aria-live="polite">
          {statusText()}
        </span>

        <button
          type="button"
          class="rhythm-capture__close"
          aria-label="Закрыть панель ввода"
          title="Закрыть"
          onClick={() => {
            // Закрытие панели = конец прохода: часы не должны крутиться
            // в фоне, пока панели нет.
            stopRhythmTake();
            closeInputDock();
          }}
        >
          <CloseIcon size={14} />
        </button>
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
