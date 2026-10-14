/**
 * CodeMirror 6 decoration for the Lisp mode of the score editor.
 *
 * Highlights:
 *   - `(` / `)` — slightly tinted so they stand out in long chains
 *   - `;` line comments — italic muted
 *   - `#| ... |#` block comments — italic muted
 *   - `"..."` strings — distinct from JS-template-literal style
 *
 * Implementation note: we expose a `lispHighlight` facet that the host
 * editor passes the current `LanguageMode` into. When mode is `'js'`,
 * the decoration is empty — JS highlighting falls back to whatever the
 * host editor provides.
 *
 * See `math/wavecode-lisp-transpiler` packet.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { matchBrackets } from '@codemirror/language';

const parenMark = Decoration.mark({ class: 'cm-wavecode-lisp-paren' });
const commentMark = Decoration.mark({ class: 'cm-wavecode-lisp-comment' });
const stringMark = Decoration.mark({ class: 'cm-wavecode-lisp-string' });

const isParen = (c: string | undefined): boolean => c === '(' || c === ')';
const isStringQuote = (c: string | undefined): boolean => c === '"';
const isLineCommentStart = (
  c: string | undefined,
  next: string | undefined,
): boolean => c === ';' && next !== undefined;
const isBlockCommentStart = (
  c: string | undefined,
  next: string | undefined,
): boolean => c === '#' && next === '|';
const isBlockCommentEnd = (
  c: string | undefined,
  next: string | undefined,
): boolean => c === '|' && next === '#';

const buildDecorations = (view: EditorView, enabled: boolean): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  if (!enabled) return builder.finish();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let i = 0;
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let blockDepth = 0;
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (inLineComment) {
        if (c === '\n') inLineComment = false;
        i += 1;
        continue;
      }
      if (inBlockComment) {
        if (isBlockCommentStart(c, next)) {
          blockDepth += 1;
          i += 2;
          continue;
        }
        if (isBlockCommentEnd(c, next)) {
          blockDepth -= 1;
          if (blockDepth === 0) inBlockComment = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (inString) {
        if (c === '\\' && next !== undefined) {
          i += 2;
          continue;
        }
        if (isStringQuote(c)) {
          builder.add(from + i, from + i + 1, stringMark);
          inString = false;
        }
        i += 1;
        continue;
      }
      if (isLineCommentStart(c, next)) {
        builder.add(from + i, to, commentMark);
        inLineComment = true;
        i += 1;
        continue;
      }
      if (isBlockCommentStart(c, next)) {
        builder.add(from + i, to, commentMark);
        inBlockComment = true;
        blockDepth = 1;
        i += 2;
        continue;
      }
      if (isParen(c)) {
        builder.add(from + i, from + i + 1, parenMark);
      } else if (isStringQuote(c)) {
        builder.add(from + i, from + i + 1, stringMark);
        inString = true;
      }
      i += 1;
    }
  }
  return builder.finish();
};

/**
 * Plugin. The host should call `setLispEnabled(enabled)` to toggle
 * without destroying the EditorView.
 */
export const lispHighlight = (initialEnabled: () => boolean) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, initialEnabled());
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view, initialEnabled());
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

/**
 * CSS for the lisp decorations. Inject once at app boot.
 */
export const lispHighlightStyles = EditorView.theme({
  '& .cm-wavecode-lisp-paren': { color: 'var(--wavecode-lisp-paren, #c084fc)', fontWeight: '600' },
  '& .cm-wavecode-lisp-comment': { color: 'var(--wavecode-lisp-comment, #6b7280)', fontStyle: 'italic' },
  '& .cm-wavecode-lisp-string': { color: 'var(--wavecode-lisp-string, #fbbf24)' },
});

// Re-export so the editor can compose bracket matching in Lisp mode.
export { matchBrackets as lispMatchBrackets };