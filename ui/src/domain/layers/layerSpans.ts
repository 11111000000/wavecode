/**
 * layerSpans — абсолютные границы слоёв партитуры.
 *
 * Зачем
 * -----
 * Слои партитуры перечисляются в трёх местах: микшер (строки),
 * `injectMix` (переписывает `.gain`) и новая правка звука слоя
 * (переписывает `.s`). Если у каждого своё перечисление, они
 * разъезжаются: микшер показывает 4 строки, а правка звука
 * меняет `.s` в другом месте — и человек нажимает на «Слой 2»,
 * а играет слой 5. Это ровно тот класс тихих поломок, который
 * приложение уже наловило (см. `decisions/wavecode-mixer-live-update`).
 *
 * Поэтому перечисление живёт в ОДНОМ месте, и все потребители
 * берут границы отсюда. Порядок совпадает с `validateForMixer`:
 * стеки в порядке появления в тексте, внутри стека — аргументы
 * в порядке появления; пустые и «только комментарий» слоты
 * строки не занимают.
 *
 * Нумерация строк микшера и индексы здесь — одно и то же число.
 */

import { collectStacksOf } from '~/domain/strudel/walker';

/** Границы одного слоя в тексте партитуры. */
export type LayerSpan = {
  /** Номер слоя — он же номер строки микшера (с нуля). */
  readonly index: number;
  /** Номер секции (стэка) внутри партитуры. */
  readonly section: number;
  /** Начало слоя — абсолютный offset в тексте партитуры. */
  readonly start: number;
  /** Конец слоя — абсолютный offset (exclusive). */
  readonly end: number;
  /** Исходный текст слоя — ровно как в партитуре, без обрезки. */
  readonly source: string;
};

/** Слот без кода (пустой или только комментарий) — строки не занимает. */
const isBlankSlot = (raw: string): boolean =>
  raw.replace(/\/\/.*$/gm, '').trim() === '';

/**
 * Все слои партитуры с их абсолютными границами.
 *
 * Если в партитуре нет ни одного `stack(…)`, весь текст считается
 * одним слоем — так же, как в `validateForMixer`, чтобы номер строки
 * микшера и номер слоя здесь всегда совпадали.
 */
export const listLayerSpans = (score: string): ReadonlyArray<LayerSpan> => {
  if (!score.trim()) return [];
  // Стек собирается из СЫРОГО текста партитуры: смещения `Arg.span`
  // абсолютные, и обрезка краёв сдвинула бы их относительно `score`.
  const stacks = collectStacksOf(score);
  if (stacks.length === 0) {
    return [{ index: 0, section: 0, start: 0, end: score.length, source: score }];
  }
  const out: LayerSpan[] = [];
  let index = 0;
  for (let section = 0; section < stacks.length; section += 1) {
    const ref = stacks[section]!;
    for (const arg of ref.args) {
      const start = arg.span.start;
      const end = arg.span.end;
      const raw = score.slice(start, end);
      if (isBlankSlot(raw)) continue;
      out.push({ index, section, start, end, source: raw });
      index += 1;
    }
  }
  return out;
};
