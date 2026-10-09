import type { Score, TransportState } from '~/domain/types';

/**
 * Pure transport-aware wrapper for Strudel score evaluation.
 *
 * Side-effects (swing amount + divisor) живут ВНЕ score — score в
 * IDB остаётся чистым, swing применяется только на лету при eval.
 *
 * Это решает две задачи:
 *   1. ИИ-edit работает с raw score без `.swing()` — не зацикливается
 *      на transport-side комментариях в LLM-prompt.
 *   2. Swing-toggle мгновенный и обратимый: amount=0 → score откатывается
 *      к raw-виду.
 *
 * Swing off (amount=0) — idempotent, возвращает input без изменений.
 * Swing on — оборачивает в `(score).swing(${amount}, ${divisor})`.
 */
export const evalWithTransport = (score: Score, transport: TransportState): Score => {
  if (transport.swingAmount <= 0) return score;
  const amount = transport.swingAmount;
  const divisor = transport.swingDivisor;
  return `(${score}).swing(${amount}, ${divisor})`;
};
