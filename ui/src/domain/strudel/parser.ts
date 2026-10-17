/**
 * Strudel-score parser.
 *
 * Recursive-descent over the token stream produced by
 * `tokenizer.ts`. Produces a `ScoreAST` whose top-level nodes
 * are `StackNode | CallNode | CommentNode | OtherNode`.
 *
 * Grammar (informal):
 *
 *   program      := topLevel*
 *   topLevel     := stackCall | call | comment | other
 *   stackCall    := "stack" "(" arg ( "," arg )* ")"
 *   call         := IDENT "(" arg ( "," arg )* ")"
 *   arg          := any non-comma token sequence (paren-aware depth)
 *   comment      := LINE_COMMENT | BLOCK_COMMENT
 *   other        := anything else — emitted verbatim with its span
 *
 * An `arg` is a sequence of tokens between top-level commas
 * (paren-aware). We do not parse its internal JS / Strudel
 * structure — that's the job of `@strudel/transpiler`. The
 * walker only needs to know:
 *   - the raw text of the arg (for round-trip preservation),
 *   - the byte span of the arg (for splicing),
 *   - the leading IDENT (so we can classify `s(…)` vs `note(…)`).
 *
 * The parser is permissive: any input that does not match a
 * known production is captured as `OtherNode` so callers always
 * get a valid AST (e.g. the user typed `stack(` and stopped).
 *
 * Spans on every node are byte offsets into the ORIGINAL text.
 */

import type {
  ScoreAST,
  ScoreNode,
  StackNode,
  CallNode,
  CommentNode,
  OtherNode,
  Arg,
  Span,
} from './ast';
import { tokenize, type Token } from './tokenizer';

/**
 * Extract the raw text of `text[span.start..span.end]`. Used to
 * surface the verbatim source for each parsed node — the
 * tokeniser drops whitespace, so we cannot reconstruct lexemes
 * from tokens alone.
 */
const slice = (text: string, span: Span): string => text.slice(span.start, span.end);

class TokenStream {
  private readonly tokens: ReadonlyArray<Token>;
  private idx = 0;
  constructor(rawTokens: ReadonlyArray<Token>) {
    // Drop whitespace only — comments stay so we can emit them
    // as `CommentNode`. The trivia-free stream is what the
    // recursive-descent grammar consumes.
    this.tokens = rawTokens.filter((t) => t.kind !== 'WS');
  }

  peek(): Token | undefined { return this.tokens[this.idx]; }
  peekKind(): Token['kind'] | undefined { return this.tokens[this.idx]?.kind; }
  advance(): Token {
    const t = this.tokens[this.idx] as Token;
    this.idx += 1;
    return t;
  }
  check(kind: Token['kind']): boolean { return this.tokens[this.idx]?.kind === kind; }
  match(kind: Token['kind']): Token | null {
    if (this.check(kind)) return this.advance();
    return null;
  }
  isAtEnd(): boolean { return this.peekKind() === 'EOF'; }
}

/**
 * Parse `text` into a `ScoreAST`. The function never throws on
 * malformed input — anything it cannot classify becomes an
 * `OtherNode`, so callers always get a valid AST.
 */
export const parseScore = (text: string): ScoreAST => {
  const tokens = tokenize(text);
  const stream = new TokenStream(tokens);
  const nodes: ScoreNode[] = [];
  while (!stream.isAtEnd()) {
    const node = parseTopLevel(text, stream);
    if (node !== null) nodes.push(node);
  }
  return { nodes, length: text.length };
};

/**
 * Skip any leading comments and return the first non-comment
 * token (or undefined if at end).
 */
const skipComments = (stream: TokenStream): Token | undefined => {
  while (!stream.isAtEnd()) {
    const t = stream.peek();
    if (t && (t.kind === 'LINE_COMMENT' || t.kind === 'BLOCK_COMMENT')) {
      stream.advance();
      continue;
    }
    return t;
  }
  return undefined;
};

const parseTopLevel = (text: string, stream: TokenStream): ScoreNode | null => {
  let t = stream.peek();

  // Consume any leading comment chain (line + block comments
  // before the next real node). We emit them as a SINGLE
  // CommentNode so the AST is compact — leading trivia on a
  // node is not a separate node type.
  const collectedComments: Token[] = [];
  while (t && (t.kind === 'LINE_COMMENT' || t.kind === 'BLOCK_COMMENT')) {
    collectedComments.push(stream.advance());
    t = stream.peek();
  }
  if (collectedComments.length > 0) {
    const firstTok = collectedComments[0]!;
    const lastTok = collectedComments[collectedComments.length - 1]!;
    const span: Span = {
      start: firstTok.span.start,
      end: lastTok.span.end,
      line: firstTok.span.line,
      col: firstTok.span.col,
    };
    const node: CommentNode = {
      kind: 'comment',
      style: firstTok.kind === 'LINE_COMMENT' ? 'line' : 'block',
      text: slice(text, span),
      span,
    };
    return node;
  }
  if (t === undefined) return null;

  if (t.kind === 'IDENT') {
    const ident = stream.advance();
    if (stream.check('LPAREN')) {
      return parseCall(text, stream, ident.lexeme, ident.span);
    }
    // Bare identifier with no `(` — treat as `OtherNode`
    // spanning the identifier alone.
    return makeOther(text, ident.span);
  }

  // Anything else (operators, brackets, numbers at top level,
  // etc.) — emit as OtherNode spanning the single token.
  // CRITICAL: must advance the stream or the loop hangs.
  const tok = stream.advance();
  return makeOther(text, tok.span);
};

/**
 * Parse `name(args)` once `name` and the opening `(` are known.
 * The span covers from `nameSpan.start` through the closing `)`.
 * If the closing `)` is missing (unbalanced input), the span
 * ends at the last consumed arg's last token.
 */
const parseCall = (
  text: string,
  stream: TokenStream,
  name: string,
  nameSpan: Span,
): ScoreNode => {
  const lparen = stream.advance(); // consume '('
  const args = parseArgList(text, stream);
  const rparen = stream.match('RPAREN');
  // Closing span: prefer the real RPAREN; otherwise the last arg
  // (or the lparen for empty bodies). Fall back to lparen when
  // the arg list is empty AND the call is unbalanced.
  const lastArgEnd = args.length > 0 ? args[args.length - 1]!.span.end : lparen.span.end;
  const endTokenSpan = rparen
    ? rparen.span
    : { start: lastArgEnd, end: lastArgEnd, line: nameSpan.line, col: nameSpan.col };
  const span: Span = {
    start: nameSpan.start,
    end: endTokenSpan.end,
    line: nameSpan.line,
    col: nameSpan.col,
  };

  if (name === 'stack') {
    const node: StackNode = { kind: 'stack', args, span };
    return node;
  }
  const node: CallNode = { kind: 'call', name, args, span };
  return node;
};

/**
 * Parse a comma-separated list of args up to the next `)` (or
 * EOF). Each arg's span starts at the first non-trivia token
 * after the previous `,` (or after `(`) and ends just before
 * the next top-level `,` or `)`.
 *
 * Tolerates trailing commas: empty slots are skipped.
 */
const parseArgList = (text: string, stream: TokenStream): ReadonlyArray<Arg> => {
  const args: Arg[] = [];
  const firstTok = skipComments(stream);
  if (firstTok === undefined || stream.check('RPAREN')) return args;
  let startSpan = firstTok.span;

  while (!stream.isAtEnd()) {
    // Walk forward until we hit a top-level comma or RPAREN,
    // tracking bracket depth. Mini-notation `<>` and `[ ]` count
    // toward depth so commas inside them don't split args.
    let depth = 0;
    let lastSpan = startSpan;
    while (!stream.isAtEnd()) {
      const tk = stream.peek();
      if (tk === undefined) break;
      if (tk.kind === 'LINE_COMMENT' || tk.kind === 'BLOCK_COMMENT') {
        // Comments inside an arg are part of the arg verbatim.
        stream.advance();
        lastSpan = tk.span;
        continue;
      }
      if (depth === 0 && tk.kind === 'COMMA') break;
      if (depth === 0 && tk.kind === 'RPAREN') break;
      // Depth-tracking punctuation.
      if (tk.kind === 'LPAREN' || tk.kind === 'LBRACK' || tk.kind === 'LBRACE' || tk.kind === 'LANGLE') {
        depth += 1;
      } else if (tk.kind === 'RPAREN' || tk.kind === 'RBRACK' || tk.kind === 'RBRACE' || tk.kind === 'RANGLE') {
        depth -= 1;
        if (depth < 0) break;
      }
      stream.advance();
      lastSpan = tk.span;
    }
    const endTok = stream.peek();
    if (endTok && (endTok.kind === 'COMMA' || endTok.kind === 'RPAREN')) {
      const arg = makeArg(text, startSpan, endTok.span);
      if (arg !== null) args.push(arg);
      if (endTok.kind === 'RPAREN') return args;
      stream.advance(); // consume ','
      // After a comma, skip comments before the next arg.
      const next = skipComments(stream);
      if (next === undefined) return args;
      if (stream.check('RPAREN')) return args; // trailing comma
      startSpan = next.span;
      continue;
    }
    // Reached EOF without `)` or `,` — emit final arg if any.
    if (lastSpan.end > startSpan.start) {
      const arg = makeArg(text, startSpan, lastSpan);
      if (arg !== null) args.push(arg);
    }
    return args;
  }
  return args;
};

/**
 * Build an `Arg` from a span. We classify:
 *   - `STRING` / `TEMPLATE` → `Arg.string`
 *   - `NUMBER`              → `Arg.number`
 *   - `IDENT ( ... )`       → `Arg.expr` (the whole call as text)
 *   - bare `IDENT`          → `Arg.ref`
 *   - everything else       → `Arg.expr`
 *
 * The Arg shape carries the raw source from the original input
 * so `parseStack.ts` / `walker.ts` can re-emit the arg verbatim
 * without round-tripping through tokens.
 */
const makeArg = (
  text: string,
  startSpan: Span,
  endSpan: Span,
): Arg | null => {
  if (endSpan.start <= startSpan.start) return null;
  const span: Span = {
    start: startSpan.start,
    end: endSpan.start,
    line: startSpan.line,
    col: startSpan.col,
  };
  if (span.end <= span.start) return null;
  const lexeme = slice(text, span);

  // Strings — match quoted forms (single, double, backtick).
  if (lexeme.length >= 2) {
    const first = lexeme[0];
    const last = lexeme[lexeme.length - 1];
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      const quote = first as '"' | "'" | '`';
      return {
        kind: 'string',
        value: unescape(lexeme.slice(1, -1)),
        quote,
        span,
      };
    }
  }
  // Numbers (allow leading digits).
  if (/^-?\d/.test(lexeme)) {
    return { kind: 'number', value: lexeme.trim(), span };
  }
  // Identifier reference — possibly followed by `(` (nested call).
  const refMatch = /^([A-Za-z_$][\w$]*)/.exec(lexeme);
  if (refMatch) {
    const name = refMatch[1]!;
    if (lexeme[name.length] === '(') {
      // It's a call — capture as opaque expr. The walker treats
      // nested calls as text, which is sufficient for the
      // mixer / StepGrid use-cases (they only inspect the
      // OUTER stack's args).
      return { kind: 'expr', text: lexeme, span };
    }
    return { kind: 'ref', name, span };
  }
  return { kind: 'expr', text: lexeme, span };
};

const unescape = (s: string): string => s.replace(/\\(.)/g, '$1');

const makeOther = (text: string, span: Span): OtherNode => ({
  kind: 'other',
  text: slice(text, span),
  span,
});

/** Re-exported so `parseStack.ts` / `walker.ts` can read an arg's raw text. */
export const argText = (arg: Arg): string => {
  switch (arg.kind) {
    case 'string': return `${arg.quote}${arg.value}${arg.quote}`;
    case 'number': return arg.value;
    case 'ref': return arg.name;
    case 'expr': return arg.text;
  }
};

/**
 * Re-export the leading-name classifier — used by the walker
 * to decide whether an arg starts with `s(…)`, `note(…)`, etc.
 *
 * Returns the identifier at the start of the arg, or `null`
 * if the arg does not start with an identifier.
 */
export const argLeadingName = (arg: Arg): string | null => {
  switch (arg.kind) {
    case 'string': return null;
    case 'number': return null;
    case 'ref': return arg.name;
    case 'expr': {
      const m = /^([A-Za-z_$][\w$]*)/.exec(arg.text);
      return m ? m[1]! : null;
    }
  }
};