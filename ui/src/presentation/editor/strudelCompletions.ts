import type { Completion, CompletionSource } from '@codemirror/autocomplete';

/**
 * Static list of common Strudel functions for autocompletion.
 * Source: https://strudel.cc/learn/functions/
 */

const STRUDEL_FUNCTIONS: ReadonlyArray<Completion> = [
  { label: 's', type: 'function', info: 'Play a sample by name (e.g. s("bd sd"))' },
  { label: 'n', type: 'function', info: 'Set note number (e.g. n("0 2 4"))' },
  { label: 'stack', type: 'function', info: 'Layer patterns together' },
  { label: 'cat', type: 'function', info: 'Concatenate patterns sequentially' },
  { label: 'sequence', type: 'function', info: 'Step through patterns over cycles' },
  { label: 'every', type: 'function', info: 'Apply function every n cycles' },
  { label: 'sometimes', type: 'function', info: 'Apply function with 50% probability' },
  { label: 'often', type: 'function', info: 'Apply function with 75% probability' },
  { label: 'rarely', type: 'function', info: 'Apply function with 25% probability' },
  { label: 'jux', type: 'function', info: 'Apply function to right channel' },
  { label: 'juxBy', type: 'function', info: 'Apply function to right channel with ratio' },
  { label: 'rev', type: 'function', info: 'Reverse pattern' },
  { label: 'invert', type: 'function', info: 'Invert pattern' },
  { label: 'iter', type: 'function', info: 'Iterate pattern n times' },
  { label: 'fast', type: 'function', info: 'Speed up pattern by factor' },
  { label: 'slow', type: 'function', info: 'Slow down pattern by factor' },
  { label: 'chop', type: 'function', info: 'Chop sample into bits' },
  { label: 'striate', type: 'function', info: 'Striate sample across cycles' },
  { label: 'mask', type: 'function', info: 'Mask pattern by another (1 = keep, 0 = drop)' },
  { label: 'off', type: 'function', info: 'Apply function offset by n cycles' },
  { label: 'add', type: 'function', info: 'Add to value' },
  { label: 'sub', type: 'function', info: 'Subtract from value' },
  { label: 'mul', type: 'function', info: 'Multiply value' },
  { label: 'div', type: 'function', info: 'Divide value' },
  { label: 'scale', type: 'function', info: 'Map values to a musical scale' },
  { label: 'transpose', type: 'function', info: 'Transpose by semitones' },
  { label: 'gain', type: 'function', info: 'Set gain (0..1)' },
  { label: 'speed', type: 'function', info: 'Change playback speed' },
  { label: 'pan', type: 'function', info: 'Pan (-1 left .. 1 right)' },
  { label: 'hush', type: 'function', info: 'Stop everything' },
];

export const strudelCompletions: CompletionSource = (context) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [...STRUDEL_FUNCTIONS],
  };
};