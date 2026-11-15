import type { LogLevel } from '~/infrastructure/log/logger';
import type { AgentStatus, AudioStatus } from '~/domain/types';
import type { InputMode } from './inputMode';

/**
 * labels — русские подписи для служебных перечислений.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «единый язык»): интерфейс
 * должен быть на одном языке. Но уровни лога, состояние агента и
 * состояние аудио — это ДАННЫЕ, а не текст интерфейса: их значения
 * приходят из рантайма и участвуют в логах, фильтрах и тестах.
 * Менять сами значения нельзя — ломаются фильтры и рассылки.
 *
 * Поэтому значения остаются английскими, а на экран выводится
 * перевод. Единственное место, где английское значение ещё видно
 * пользователю — админка: там это осознанный технический вид.
 */

export const LOG_LEVEL_LABEL: Readonly<Record<LogLevel, string>> = {
  debug: 'отладка',
  info: 'инфо',
  warn: 'предупреждение',
  error: 'ошибка',
  fatal: 'критично',
};

export const AGENT_STATUS_LABEL: Readonly<Record<AgentStatus, string>> = {
  idle: 'ожидает',
  streaming: 'печатает',
  'awaiting-tool': 'ждёт инструмент',
  error: 'ошибка',
};

export const AUDIO_STATUS_LABEL: Readonly<Record<AudioStatus, string>> = {
  stopped: 'остановлен',
  playing: 'играет',
  error: 'ошибка',
};

/** Состояние AudioContext (браузерное API, значения задаёт браузер). */
export const CTX_STATE_LABEL: Readonly<Record<string, string>> = {
  running: 'работает',
  suspended: 'приостановлен',
  closed: 'закрыт',
  interrupted: 'прерван',
  none: 'не создан',
  uninitialized: 'не создан',
};

/**
 * Модальности ввода — названы по НАМЕРЕНИЮ, а не по устройству.
 *
 * wavecode-unified-input-entry: «Голос» и «Микрофон» называли одно и
 * то же устройство, а означали разные вещи (распознавание речи и
 * определение высоты тона). Теперь вкладка называет то, что делает
 * пользователь: говорит, свистит или стучит.
 */
export const INPUT_MODE_LABEL: Readonly<Record<InputMode, string>> = {
  speech: 'Речь',
  whistle: 'Свист',
  rhythm: 'Ритм',
};

/**
 * Что пользователь делает в каждой модальности — одной строкой.
 *
 * Показывается в подсказке кнопки записи: по глаголу видно, что
 * произойдёт, ещё до нажатия.
 */
export const INPUT_MODE_VERB: Readonly<Record<InputMode, string>> = {
  speech: 'Говорите — текст превратится в музыку',
  whistle: 'Свистите или играйте — ноты станут партитурой',
  rhythm: 'Стучите по сетке — соберётся ритм',
};

/** Перевести значение перечисления; неизвестное — оставить как есть. */
export const labelFor = (
  table: Readonly<Record<string, string>>,
  value: string,
): string => table[value] ?? value;
