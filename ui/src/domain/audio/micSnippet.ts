/**
 * micSnippetFromBuffers — the single source of truth for turning the
 * mic pipeline's two buffers (sustained notes + percussive transients)
 * into a Strudel snippet.
 *
 * Before this module existed, the snippet was built TWICE with
 * divergent logic:
 *
 *   - `micStore.applyToScore` called `notesToSnippet` +
 *     `transientsToSnippet` and stacked them correctly.
 *   - `MicPanel`'s Preview button had an inline `buildDemoSnippet`
 *     that re-implemented note naming/durations BY HAND, so what the
 *     user heard in preview could differ from what "Add to score"
 *     actually committed (no vibrato wrap, no tempo quantisation,
 *     different duration rounding).
 *
 * By routing both paths through this one pure function, preview ===
 * apply — the code that lands in the editor is exactly what the user
 * just auditioned.
 *
 * Purity: no Web APIs, no Solid signals, no `@strudel/*` imports —
 * only `notesToSnippet` + `transientsToSnippet` from the same layer.
 */

import {
  notesToSnippet,
  type AudioNote,
  type MicSnippetOptions as NoteSnippetOptions,
} from './micCapture';
import { transientsToSnippet, type Transient } from './transient';

export type MicSnippetFromBuffersOptions = {
  /** Strudel sample instrument for the notes layer (default "piano"). */
  readonly instrument?: string;
  /** Pass-through for `notesToSnippet` (tempo quantisation, slowFactor). */
  readonly notesOptions?: NoteSnippetOptions;
};

export const micSnippetFromBuffers = (
  notes: ReadonlyArray<AudioNote>,
  transients: ReadonlyArray<Transient>,
  opts: MicSnippetFromBuffersOptions = {},
): string | null => {
  const notesSnippet = notes.length === 0
    ? null
    : notesToSnippet(notes, {
        ...opts.notesOptions,
        // exactOptionalPropertyTypes: only pass `instrument` when set.
        ...(opts.instrument !== undefined ? { instrument: opts.instrument } : {}),
      });
  const transSnippet = transients.length === 0
    ? null
    : transientsToSnippet(transients);

  if (notesSnippet === null && transSnippet === null) return null;
  if (notesSnippet !== null && transSnippet !== null) {
    return `stack(\n  ${notesSnippet},\n  ${transSnippet}\n)`;
  }
  return notesSnippet ?? transSnippet;
};
