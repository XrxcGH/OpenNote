// A Pratt parser for the shared grammar. Binding goes from loosest to tightest in this order:
//   comparisons (= <> < > <= >=), & (join text), + and -, * / mod and side-by-side multiplication,
//   a leading sign or square root, ^ (right to left), and the postfix signs ! % and the degree sign.
// So -2^2 is -4, 2^-1 is 0.5, 2^3^2 is 2^9, and 1/2x is (1/2)x. Nothing here runs text as code.
// A dialect with spreadsheet rules (signBindsTighter, powerAssociativity 'left') reads -2^2 as 4 and 2^3^2 as 64,
// and one with `excelRefs` adds the reference operators, which bind tightest of all.

import {
  children,
  MAX_TREE_DEPTH,
  type BinaryNode,
  type CallNode,
  type CellAbs,
  type Node,
  type PostfixOp,
  type StructItem,
  type StructNode,
  type UnaryOp,
} from './ast';
import type { Dialect, FunctionInfo } from './dialect';
import { ExprError } from './errors';
import { canonicalNumberText, tokenize, type Token } from './lexer';
import { isAbsolute, readCellRef, readColumn, readR1C1, readRow, type CellRef } from './refs';
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
/** A sign's operand under spreadsheet rules: tighter than "^" either way it groups. */
const TIGHT_PREFIX = 62;
/** The space operator between two references. */
const REFERENCE = 80;
/** Where a reference can start, for the space operator. */
const REFERENCE_START = new Set(['name', 'col', 'qname', 'lparen']);
/** Node types that stand for a reference, which the space operator joins. */
const REFERENCES = new Set(['cell', 'range', 'col', 'struct', 'qualified', 'spill', 'refop', 'name']);
const STRUCT_ITEMS: ReadonlyMap<string, StructItem> = new Map(
  (['#All', '#Data', '#Headers', '#Totals', '#This Row'] as const).map((item) => [item.toLowerCase(), item]),
);

/** Keeps the first `digits` significant digits of number text and sets the rest to 0. */
function truncateDigits(text: string, value: number, digits: number): number {
  const match = /^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return value;
  const [, whole, fraction, exponent] = match;
  const all = (whole + fraction).replace(/^0+/, '');
  if (all.length <= digits) return value;
  const lead = whole.replace(/^0+/, '').length;
  const zeros = fraction.length - fraction.replace(/^0+/, '').length;
  const power = (lead > 0 ? lead - 1 : -zeros - 1) + Number(exponent ?? 0);
  return Number(`${all[0]}.${all.slice(1, digits)}e${power}`);
}

/** The $ flags of a reference, or undefined when it has none, so plain references keep their old shape. */
function absOf(ref: CellRef): CellAbs | undefined {
  return ref.colAbs || ref.rowAbs ? { col: ref.colAbs, row: ref.rowAbs } : undefined;
}

/** Removes Excel's escape (an apostrophe before a special character) from a name in a structured reference. */
function unescapeStruct(text: string): string {
  return text.replace(/'(.)/g, '$1').trim();
}

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
    const excel = this.dialect.excelRefs === true;
    switch (token.kind) {
      case 'num':
        if (excel && this.dialect.cells && this.peek(1).kind === 'colon') return this.rows(this.next());
        return this.withUnit(this.number(this.next()));
      case 'str':
        this.next();
        return { type: 'str', value: token.text, start: token.start, end: token.end, pos: token.start };
      case 'qname':
        if (excel) return this.qualified(this.next(), true);
        throw this.unexpected(token, 'operand');
      case 'col':
      case 'id':
        // Excel refuses empty braces, and no column has an empty id.
        if (excel && token.kind === 'id' && token.text.trim() === '') throw this.unexpected(token, 'operand');
        if (excel && token.kind === 'id' && isArrayText(token.text)) return this.array(this.next());
        if (excel && token.kind === 'col' && /^\s*[@#[]/.test(token.text)) return this.struct(undefined, this.next());
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
    const digits = this.dialect.inputDigits;
    const value = digits === undefined ? token.value : truncateDigits(text, token.value, digits);
    return { type: 'num', value, text, start: token.start, end: token.end, pos: token.start };
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
    const arg = this.expr(this.dialect.signBindsTighter === true ? TIGHT_PREFIX : PREFIX);
    const op = token.text as UnaryOp;
    return this.made({ type: 'unary', op, arg, start: token.start, end: arg.end, pos: token.start });
  }

  private group(open: Token): Node {
    let inner = this.expr(0);
    // Inside brackets, the list separator joins references into one: (A1:B2,C3).
    while (this.dialect.excelRefs === true && this.peek().kind === 'sep') {
      this.next();
      const right = this.expr(0);
      inner = this.made({
        type: 'refop',
        op: ',',
        left: inner,
        right,
        start: inner.start,
        end: right.end,
        pos: right.start,
      });
    }
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
    if (dialect.excelRefs === true) {
      const reference = this.referenceInfix(left, token, minPower);
      if (reference !== undefined) return reference;
    }
    const key = this.infixKey(token);
    let power = key === '' || !dialect.infix.has(key) ? undefined : INFIX.get(key);
    if (key === '^' && power !== undefined && dialect.powerAssociativity === 'left') power = [power[0], power[0] + 1];
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

  /**
   * The reference operators after `left`: A1# (a spill reference, with no space before "#"), and the space between
   * two references. Returns undefined when the token is neither, and null when the space binds too loosely here.
   */
  private referenceInfix(left: Node, token: Token, minPower: number): Node | null | undefined {
    // A call's result called in place, as in LAMBDA(x, x+1)(2).
    if (token.kind === 'lparen' && token.start === left.end && left.type === 'call') {
      const args = this.arguments(this.next());
      const end = this.tokens[this.at - 1].end;
      return this.made({ type: 'call', name: left.name, args, callee: left, start: left.start, end, pos: token.start });
    }
    if (token.kind === 'op' && token.text === '#') {
      const target = left.type === 'qualified' ? left.ref : left;
      if (token.start !== left.end || (target.type !== 'cell' && target.type !== 'name')) throw this.unexpected(token);
      this.next();
      return this.made({ type: 'spill', ref: left, start: left.start, end: token.end, pos: token.start });
    }
    const gap = token.start > this.tokens[this.at - 1].end;
    if (!gap || !REFERENCE_START.has(token.kind) || !REFERENCES.has(left.type)) return undefined;
    if (REFERENCE < minPower) return null;
    const right = this.expr(REFERENCE + 1);
    return this.made({ type: 'refop', op: ' ', left, right, start: left.start, end: right.end, pos: token.start });
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
    // An error value such as #REF!, which the lexer reads as one name.
    if (token.text.startsWith('#'))
      return { type: 'name', name: token.text, start: token.start, end: token.end, pos: token.start };
    const info = dialect.functions?.(token.text);
    if (this.peek().kind === 'lparen' && (info !== undefined || dialect.unknownCalls === 'call')) {
      return this.call(token, info);
    }
    if (dialect.excelRefs === true) {
      const next = this.peek();
      const touching = next.start === token.end;
      if (touching && next.kind === 'op' && next.text === '!') return this.qualified(token, false);
      if (dialect.r1c1 !== undefined) {
        const relative = this.r1c1(token);
        if (relative !== null) return relative;
      }
      if (touching && next.kind === 'col') return this.struct(token.text, this.next(), token);
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
    const cell = readCellRef(token.text);
    if (this.peek().kind === 'colon') return this.range(token, cell);
    if (cell === null || cell.row < 0) {
      if (this.dialect.strictNames) {
        throw new ExprError('bad-reference', token.start, token.text, { length: token.end - token.start });
      }
      return { type: 'name', name: token.text, start: token.start, end: token.end, pos: token.start };
    }
    return this.cellNode(cell, token.start, token.end);
  }

  private cellNode(cell: CellRef, start: number, end: number): Node {
    const abs = absOf(cell);
    const node = { type: 'cell' as const, col: cell.col, row: cell.row, start, end, pos: start };
    return abs === undefined ? node : { ...node, abs };
  }

  private range(first: Token, cell: CellRef | null): Node {
    this.next();
    const other = this.next();
    const column = readColumn(first.text);
    if (column >= 0 && other.kind === 'name' && readColumn(other.text) >= 0) {
      const second = readColumn(other.text);
      const flags = [isAbsolute(first.text), isAbsolute(other.text)];
      return {
        type: 'range',
        col1: Math.min(column, second),
        row1: 0,
        col2: Math.max(column, second),
        row2: Infinity,
        start: first.start,
        end: other.end,
        pos: first.start,
        ...spanAbs(column <= second ? flags : flags.reverse(), 'col'),
      };
    }
    if (this.dialect.excelRefs === true && readRow(first.text) >= 0) return this.rowSpan(first, other);
    const end = other.kind === 'name' ? readCellRef(other.text) : null;
    if (!cell || !end) throw this.unexpected(other);
    if (cell.row < 0 || end.row < 0) {
      throw new ExprError('bad-row', this.peek().start, undefined, { length: 1 });
    }
    return rangeNode(cell, end, first.start, other.end);
  }

  /** Whole rows: 3:3, 2:5, $2:$5. `first` is the start row; the colon is already read when `other` is given. */
  private rowSpan(first: Token, other: Token): Node {
    const top = first.kind === 'num' ? Number(first.text) - 1 : readRow(first.text);
    const bottom = other.kind === 'num' ? Number(other.text) - 1 : other.kind === 'name' ? readRow(other.text) : -1;
    const whole = (t: Token): boolean => t.kind !== 'num' || /^\d+$/.test(t.text);
    if (top < 0 || bottom < 0 || !whole(first) || !whole(other)) throw this.unexpected(other);
    const flags = [first.kind === 'name' && isAbsolute(first.text), other.kind === 'name' && isAbsolute(other.text)];
    return {
      type: 'range',
      col1: 0,
      row1: Math.min(top, bottom),
      col2: Infinity,
      row2: Math.max(top, bottom),
      start: first.start,
      end: other.end,
      pos: first.start,
      ...spanAbs(top <= bottom ? flags : flags.reverse(), 'row'),
    };
  }

  /** 3:3 after its first number. */
  private rows(first: Token): Node {
    this.next();
    return this.rowSpan(first, this.next());
  }

  /** Sheet!A1 or 'Q1 budget'!Totals[Amount]. `scope` is the name before "!", whose token is already read. */
  private qualified(scope: Token, quoted: boolean): Node {
    const bang = this.next();
    if (bang.kind !== 'op' || bang.text !== '!') throw this.unexpected(bang, '!');
    const target = this.next();
    let ref: Node;
    if (target.kind === 'num' && this.peek().kind === 'colon') {
      ref = this.rows(target);
    } else if (target.kind === 'name') {
      const next = this.peek();
      const touching = next.kind === 'col' && next.start === target.end;
      ref = touching ? this.struct(target.text, this.next(), target) : this.reference(target);
    } else {
      throw this.unexpected(target, 'reference');
    }
    const span = { start: scope.start, end: ref.end, pos: scope.start };
    return this.made({ type: 'qualified', scope: scope.text, quoted, ref, ...span });
  }

  /**
   * A structured reference from the text inside its brackets: Col, @Col, @[Col], #Totals, [#Headers],[Col],
   * [Col1]:[Col2]. `table` is the name before the bracket, if any.
   */
  private struct(table: string | undefined, bracket: Token, tableToken?: Token): Node {
    const read = readStructured(bracket.text);
    if (read === null) {
      throw new ExprError('bad-reference', bracket.start, bracket.text, { length: bracket.end - bracket.start });
    }
    const start = tableToken?.start ?? bracket.start;
    const node: StructNode = { type: 'struct', ...read, start, end: bracket.end, pos: start };
    return table === undefined ? node : { ...node, table };
  }

  /** An array constant from the text in its braces: items split by "," (by "\" with a decimal comma), rows by ";". */
  private array(token: Token): Node {
    const itemMark = this.dialect.lex.decimal === ',' ? '\\' : ',';
    const rows: Node[][] = [];
    let row: Node[] = [];
    let from = 0;
    const text = token.text;
    const base = token.start + 1;
    let quoted = false;
    for (let i = 0; i <= text.length; i += 1) {
      const ch = text[i];
      if (ch === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted || (ch !== itemMark && ch !== ';' && i < text.length)) continue;
      row.push(this.literal(text.slice(from, i), base + from));
      from = i + 1;
      if (ch === itemMark) continue;
      if (rows.length > 0 && row.length !== rows[0].length) {
        throw new ExprError('unexpected-token', base + Math.min(i, text.length - 1), ';', { length: 1 });
      }
      rows.push(row);
      row = [];
    }
    const span = { start: token.start, end: token.end, pos: token.start };
    return this.made({ type: 'array', rows: rows.length, cols: rows[0].length, items: rows.flat(), ...span });
  }

  /** One item of an array constant: a number with an optional sign, "text", TRUE, or FALSE. */
  private literal(raw: string, at: number): Node {
    const text = raw.trim();
    const offset = at + raw.indexOf(text);
    const fail = (): ExprError => new ExprError('unexpected-token', offset, text, { length: Math.max(1, text.length) });
    if (text === '') throw fail();
    const tokens = tokenize(text, this.dialect.lex).slice(0, -1);
    const span = { start: offset, end: offset + text.length, pos: offset };
    const [first, second] = tokens;
    if (tokens.length === 1 && first.kind === 'str') return { type: 'str', value: first.text, ...span };
    if (tokens.length === 1 && first.kind === 'name' && /^(true|false)$/i.test(first.text)) {
      return { type: 'bool', value: first.text.toUpperCase() === 'TRUE', ...span };
    }
    const signed = tokens.length === 2 && first.kind === 'op' && (first.text === '-' || first.text === '+');
    const digits = tokens.length === 1 ? first : signed ? second : undefined;
    if (digits?.kind !== 'num') throw fail();
    const number = this.number(digits);
    if (number.type !== 'num' || !signed || first.text === '+') return { ...number, ...span };
    return { ...number, value: -number.value, text: `-${number.text}`, ...span };
  }

  /** An R1C1 reference that starts at `token`, such as R2C3, R[-1]C, or RC[2]:RC[4], or null when there is none. */
  private r1c1(token: Token): Node | null {
    const anchor = this.dialect.r1c1;
    if (anchor === undefined || !/^[RC]/i.test(token.text)) return null;
    const first = this.r1c1Cell(token, anchor);
    if (first === null) return null;
    if (this.peek().kind !== 'colon') return this.cellNode(first.ref, token.start, first.end);
    const save = this.at;
    this.next();
    const startToken = this.next();
    const second = startToken.kind === 'name' ? this.r1c1Cell(startToken, anchor) : null;
    if (second === null) {
      this.at = save;
      return this.cellNode(first.ref, token.start, first.end);
    }
    return rangeNode(first.ref, second.ref, token.start, second.end);
  }

  /** Reads the touching tokens of one R1C1 cell from `token` on, and moves past them when they form one. */
  private r1c1Cell(token: Token, anchor: { row: number; col: number }): { ref: CellRef; end: number } | null {
    let text = token.text;
    let end = token.end;
    let used = 0;
    for (;;) {
      const next = this.peek(used);
      if (next.start !== end || (next.kind !== 'col' && next.kind !== 'name')) break;
      text += next.kind === 'col' ? `[${next.text}]` : next.text;
      end = next.end;
      used += 1;
    }
    const ref = readR1C1(text, anchor);
    if (ref === null || ref.row < 0 || ref.col < 0) return null;
    for (let i = 0; i < used; i += 1) this.next();
    return { ref, end };
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

/** A block from two corners, in order, with each corner's "$" where it ends up. */
function rangeNode(a: CellRef, b: CellRef, start: number, end: number): Node {
  const node = {
    type: 'range' as const,
    col1: Math.min(a.col, b.col),
    row1: Math.min(a.row, b.row),
    col2: Math.max(a.col, b.col),
    row2: Math.max(a.row, b.row),
    start,
    end,
    pos: start,
  };
  if (absOf(a) === undefined && absOf(b) === undefined) return node;
  const [colFirst, colSecond] = a.col <= b.col ? [a.colAbs, b.colAbs] : [b.colAbs, a.colAbs];
  const [rowFirst, rowSecond] = a.row <= b.row ? [a.rowAbs, b.rowAbs] : [b.rowAbs, a.rowAbs];
  const abs: [CellAbs, CellAbs] = [
    { col: colFirst, row: rowFirst },
    { col: colSecond, row: rowSecond },
  ];
  return { ...node, abs };
}

/** The $ flags of a whole-column or whole-row range, or nothing when neither end has one. */
function spanAbs(flags: boolean[], part: 'col' | 'row'): { abs?: [CellAbs, CellAbs] } {
  if (!flags[0] && !flags[1]) return {};
  const flag = (on: boolean): CellAbs => (part === 'col' ? { col: on, row: false } : { col: false, row: on });
  return { abs: [flag(flags[0]), flag(flags[1])] };
}

/** Whether the text inside braces is an array constant rather than a column id such as {c1}. */
function isArrayText(text: string): boolean {
  return /^\s*[-+.\d"]/.test(text) || /[,;\\]/.test(text) || /^\s*(true|false)\s*$/i.test(text);
}

/** Splits the text of a structured reference at its top-level commas. An apostrophe escapes the next character. */
function structParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      current += ch + (text[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') depth -= 1;
    if (depth === 0 && ch === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

type StructParts = Pick<StructNode, 'items' | 'thisRow' | 'col1' | 'col2'>;

/** The parts of a structured reference's bracket text, or null when it is not one. */
function readStructured(text: string): StructParts | null {
  let rest = text.trim();
  const thisRow = rest.startsWith('@');
  if (thisRow) rest = rest.slice(1).trim();
  if (!rest.startsWith('[')) {
    // One name or item without inner brackets: Col, @Col, #Totals. An empty pair of brackets means the whole table.
    const item = STRUCT_ITEMS.get(rest.toLowerCase());
    if (item !== undefined) return thisRow ? null : { items: [item], thisRow };
    const name = unescapeStruct(rest);
    if (name === '') return thisRow ? null : { items: ['#All'], thisRow };
    return { items: [], thisRow, col1: name };
  }
  const items: StructItem[] = [];
  let col1: string | undefined;
  let col2: string | undefined;
  for (const part of structParts(rest)) {
    const range = /^\[(.*)\]\s*:\s*\[(.*)\]$/.exec(part);
    const single = /^\[(.*)\]$/.exec(part);
    const item = single ? STRUCT_ITEMS.get(single[1].trim().toLowerCase()) : undefined;
    if (range && col1 === undefined) {
      [col1, col2] = [unescapeStruct(range[1]), unescapeStruct(range[2])];
    } else if (item !== undefined) {
      items.push(item);
    } else if (single && col1 === undefined) {
      col1 = unescapeStruct(single[1]);
    } else {
      return null;
    }
  }
  if (thisRow && items.length > 0) return null;
  return { items, thisRow, ...(col1 === undefined ? {} : { col1 }), ...(col2 === undefined ? {} : { col2 }) };
}
