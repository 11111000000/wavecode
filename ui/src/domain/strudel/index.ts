/**
 * Public API of `ui/src/domain/strudel/`.
 *
 * Consumers should import from `~/domain/strudel` (or via the
 * `~/` alias), NOT from the internal files (`./tokenizer`,
 * `./parser`, `./walker`). The index re-exports the surface
 * documented in `decisions/wavecode-strudel-ast.yaml`:
 *
 *   - `parseScore(text)`            → `ScoreAST`
 *   - `findTopStack(ast)`           → `StackNode | null`
 *   - `countSLayers(stack)`         → `number`
 *   - `getStackArgs(stack)`         → readonly { source, span }[]
 *   - `validateForEdit(text)`       → { ok, layerCount, reason }
 *   - `validateForMixer(text)`      → readonly MixerLayer[]
 *
 * Plus the AST type names (`ScoreNode`, `StackNode`, `CallNode`,
 * `CommentNode`, `OtherNode`, `Arg`, `Span`, `MixerLayer`,
 * `ValidateForEditResult`) and the type guards.
 */

// Types — re-exported so consumers get them from one place.
export type {
  ScoreAST,
  ScoreNode,
  StackNode,
  CallNode,
  CommentNode,
  OtherNode,
  Arg,
  Span,
} from './ast';

export type { MixerLayer, ValidateForEditResult } from './walker';

export type { AppendToStackResult } from './splice';

// Parser / walker — the public behaviour.
export { parseScore, argText, argLeadingName } from './parser';
export {
  findTopStack,
  findTopStackOf,
  countSLayers,
  getStackArgs,
  validateForEdit,
  validateForMixer,
  topLevelNodes,
  astLength,
  isStackNode,
  isCallNode,
  isStringArg,
  isNumberArg,
} from './walker';

export { appendToTopStack } from './splice';

// Tokenizer is exposed for advanced consumers (e.g. a future
// IDE highlighter that wants the raw token stream). Most
// callers should not need it.
export { tokenize, stripTrivia } from './tokenizer';
export type { Token, TokenKind } from './tokenizer';