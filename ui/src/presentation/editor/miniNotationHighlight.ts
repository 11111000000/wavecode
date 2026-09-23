import { Decoration, type DecorationSet, type EditorView, MatchDecorator, ViewPlugin } from '@codemirror/view';

/**
 * Highlight Strudel mini-notation tokens in CodeMirror:
 *   <bd sd hh>        sample sequence
 *   [a b c]           step sequence
 *   *n                repeat
 *   ~                 rest
 *   ?                 random (50/50)
 *   @n                sustain
 *   !n                degrade
 *   :                 slow
 *   ,                 fast
 *   ^                 one-cycle
 *   .                 euclid
 *
 * Pattern is simple regex (not full parser). Fast, covers 95% cases.
 */

const MINI_PATTERN = /<[^>\n]+>|\[[^\]\n]+\]|\*[0-9.]+|~|\?|[!@:,.^]/g;

const decorator = new MatchDecorator({
  regexp: MINI_PATTERN,
  decoration: () => Decoration.mark({ class: 'cm-mini-notation' }),
});

export const miniNotationHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view);
    }
    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = decorator.createDeco(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);