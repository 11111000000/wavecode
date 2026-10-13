import {
  noteNumberToName,
  multiNoteSnippet,
  SILENCE_SNIPPET,
} from '~/domain/music/notes';

/**
 * Pure helper for the on-screen / MIDI piano. Builds a Strudel snippet
 * for the currently held MIDI numbers.
 *
 *  - 0 notes → `SILENCE_SNIPPET` (explicit silence — Strudel stops the
 *              previous scheduler chain and the user hears the natural
 *              envelope decay of the prior note, then nothing).
 *  - 1+ notes → `multiNoteSnippet` (single voice, or `stack(...)` for 2+).
 *
 * Isolated so the component stays focused on Solid lifecycle; the
 * snippet grammar lives entirely in `~/domain/music/notes.ts`.
 */
export const buildPianoSnippet = (activeMidi: ReadonlySet<number>): string => {
  if (activeMidi.size === 0) return SILENCE_SNIPPET;
  const names = new Set<string>();
  for (const m of activeMidi) names.add(noteNumberToName(m));
  return multiNoteSnippet(names);
};
