// The matrix console's language: a tokenizer and parser for a small MATLAB-like subset. It is separate from the
// calculator's expression grammar because matrix rows are separated by spaces and the quote is also a transpose.
// Nothing here runs text as code: the parser builds a tree that the interpreter walks.
import { KitError } from '../types';

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'colon' }
  | { t: 'end' }
  | { t: 'un'; op: string; e: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'post'; op: string; e: Expr }
  | { t: 'range'; a: Expr; step: Expr | null; b: Expr }
  | { t: 'mat'; rows: Expr[][] }
  | { t: 'call'; f: Expr; args: Expr[] }
  | { t: 'anon'; params: string[]; body: Expr; src: string }
  | { t: 'fh'; name: string };

export interface Target {
  name: string;
  /** Subscripts of an indexed assignment such as A(2, :) = ..., or null for a whole variable. */
  index: Expr[] | null;
}

export type Stmt =
  | { t: 'expr'; e: Expr; print: boolean }
  | { t: 'assign'; targets: Target[]; e: Expr; print: boolean }
  | { t: 'if'; branches: { cond: Expr; body: Stmt[] }[]; otherwise: Stmt[] }
  | { t: 'for'; name: string; e: Expr; body: Stmt[] }
  | { t: 'while'; cond: Expr; body: Stmt[] }
  | { t: 'break' }
  | { t: 'continue' };

type Kind = 'num' | 'str' | 'id' | 'kw' | 'op' | 'sep' | 'eof';

interface Tok {
  k: Kind;
  v: string;
  n?: number;
  start: number;
  end: number;
}

const KEYWORDS = new Set(['for', 'while', 'if', 'elseif', 'else', 'end', 'break', 'continue']);
const OPS = ['.*', './', '.\\', '.^', ".'", '==', '~=', '!=', '<=', '>=', '&&', '||'];
const SINGLE = "+-*/\\^'<>=&|~!:()[]@,;";
const COMMANDS = new Set(['hold', 'grid', 'close', 'clear', 'clc', 'format', 'figure', 'axis', 'clf', 'box']);

const isDigit = (c: string) => c >= '0' && c <= '9';
const isAlpha = (c: string) => /[A-Za-z_]/.test(c);
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r';

function operandEnd(t: Tok | undefined): boolean {
  if (!t) return false;
  if (t.k === 'num' || t.k === 'str' || t.k === 'id') return true;
  return t.k === 'op' && [')', ']', "'", ".'"].includes(t.v);
}

/** Splits source into tokens. Inside square brackets, a space between two values is a column separator. */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const stack: string[] = [];
  let i = 0;
  const push = (k: Kind, v: string, start: number, n?: number) =>
    out.push({ k, v, start, end: i, ...(n === undefined ? {} : { n }) });
  while (i < src.length) {
    const ch = src[i];
    let spaced = false;
    if (isSpace(ch)) {
      while (i < src.length && isSpace(src[i])) i++;
      spaced = true;
      if (i >= src.length) break;
    }
    const c = src[i];
    if (c === '%' || c === '#') {
      if (src.startsWith('%{', i) && /^\s*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))) {
        const close = src.indexOf('%}', i);
        i = close < 0 ? src.length : close + 2;
      } else {
        while (i < src.length && src[i] !== '\n') i++;
      }
      continue;
    }
    if (src.startsWith('...', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      i++;
      continue;
    }
    if (c === '\n') {
      i++;
      if (stack.length === 0) push('sep', '\n', i - 1);
      else if (stack[stack.length - 1] === '[') push('sep', ';', i - 1);
      continue;
    }
    const prev = out[out.length - 1];
    if (spaced && stack[stack.length - 1] === '[' && operandEnd(prev) && startsOperand(src, i)) {
      push('sep', ',', i);
    }
    const start = i;
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const m = /^(\d+)?(\.(?![*/\\^'])\d*)?([eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      push('num', m[0], start, Number(m[0]));
      continue;
    }
    if (isAlpha(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      const inIndex = stack.length > 0;
      if (word === 'end' && inIndex) push('id', 'end', start);
      else push(KEYWORDS.has(word) ? 'kw' : 'id', word, start);
      continue;
    }
    if (c === '"' || (c === "'" && !(operandEnd(prev) && (!spaced || stack.length === 0)))) {
      i++;
      let text = '';
      for (;;) {
        if (i >= src.length || src[i] === '\n') throw new KitError('mcSyntax', 'unterminated text');
        if (src[i] === c) {
          if (src[i + 1] === c) {
            text += c;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        text += src[i++];
      }
      push('str', text, start);
      continue;
    }
    const two = OPS.find((op) => src.startsWith(op, i));
    if (two) {
      i += two.length;
      push('op', two === '!=' ? '~=' : two, start);
      continue;
    }
    if (SINGLE.includes(c)) {
      i++;
      if (c === '(' || c === '[') stack.push(c);
      if ((c === ')' || c === ']') && stack.length) stack.pop();
      if (c === ',' || c === ';') push('sep', c, start);
      else push('op', c === '!' ? '~' : c, start);
      continue;
    }
    throw new KitError('mcSyntax', `unexpected "${c}"`);
  }
  out.push({ k: 'eof', v: '', start: src.length, end: src.length });
  return out;
}

/** Whether the text at i begins a new value, for a space inside brackets. */
function startsOperand(src: string, i: number): boolean {
  const c = src[i];
  if (isAlpha(c) || isDigit(c) || c === '(' || c === '[' || c === '@' || c === '"' || c === "'") return true;
  if (c === '.') return isDigit(src[i + 1] ?? '');
  if (c === '+' || c === '-') return !isSpace(src[i + 1] ?? ' ') && src[i + 1] !== '=';
  if (c === '~' || c === '!') return src[i + 1] !== '=';
  return false;
}

const BINARY: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '&': 4,
  '==': 5,
  '~=': 5,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 7,
  '-': 7,
  '*': 8,
  '/': 8,
  '\\': 8,
  '.*': 8,
  './': 8,
  '.\\': 8,
};

class Parser {
  private p = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly src: string,
  ) {}

  private get tok(): Tok {
    return this.toks[this.p];
  }
  private isOp(v: string, at = 0): boolean {
    const t = this.toks[this.p + at];
    return t !== undefined && t.k === 'op' && t.v === v;
  }
  private isKw(v: string): boolean {
    return this.tok.k === 'kw' && this.tok.v === v;
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new KitError('mcSyntax', `expected "${v}"`);
    this.p++;
  }

  program(): Stmt[] {
    const body = this.block([]);
    if (this.tok.k !== 'eof') throw new KitError('mcSyntax', `unexpected "${this.tok.v}"`);
    return body;
  }

  private block(stops: string[]): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      while (this.tok.k === 'sep') this.p++;
      if (this.tok.k === 'eof') return out;
      if (this.tok.k === 'kw' && stops.includes(this.tok.v)) return out;
      out.push(this.statement());
    }
  }

  /** The end of a statement: a semicolon hides the result. */
  private terminator(): boolean {
    const t = this.tok;
    if (t.k === 'sep') {
      this.p++;
      return t.v !== ';';
    }
    if (t.k === 'eof' || t.k === 'kw') return true;
    throw new KitError('mcSyntax', `unexpected "${t.v}"`);
  }

  private statement(): Stmt {
    const t = this.tok;
    if (t.k === 'kw') return this.keywordStatement(t.v);
    const multi = this.tryMultiAssign();
    if (multi) return multi;
    if (t.k === 'id' && COMMANDS.has(t.v) && this.toks[this.p + 1].k === 'id' && !this.isOp('=', 2)) {
      this.p += 2;
      const e: Expr = { t: 'call', f: { t: 'id', name: t.v }, args: [{ t: 'str', v: this.toks[this.p - 1].v }] };
      return { t: 'expr', e, print: this.terminator() };
    }
    const e = this.expr();
    if (this.isOp('=')) {
      this.p++;
      const target = this.asTarget(e);
      const value = this.expr();
      return { t: 'assign', targets: [target], e: value, print: this.terminator() };
    }
    return { t: 'expr', e, print: this.terminator() };
  }

  private asTarget(e: Expr): Target {
    if (e.t === 'id') return { name: e.name, index: null };
    if (e.t === 'call' && e.f.t === 'id') return { name: e.f.name, index: e.args };
    throw new KitError('mcSyntax', 'the left side of = must be a variable');
  }

  /** [a, b] = f(...) */
  private tryMultiAssign(): Stmt | null {
    if (!this.isOp('[')) return null;
    let depth = 0;
    let q = this.p;
    for (; q < this.toks.length; q++) {
      const t = this.toks[q];
      if (t.k === 'op' && t.v === '[') depth++;
      if (t.k === 'op' && t.v === ']' && --depth === 0) break;
      if (t.k === 'sep' && t.v === '\n') return null;
    }
    const after = this.toks[q + 1];
    if (!after || after.k !== 'op' || after.v !== '=') return null;
    const names: Target[] = [];
    this.p++;
    while (!this.isOp(']')) {
      if (this.tok.k === 'sep') {
        this.p++;
        continue;
      }
      if (this.isOp('~')) {
        this.p++;
        names.push({ name: '~', index: null });
      } else if (this.tok.k === 'id') names.push({ name: this.toks[this.p++].v, index: null });
      else throw new KitError('mcSyntax', 'the outputs must be variable names');
    }
    this.p += 2;
    const e = this.expr();
    return { t: 'assign', targets: names, e, print: this.terminator() };
  }

  private keywordStatement(word: string): Stmt {
    this.p++;
    if (word === 'break' || word === 'continue') {
      this.terminator();
      return { t: word };
    }
    if (word === 'if') return this.ifStatement();
    if (word === 'for') return this.forStatement();
    if (word === 'while') {
      const cond = this.expr();
      const body = this.block(['end']);
      this.closeBlock();
      return { t: 'while', cond, body };
    }
    throw new KitError('mcSyntax', `unexpected "${word}"`);
  }

  private closeBlock(): void {
    if (!this.isKw('end')) throw new KitError('mcSyntax', 'a block is missing its end');
    this.p++;
  }

  private ifStatement(): Stmt {
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    let otherwise: Stmt[] = [];
    branches.push({ cond: this.expr(), body: this.block(['elseif', 'else', 'end']) });
    for (;;) {
      if (this.isKw('elseif')) {
        this.p++;
        branches.push({ cond: this.expr(), body: this.block(['elseif', 'else', 'end']) });
      } else if (this.isKw('else')) {
        this.p++;
        otherwise = this.block(['end']);
      } else break;
    }
    this.closeBlock();
    return { t: 'if', branches, otherwise };
  }

  private forStatement(): Stmt {
    const paren = this.isOp('(');
    if (paren) this.p++;
    if (this.tok.k !== 'id') throw new KitError('mcSyntax', 'for needs a variable name');
    const name = this.toks[this.p++].v;
    this.expectOp('=');
    const e = this.expr();
    if (paren && this.isOp(')')) this.p++;
    const body = this.block(['end']);
    this.closeBlock();
    return { t: 'for', name, e, body };
  }

  expr(minPrec = 1): Expr {
    let left = this.range(minPrec);
    for (;;) {
      const t = this.tok;
      const prec = t.k === 'op' ? BINARY[t.v] : undefined;
      if (prec === undefined || prec > 5 || prec < minPrec) return left;
      this.p++;
      left = { t: 'bin', op: t.v, l: left, r: this.expr(prec + 1) };
    }
  }

  /** A range a:b or a:step:b, which binds looser than + and - but tighter than comparisons. */
  private range(minPrec: number): Expr {
    if (minPrec > 6) return this.additive();
    const a = this.additive();
    if (!this.isOp(':') || this.isIndexColonEnd()) return a;
    this.p++;
    const b = this.additive();
    if (this.isOp(':') && !this.isIndexColonEnd()) {
      this.p++;
      return { t: 'range', a, step: b, b: this.additive() };
    }
    return { t: 'range', a, step: null, b };
  }

  private isIndexColonEnd(): boolean {
    const n = this.toks[this.p + 1];
    return n.k === 'sep' || (n.k === 'op' && (n.v === ')' || n.v === ']'));
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.tok.k === 'op' && (this.tok.v === '+' || this.tok.v === '-')) {
      const op = this.toks[this.p++].v;
      left = { t: 'bin', op, l: left, r: this.multiplicative() };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.tok.k === 'op' && BINARY[this.tok.v] === 8) {
      const op = this.toks[this.p++].v;
      left = { t: 'bin', op, l: left, r: this.unary() };
    }
    return left;
  }

  private unary(): Expr {
    if (this.tok.k === 'op' && ['-', '+', '~'].includes(this.tok.v)) {
      const op = this.toks[this.p++].v;
      return { t: 'un', op, e: this.unary() };
    }
    return this.power();
  }

  private power(): Expr {
    let base = this.postfix();
    while (this.tok.k === 'op' && (this.tok.v === '^' || this.tok.v === '.^')) {
      const op = this.toks[this.p++].v;
      base = { t: 'bin', op, l: base, r: this.powerOperand() };
    }
    return base;
  }

  private powerOperand(): Expr {
    if (this.tok.k === 'op' && ['-', '+', '~'].includes(this.tok.v)) {
      const op = this.toks[this.p++].v;
      return { t: 'un', op, e: this.powerOperand() };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(')) {
        this.p++;
        e = { t: 'call', f: e, args: this.args() };
      } else if (this.isOp("'") || this.isOp(".'")) {
        e = { t: 'post', op: this.toks[this.p++].v, e };
      } else return e;
    }
  }

  private args(): Expr[] {
    const out: Expr[] = [];
    while (!this.isOp(')')) {
      if (this.tok.k === 'sep' && this.tok.v === ',') {
        this.p++;
        continue;
      }
      if (this.tok.k === 'eof') throw new KitError('mcSyntax', 'a parenthesis is not closed');
      if (this.isOp(':') && this.isIndexColonEnd()) {
        this.p++;
        out.push({ t: 'colon' });
      } else out.push(this.expr());
    }
    this.p++;
    return out;
  }

  private primary(): Expr {
    const t = this.tok;
    if (t.k === 'num') {
      this.p++;
      return { t: 'num', v: t.n! };
    }
    if (t.k === 'str') {
      this.p++;
      return { t: 'str', v: t.v };
    }
    if (t.k === 'id') {
      this.p++;
      return t.v === 'end' ? { t: 'end' } : { t: 'id', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      this.p++;
      const e = this.expr();
      this.expectOp(')');
      return e;
    }
    if (t.k === 'op' && t.v === '[') return this.matrix();
    if (t.k === 'op' && t.v === '@') return this.handle();
    throw new KitError('mcSyntax', t.k === 'eof' ? 'the line ends too soon' : `unexpected "${t.v}"`);
  }

  private matrix(): Expr {
    this.p++;
    const rows: Expr[][] = [[]];
    while (!this.isOp(']')) {
      const t = this.tok;
      if (t.k === 'eof') throw new KitError('mcSyntax', 'a bracket is not closed');
      if (t.k === 'sep' && t.v === ',') this.p++;
      else if (t.k === 'sep') {
        this.p++;
        if (rows[rows.length - 1].length) rows.push([]);
      } else rows[rows.length - 1].push(this.expr());
    }
    this.p++;
    if (rows[rows.length - 1].length === 0) rows.pop();
    return { t: 'mat', rows };
  }

  private handle(): Expr {
    const at = this.tok.start;
    this.p++;
    if (this.tok.k === 'id') return { t: 'fh', name: this.toks[this.p++].v };
    this.expectOp('(');
    const params: string[] = [];
    while (!this.isOp(')')) {
      const kind = this.toks[this.p].k;
      if (kind === 'sep') this.p++;
      else if (kind === 'id') params.push(this.toks[this.p++].v);
      else throw new KitError('mcSyntax', 'the parameters must be names');
    }
    this.p++;
    const body = this.expr();
    return { t: 'anon', params, body, src: this.src.slice(at, this.toks[this.p - 1].end).trim() };
  }
}

/** Reads a script into statements. */
export function parse(src: string): Stmt[] {
  return new Parser(tokenize(src), src).program();
}
