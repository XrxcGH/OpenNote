// A Pratt parser for the shared grammar. Binding goes from loosest to tightest in this order:
//   comparisons (= <> < > <= >=), & (join text), + and -, * / mod and side-by-side multiplication,
//   a leading sign or square root, ^ (right to left), and the postfix signs ! % and the degree sign.
// So -2^2 is -4, 2^-1 is 0.5, 2^3^2 is 2^9, and 1/2x is (1/2)x. Nothing here runs text as code.

import {
  children,
  MAX_TREE_DEPTH,
  type BinaryNode,
  type CallNode,
  type Node,
  type PostfixOp,
  type UnaryOp,
} from './ast';
import type { Dialect, FunctionInfo } from './dialect';
import { ExprError } from './errors';
import { canonicalNumberText, tokenize, type Token } from './lexer';
import { readCell, readColumn } from './refs';
import { isConvertToken, readUnitExpr, type Cursor } from './unitsyntax';
import { rejectUnknown, splitWords } from './words';

/** Left and right binding power of each infix operator. A smaller right power makes the operator right-associative. */
const INFIX: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['=', [10, 11]],
  ['<>', [10, 11]],
  ['<', [10, 11]],
  ['>', [10, 11]],
  ['<=', [10, 11]],
  ['>=', [10, 11]],
  ['&', [20, 21]],
  ['+', [30, 31]],
  ['-', [30, 31]],
  ['*', [40, 41]],
  ['/', [40, 41]],
  ['mod', [40, 41]],
  ['^', [60, 59]],
]);
const CONVERT = 5;
const PRODUCT = 40;
const PREFIX = 50;

class Parser implements Cursor {
  private at = 0;
  /** How many expressions are open inside each other, which bounds the parser's own recursion. */
  private depth = 0;
  /** How deep each inner node's tree is. Leaves are not listed, and are 1 deep. */
  private readonly heights = new WeakMap<Node, number>();

  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
    private readonly dialect: Dialect,
  ) {}

  /** Parses everything, and fails if anything is left over. */
  parseAll(): Node {
    if (this.peek().kind === 'eof') throw new ExprError('empty', 0, undefined, { length: 0 });
    const node = this.expr(0);
    const left = this.peek();
    if (left.kind !== 'eof') throw this.unexpected(left);
    return node;
  }

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.at + offset, this.tokens.length - 1)];
  }

  next(): Token {
    const token = this.tokens[this.at];
    if (token.kind !== 'eof') this.at += 1;
    return token;
  }

  private slice(token: Token): string {
    return this.source.slice(token.start, token.end);
  }

  private unexpected(token: Token, expected?: string): ExprError {
    const extra = expected === undefined ? {} : { expected };
    if (token.kind === 'eof') return new ExprError('unexpected-end', token.start, undefined, { length: 0, ...extra });
    return new ExprError('unexpected-token', token.start, this.slice(token), {
      length: token.end - token.start,
      ...extra,
    });
  }

  private isOp(text: string): boolean {
    const token = this.peek();
    return token.kind === 'op' && token.text === text;
  }

  // The core loop.

  private expr(minPower: number): Node {
    this.depth += 1;
    if (this.depth > this.dialect.maxDepth) {
      const token = this.peek();
      throw new ExprError('too-deep', token.start, undefined, { length: Math.max(1, token.end - token.start) });
    }
    let left = this.prefix();
    for (;;) {
      const next = this.infix(left, minPower);
      if (next === null) break;
      left = next;
    }
    this.depth -= 1;
    return left;
  }

  /**
   * Records how deep a new inner node's tree is. Each link of a chain such as 1+2+3 or 5!!! makes the tree one
   * deeper without nesting the parser, so this, and not `depth`, keeps a tree shallow enough for every walker.
   */
  private made<T extends Node>(node: T): T {
    let height = 0;
    for (const child of children(node)) height = Math.max(height, this.heights.get(child) ?? 1);
    if (height >= MAX_TREE_DEPTH) throw new ExprError('too-deep', node.pos);
    this.heights.set(node, height + 1);
    return node;
  }

  /** Reads what can start an operand: a number, a name, a group, or a sign followed by an operand. */
  private prefix(): Node {
    const token = this.peek();
    switch (token.kind) {
      case 'num':
        return this.withUnit(this.number(this.next()));
      case 'str':
        this.next();
        return { type: 'str', value: token.text, start: token.start, end: token.end, pos: token.start };
      case 'col':
      case 'id':
        this.next();
        return {
          type: 'col',
          by: token.kind === 'id' ? 'id' : 'name',
          key: token.text,
          start: token.start,
          end: token.end,
          pos: token.start,
        };
      case 'lparen':
        return this.group(this.next());
      case 'name':
        return this.name(this.next());
      case 'op':
        if (this.dialect.prefix.has(token.text)) return this.sign(this.next());
        throw this.unexpected(token, 'operand');
      default:
        throw this.unexpected(token, 'operand');
    }
  }

  private number(token: Token): Node {
    const text = canonicalNumberText(token.text, this.dialect.lex.decimal, this.dialect.lex.thousands);
    return { type: 'num', value: token.value, text, start: token.start, end: token.end, pos: token.start };
  }

  /** A number followed by a unit is a quantity: 5 km. Dialects without units leave the number alone. */
  private withUnit(node: Node): Node {
    const units = this.dialect.units;
    if (units === undefined || node.type !== 'num') return node;
    const unit = readUnitExpr(this, units);
    if (unit === null) return node;
    return this.made({ type: 'quantity', value: node, unit, start: node.start, end: unit.end, pos: node.start });
  }

  /** "value in unit": the same value written in another unit. */
  private convert(left: Node, word: Token): Node {
    const units = this.dialect.units;
    const unit = units === undefined ? null : readUnitExpr(this, units);
    if (unit === null) {
      const found = this.peek();
      if (found.kind === 'eof') throw this.unexpected(found);
      throw new ExprError('unknown-unit', found.start, this.slice(found), { length: found.end - found.start });
    }
    return this.made({ type: 'convert', value: left, unit, start: left.start, end: unit.end, pos: word.start });
  }

  private sign(token: Token): Node {
    const arg = this.expr(PREFIX);
    const op = token.text as UnaryOp;
    return this.made({ type: 'unary', op, arg, start: token.start, end: arg.end, pos: token.start });
  }

  private group(open: Token): Node {
    const inner = this.expr(0);
    const close = this.close(open);
    return this.made({ ...inner, start: open.start, end: close.end });
  }

  private close(open: Token): Token {
    const token = this.peek();
    if (token.kind === 'rparen') return this.next();
    if (token.kind === 'eof') {
      throw new ExprError('unclosed-paren', token.start, undefined, { length: 0, related: open.start, expected: ')' });
    }
    throw this.unexpected(token, ')');
  }

  /** Continues an expression after `left`, or returns null when the next token does not continue it. */
  private infix(left: Node, minPower: number): Node | null {
    const token = this.peek();
    const { dialect } = this;
    if (token.kind === 'op' && dialect.postfix.has(token.text)) {
      this.next();
      const op = token.text as PostfixOp;
      return this.made({ type: 'postfix', op, arg: left, start: left.start, end: token.end, pos: token.start });
    }
    const key = this.infixKey(token);
    const power = key === '' || !dialect.infix.has(key) ? undefined : INFIX.get(key);
    if (power !== undefined) {
      if (power[0] < minPower) return null;
      this.next();
      const right = this.expr(power[1]);
      return this.binary(key as BinaryNode['op'], left, right, token.start);
    }
    if (dialect.units !== undefined && isConvertToken(token)) {
      if (CONVERT < minPower) return null;
      this.next();
      return this.convert(left, token);
    }
    if (dialect.implicit !== 'none' && PRODUCT >= minPower && this.startsOperand(token)) {
      if (dialect.implicit === 'strict' && left.type === 'num' && token.kind === 'num') throw this.unexpected(token);
      const right = this.expr(PRODUCT + 1);
      return this.binary('*', left, right, token.start, true);
    }
    return null;
  }

  /** The operator a token stands for in the middle of an expression, or '' when it is not one. */
  private infixKey(token: Token): string {
    if (token.kind === 'op') return token.text;
    const isMod = token.kind === 'name' && token.text.length === 3 && token.text.toLowerCase() === 'mod';
    return isMod ? 'mod' : '';
  }

  private binary(op: BinaryNode['op'], left: Node, right: Node, pos: number, implicit = false): BinaryNode {
    const node: BinaryNode = { type: 'binary', op, left, right, start: left.start, end: right.end, pos };
    return this.made(implicit ? { ...node, implicit } : node);
  }

  private startsOperand(token: Token): boolean {
    return token.kind === 'num' || token.kind === 'name' || token.kind === 'lparen';
  }

  // Names, calls, and references.

  private name(token: Token): Node {
    const { dialect } = this;
    const info = dialect.functions?.(token.text);
    if (this.peek().kind === 'lparen' && (info !== undefined || dialect.unknownCalls === 'call')) {
      return this.call(token, info);
    }
    if (info !== undefined) {
      if (dialect.calls === 'paren') {
        throw new ExprError('needs-parens', token.start, info.name, { length: token.end - token.start });
      }
      return this.bareCall(token, info);
    }
    return this.plainName(token);
  }

  private plainName(token: Token): Node {
    const { dialect } = this;
    const span = { start: token.start, end: token.end, pos: token.start };
    if (dialect.cells && this.peek().kind === 'colon') return this.reference(token);
    const keyword = dialect.keywords?.[token.text.toUpperCase()];
    if (keyword !== undefined) {
      if (typeof keyword === 'boolean') return { type: 'bool', value: keyword, ...span };
      return { type: 'num', value: keyword, text: String(keyword), ...span };
    }
    if (dialect.cells) return this.reference(token);
    return { type: 'name', name: token.text, ...span };
  }

  /** A1, A1:B5, or B:B, after a name that is not a call or a keyword. */
  private reference(token: Token): Node {
    const cell = readCell(token.text);
    if (this.peek().kind === 'colon') return this.range(token, cell);
    if (cell === null || cell.row < 0) {
      if (this.dialect.strictNames) {
        throw new ExprError('bad-reference', token.start, token.text, { length: token.end - token.start });
      }
      return { type: 'name', name: token.text, start: token.start, end: token.end, pos: token.start };
    }
    return { type: 'cell', col: cell.col, row: cell.row, start: token.start, end: token.end, pos: token.start };
  }

  private range(first: Token, cell: { col: number; row: number } | null): Node {
    this.next();
    const other = this.next();
    const column = readColumn(first.text);
    if (column >= 0 && other.kind === 'name' && readColumn(other.text) >= 0) {
      const second = readColumn(other.text);
      return {
        type: 'range',
        col1: Math.min(column, second),
        row1: 0,
        col2: Math.max(column, second),
        row2: Infinity,
        start: first.start,
        end: other.end,
        pos: first.start,
      };
    }
    const end = other.kind === 'name' ? readCell(other.text) : null;
    if (!cell || !end) throw this.unexpected(other);
    if (cell.row < 0 || end.row < 0) {
      throw new ExprError('bad-row', this.peek().start, undefined, { length: 1 });
    }
    return {
      type: 'range',
      col1: Math.min(cell.col, end.col),
      row1: Math.min(cell.row, end.row),
      col2: Math.max(cell.col, end.col),
      row2: Math.max(cell.row, end.row),
      start: first.start,
      end: other.end,
      pos: first.start,
    };
  }

  /** name(arguments), for a known function or, where the dialect allows it, for any name. */
  private call(token: Token, info: FunctionInfo | undefined): Node {
    const open = this.next();
    const args = this.arguments(open);
    const close = this.tokens[this.at - 1];
    const name = info?.name ?? this.dialect.callName?.(token.text) ?? token.text;
    return this.finishCall(token, info, { name, args, end: close.end });
  }

  private arguments(open: Token): Node[] {
    const args: Node[] = [];
    if (this.peek().kind !== 'rparen') {
      args.push(this.expr(0));
      while (this.peek().kind === 'sep') {
        this.next();
        args.push(this.expr(0));
      }
    }
    this.close(open);
    return args;
  }

  private finishCall(
    token: Token,
    info: FunctionInfo | undefined,
    call: { name: string; args: Node[]; end: number },
  ): CallNode {
    const { dialect } = this;
    if (info !== undefined && dialect.checkArity && (call.args.length < info.min || call.args.length > info.max)) {
      throw new ExprError('arity', token.start, info.name, { length: token.end - token.start });
    }
    return this.made({ type: 'call', ...call, start: token.start, pos: token.start });
  }

  /** sin x, sin 2x, sin^2 x, sin^2(x), and sin^-1(x) for the inverse. */
  private bareCall(token: Token, found: FunctionInfo): Node {
    let info = found;
    let power: Node | null = null;
    let caret: Token | null = null;
    if (this.isOp('^')) {
      caret = this.next();
      const negative = this.isOp('-') ? (this.next(), true) : false;
      const exponent = this.peek();
      if (exponent.kind !== 'num') {
        throw this.unexpected(exponent, 'number');
      }
      this.next();
      const inverse = info.inverse === undefined ? undefined : this.dialect.functions?.(info.inverse);
      if (negative && exponent.value === 1 && inverse !== undefined) info = inverse;
      else power = this.signedExponent(this.number(exponent), negative, caret.start);
    }
    const args = this.peek().kind === 'lparen' ? this.arguments(this.next()) : [this.bareArgument(token)];
    const end = args.length > 0 ? this.tokens[this.at - 1].end : token.end;
    const call = this.finishCall(token, info, { name: info.name, args, end });
    if (power === null || caret === null) return call;
    return this.binary('^', call, power, caret.start);
  }

  private signedExponent(number: Node, negative: boolean, start: number): Node {
    if (!negative) return number;
    return this.made({ type: 'unary', op: '-', arg: number, start, end: number.end, pos: start });
  }

  /** An argument with no brackets. sin 2x is sin(2x), and sin x cos x is sin(x) times cos(x). */
  private bareArgument(name: Token): Node {
    const start = this.peek();
    const opens = this.startsOperand(start) || (start.kind === 'op' && this.dialect.prefix.has(start.text));
    if (!opens) {
      throw new ExprError('missing-argument', name.start, name.text, { length: name.end - name.start });
    }
    let arg = this.expr(PREFIX);
    for (;;) {
      const next = this.peek();
      const tight =
        next.kind === 'num' ||
        next.kind === 'lparen' ||
        (next.kind === 'name' && this.dialect.functions?.(next.text) === undefined);
      if (!tight) return arg;
      arg = this.binary('*', arg, this.expr(PREFIX), next.start, true);
    }
  }
}

function prepare(tokens: Token[], dialect: Dialect): Token[] {
  return dialect.split === undefined ? tokens : splitWords(tokens, dialect.split, rejectUnknown);
}

/** Parses an expression. Throws an ExprError with the place of the problem. */
export function parse(source: string, dialect: Dialect): Node {
  return parseTokens(tokenize(source, dialect.lex), source, dialect);
}

/** Parses tokens that came from `tokenize`, for hosts that change the tokens first. */
export function parseTokens(tokens: Token[], source: string, dialect: Dialect): Node {
  return new Parser(prepare(tokens, dialect), source, dialect).parseAll();
}
