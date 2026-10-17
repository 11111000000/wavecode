/**
 * Strudel-score AST types.
 *
 * Source positions are 0-indexed byte offsets into the original
 * score text (NOT into a normalized form). `line` and `col` are
 * 1-indexed for human consumption (line numbers in error
 * messages, IDE jump-to).
 *
 * The AST is intentionally shallow — it captures enough structure
 * for the rest of wavecode to find a top-level `stack(...)` call,
 * split its top-level arguments, count `s(…)` rows, and locate
 * the original byte ranges for in-place edits. It is NOT a full
 * JavaScript AST; mini-notation inside string literals is opaque.
 *
 * Design constraint: every `node` and `arg` carries a `Span`,
 * so future rewriters (AI-edit, generator) can splice text by
 * byte offset without re-tokenising.
 */

export type Span = {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly col: number;
};

/** A node inside a score: a top-level statement of the program. */
export type ScoreNode =
  | StackNode
  | CallNode
  | CommentNode
  | OtherNode;

export type StackNode = {
  readonly kind: 'stack';
  /**
   * Top-level arguments of the `stack(...)` call. Each entry is
   * an `Arg` (not a `ScoreNode`) because the parser does not
   * recursively parse the inner JS / Strudel structure of an
   * arg — that is the job of `@strudel/transpiler`. The walker
   * only needs the arg's leading name (for `s(…)` counting) and
   * its raw text + span (for round-trip preservation / splicing).
   */
  readonly args: ReadonlyArray<Arg>;
  readonly span: Span;
};

export type CallNode = {
  readonly kind: 'call';
  readonly name: string;
  readonly args: ReadonlyArray<Arg>;
  readonly span: Span;
};

/**
 * An argument to a `CallNode` or a top-level node inside a `StackNode`.
 * Strings and numbers are kept as their original lexeme; identifiers
 * and arbitrary expressions (`foo.bar()`, `x + y`) are recorded as
 * `expr` with their raw text — we do not parse their internals.
 */
export type Arg =
  | { readonly kind: 'string'; readonly value: string; readonly quote: '"' | "'" | '`'; readonly span: Span }
  | { readonly kind: 'number'; readonly value: string; readonly span: Span }
  | { readonly kind: 'ref'; readonly name: string; readonly span: Span }
  | { readonly kind: 'expr'; readonly text: string; readonly span: Span };

export type CommentNode = {
  readonly kind: 'comment';
  readonly style: 'line' | 'block';
  readonly text: string;
  readonly span: Span;
};

/**
 * Anything outside a known call/stack form: a bare statement the
 * parser could not classify (e.g. `42`, `x = 5`, `// already captured`).
 * Kept verbatim with its span so walkers can re-emit it untouched.
 */
export type OtherNode = {
  readonly kind: 'other';
  readonly text: string;
  readonly span: Span;
};

/** Top-level result of `parseScore(text)`. */
export type ScoreAST = {
  readonly nodes: ReadonlyArray<ScoreNode>;
  /** Total length in bytes (== text.length for valid UTF-16 inputs). */
  readonly length: number;
};