/**
 * Pure типы для MIDI-моста.
 *
 * Архитектура: domain не знает про @tonejs/midi и про Strudel.
 * Только структуры данных, передаваемые между application- и
 * infrastructure-слоями (через domain — единственный законный
 * путь).
 *
 * SMF = Standard MIDI File — формат MIDI-файла (header + tracks +
 * variable-length-quantities, см. midi-file spec).
 */

export type MIDINote = {
  readonly midi: number;
  readonly timeSec: number;
  readonly durationSec: number;
  readonly velocity: number;
  readonly name?: string;
};

export type MIDITrack = {
  readonly channel: number;
  readonly notes: ReadonlyArray<MIDINote>;
};

export type MIDISequence = {
  readonly bpm: number;
  readonly ppq: number;
  readonly tracks: ReadonlyArray<MIDITrack>;
  readonly durationSec: number;
};

export type MIDIExportOptions = {
  readonly bpm: number;
  readonly cycles: number;
  readonly ppq?: number;
  readonly defaultVelocity?: number;
};

export type MIDIImportOptions = {
  readonly bpm?: number;
  readonly quantizeGrid?: number;
  readonly drumsAsSamples?: boolean;
};

export type MIDIImportResult =
  | { readonly ok: true; readonly score: string; readonly warnings: ReadonlyArray<string> }
  | { readonly ok: false; readonly error: string };

export type MIDIExportResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly warnings: ReadonlyArray<string> }
  | { readonly ok: false; readonly error: string };