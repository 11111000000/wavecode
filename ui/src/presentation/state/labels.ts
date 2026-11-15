import type { LogLevel } from '~/infrastructure/log/logger';
import type { AgentStatus, AudioStatus } from '~/domain/types';

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

/** Перевести значение перечисления; неизвестное — оставить как есть. */
export const labelFor = (
  table: Readonly<Record<string, string>>,
  value: string,
): string => table[value] ?? value;
