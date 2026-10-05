/**
 * GM (General MIDI) percussion Note → Strudel s-name.
 *
 * Subset маппинга из GM Percussion Key Map (MMA, 1991).
 * Не все 128 — только те, для которых в Strudel есть встроенные
 * имена. Для не-мапленных — `null`, и note скипается в декодере.
 */

import type { DrumMap } from '~/domain/midi/decoder';

const ENTRIES: ReadonlyArray<readonly [number, string]> = [
  [35, 'bd'],
  [36, 'bd'],
  [38, 'sd'],
  [40, 'sd'],
  [37, 'sd'],
  [39, 'cp'],
  [42, 'hh'],
  [44, 'hh'],
  [46, 'ohh'],
  [49, 'crash'],
  [51, 'ride'],
  [45, 'tom'],
  [47, 'tom'],
  [48, 'tom'],
  [50, 'tom'],
  [43, 'tom'],
  [41, 'tom'],
];

export const gmDrumMap: DrumMap = new Map(ENTRIES);

export const isGMDrum = (midi: number): boolean => gmDrumMap.has(midi);