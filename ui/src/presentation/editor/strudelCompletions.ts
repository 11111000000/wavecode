import type { Completion, CompletionSource } from '@codemirror/autocomplete';

/**
 * Static list of common Strudel functions for autocompletion.
 * Source: https://strudel.cc/learn/functions/
 */

const STRUDEL_FUNCTIONS: ReadonlyArray<Completion> = [
  { label: 's', type: 'function', info: 'Сыграть сэмпл по имени (например, s("bd sd"))' },
  { label: 'n', type: 'function', info: 'Задать номер ноты (например, n("0 2 4"))' },
  { label: 'stack', type: 'function', info: 'Наложить паттерны друг на друга' },
  { label: 'cat', type: 'function', info: 'Склеить паттерны последовательно' },
  { label: 'sequence', type: 'function', info: 'Пройти паттерн по циклам' },
  { label: 'every', type: 'function', info: 'Применять функцию каждый n-й цикл' },
  { label: 'sometimes', type: 'function', info: 'Применять функцию с вероятностью 50%' },
  { label: 'often', type: 'function', info: 'Применять функцию с вероятностью 75%' },
  { label: 'rarely', type: 'function', info: 'Применять функцию с вероятностью 25%' },
  { label: 'jux', type: 'function', info: 'Применить функцию к правому каналу' },
  { label: 'juxBy', type: 'function', info: 'Применить функцию к правому каналу с долей' },
  { label: 'rev', type: 'function', info: 'Развернуть паттерн' },
  { label: 'invert', type: 'function', info: 'Инвертировать паттерн' },
  { label: 'iter', type: 'function', info: 'Повторить паттерн n раз' },
  { label: 'fast', type: 'function', info: 'Ускорить паттерн в коэффициент раз' },
  { label: 'slow', type: 'function', info: 'Замедлить паттерн в коэффициент раз' },
  { label: 'chop', type: 'function', info: 'Нарезать сэмпл на куски' },
  { label: 'striate', type: 'function', info: 'Прорезать сэмпл по циклам' },
  { label: 'mask', type: 'function', info: 'Маскировать паттерн другим (1 = оставить, 0 = убрать)' },
  { label: 'off', type: 'function', info: 'Сместить функцию на n циклов' },
  { label: 'add', type: 'function', info: 'Прибавить к значению' },
  { label: 'sub', type: 'function', info: 'Вычесть из значения' },
  { label: 'mul', type: 'function', info: 'Умножить значение' },
  { label: 'div', type: 'function', info: 'Разделить значение' },
  { label: 'scale', type: 'function', info: 'Отобразить значения на музыкальную шкалу' },
  { label: 'transpose', type: 'function', info: 'Транспонировать на полутонов' },
  { label: 'gain', type: 'function', info: 'Задать громкость (0..1)' },
  { label: 'speed', type: 'function', info: 'Изменить скорость воспроизведения' },
  { label: 'pan', type: 'function', info: 'Панорама (-1 слева .. 1 справа)' },
  { label: 'hush', type: 'function', info: 'Остановить всё' },
];

export const strudelCompletions: CompletionSource = (context) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [...STRUDEL_FUNCTIONS],
  };
};