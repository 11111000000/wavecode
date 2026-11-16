import { listLayerSpans } from '~/domain/layers/layerSpans';
import { replaceLayerSound } from '~/domain/layers/layerSound';

/**
 * injectLayerSound — pure application use case.
 *
 * Меняет инструмент ОДНОГО слоя партитуры: переписывает `.s("…")`
 * в его тексте на `.s("<soundId>")`.
 *
 * Правила:
 *   - `layerIndex` — тот же номер, что у строки микшера (с нуля).
 *     Перечисление слоёв живёт в `domain/layers/layerSpans`, так что
 *     строка микшера и эта правка всегда указывают на один слой.
 *   - Если у слоя уже есть `.s("…")` — переписывается ПОСЛЕДНИЙ
 *     вызов (в цепочке Strudel побеждает последний).
 *   - Если `.s("…")` нет — он дописывается в конец цепочки, и слой
 *     начинает играть выбранным инструментом вместо дефолтного.
 *   - Остальные слои и весь остальной текст партитуры не трогаются:
 *     правка точечная, по границам слоя.
 *   - Номер слоя вне диапазона — партитура возвращается без изменений
 *     (интерфейс не должен падать из-за гонки со сменой пресета).
 *
 * Отдельно про `drums`: ударный слой (`s("drums_bd …")`) — это не
 * инструмент, а выбор сэмпла, поэтому менять его нельзя. Такие
 * слои интерфейс не предлагает менять (см. `isMelodicLayer`).
 */
export const injectLayerSound = (
  score: string,
  layerIndex: number,
  soundId: string,
): string => {
  if (!score.trim() || soundId.trim() === '') return score;
  const spans = listLayerSpans(score);
  const target = spans.find((s) => s.index === layerIndex);
  if (target === undefined) return score;
  const rewritten = replaceLayerSound(target.source, soundId);
  if (rewritten === target.source) return score;
  return `${score.slice(0, target.start)}${rewritten}${score.slice(target.end)}`;
};
