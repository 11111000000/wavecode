import type { Score, TransportState } from '~/domain/types';

/**
 * Pure transport-aware wrapper for Strudel score evaluation.
 *
 * Side-effects (swing toggle) живут ВНЕ score — score в IDB остаётся
 * чистым, swing применяется только на лету при eval через эту обёртку.
 *
 * Это решает две задачи:
 *   1. ИИ-edit работает с raw score без `.swing()` — не зацикливается
 *      на transport-side комментариях в LLM-prompt.
 *   2. Swing toggle мгновенный и обратимый: off → score откатывается
 *      к raw-виду, без артефактов предыдущего toggle.
 *
 * Wrapper без эффектов (swing off) — idempotent, возвращает input без
 * изменений. Swing on — оборачивает в `(score).swing(0.5, 1/3)`
 * (стандартный shuffle-16ths из Strudel docs).
 */
export const evalWithTransport = (score: Score, transport: TransportState): Score => {
  if (!transport.swing) return score;
  return `(${score}).swing(0.5, 1/3)`;
};
