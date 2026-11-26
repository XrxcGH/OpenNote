// The formula of a conditional rule: a custom formula rule, and the constants of cell value rules, scale stops, bar
// ends, and icon thresholds. The engine owns the real formula language. Until the page's engine is connected with
// `setFormulaEvaluator` (the sheet integration does it), this small evaluator reads the forms that rules use:
// numbers, text, TRUE, FALSE, A1 references with `$` anchors (relative to the first range's top-left cell),
// ranges, `+ - * / ^ & = <> < > <= >=`, and a short list of functions.

import { letterToColumn } from '../../engine/model';
import { own } from '../model/json';
import type { Sheet, TableLike } from '../model/types';
import { BLANK, textOf, valueOfCell, type CellValue } from './value';

export interface FormulaContext {
  sheet: Sheet;
  table: TableLike;
  /** The cell the rule is asked about. */
  at: { row: number; col: number };
  /** The top-left cell of the rule's first range: the formula's references are written for this cell. */
  anchor: { row: number; col: number };
  /** Today as a spreadsheet serial day, for TODAY(). */
  today?: number;
}

export type FormulaEvaluator = (formula: string, ctx: FormulaContext) => CellValue;

type V = CellValue | { kind: 'array'; items: CellValue[] };
interface Ref {
  t: 'ref';
  c: number;
  cAbs: boolean;
  r: number;
  rAbs: boolean;
  to?: Ref;
}
type Node =
  | { t: 'val'; v: CellValue }
  | Ref
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'fn'; name: string; args: Node[] };

const num = (n: number): CellValue => ({ kind: 'num', n });
const bool = (b: boolean): CellValue => ({ kind: 'bool', b });
const fail = (e: string): CellValue => ({ kind: 'error', e });
const NOTHING: Node = { t: 'val', v: BLANK };

const TOKEN = new RegExp(
  [
    String.raw`\s*(?:(\$?\d+:\$?\d+)(?![\d.])`, // whole rows: 1:1
    String.raw`(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`, // a number
    String.raw`"((?:[^"]|"")*)"`, // text
    String.raw`(\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_(])`, // a cell
    String.raw`(\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})(?![A-Za-z0-9_(.])`, // whole columns: A:A
    String.raw`([A-Za-z_][A-Za-z0-9_.]*)\s*(\()?`, // a name or a function
    String.raw`(<=|>=|<>|[-+*/^&=<>(),:%]))`, // an operator
  ].join('|'),
  'y',
);

function tokenize(text: string): string[][] | null {
  const out: string[][] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(text);
    if (!m) return null;
    if (m[1] !== undefined) out.push(['rr', m[1]]);
    else if (m[2] !== undefined) out.push(['n', m[2]]);
    else if (m[3] !== undefined) out.push(['s', m[3].replace(/""/g, '"')]);
    else if (m[4] !== undefined) out.push(['ref', m[4]]);
    else if (m[5] !== undefined) out.push(['cr', m[5]]);
    else if (m[6] !== undefined) out.push([m[7] ? 'fn' : 'name', m[6]]);
    else out.push(['op', m[8]]);
  }
  return out;
}

function refOf(text: string): Ref {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(text) as RegExpExecArray;
  return {
    t: 'ref',
    cAbs: m[1] === '$',
    c: letterToColumn(m[2].toUpperCase()),
    rAbs: m[3] === '$',
    r: Number(m[4]) - 1,
  };
}

/** The last row and column a sheet has (1,048,576 rows by 16,384 columns); a whole column or row reaches them. */
const LAST_ROW = 1_048_575;
const LAST_COL = 16_383;

/** A whole column (A:B) or whole row (1:3) as a range; the read clamps it to the table. */
function wholeOf(text: string, rows: boolean): Ref {
  const [x, y] = text.split(':');
  const side = (part: string) => {
    const abs = part.startsWith('$');
    const body = abs ? part.slice(1) : part;
    return rows ? { abs, n: Number(body) - 1 } : { abs, n: letterToColumn(body.toUpperCase()) };
  };
  const a = side(x);
  const b = side(y);
  const end: Ref = rows
    ? { t: 'ref', c: LAST_COL, cAbs: true, r: b.n, rAbs: b.abs }
    : { t: 'ref', c: b.n, cAbs: b.abs, r: LAST_ROW, rAbs: true };
  return rows
    ? { t: 'ref', c: 0, cAbs: true, r: a.n, rAbs: a.abs, to: end }
    : { t: 'ref', c: a.n, cAbs: a.abs, r: 0, rAbs: true, to: end };
}

const cache = new Map<string, Node | null>();

function build(tokens: string[][]): Node | null {
  let i = 0;
  const op = (...ops: string[]) => tokens[i]?.[0] === 'op' && ops.includes(tokens[i][1]);
  const bad = (): never => {
    throw new Error('formula');
  };
  const level =
    (next: () => Node, ...ops: string[]) =>
    (): Node => {
      let a = next();
      while (op(...ops)) {
        const o = tokens[i++][1];
        a = { t: 'bin', op: o, a, b: next() };
      }
      return a;
    };
  const primary = (): Node => {
    const tok = tokens[i++];
    if (!tok) return bad();
    if (tok[0] === 'n') return { t: 'val', v: num(Number(tok[1])) };
    if (tok[0] === 's') return { t: 'val', v: { kind: 'text', s: tok[1] } };
    if (tok[0] === 'rr' || tok[0] === 'cr') return wholeOf(tok[1], tok[0] === 'rr');
    if (tok[0] === 'ref') {
      const from = refOf(tok[1]);
      if (!op(':')) return from;
      i++;
      const to = tokens[i++];
      return to?.[0] === 'ref' ? { ...from, to: refOf(to[1]) } : bad();
    }
    if (tok[0] === 'name') {
      const up = tok[1].toUpperCase();
      return up === 'TRUE' || up === 'FALSE' ? { t: 'val', v: bool(up === 'TRUE') } : bad();
    }
    if (tok[0] === 'fn') {
      const args: Node[] = [];
      if (!op(')')) {
        args.push(or());
        while (op(',')) {
          i++;
          args.push(or());
        }
      }
      if (!op(')')) return bad();
      i++;
      return { t: 'fn', name: tok[1].toUpperCase(), args };
    }
    if (tok[1] !== '(') return bad();
    const inner = or();
    if (!op(')')) return bad();
    i++;
    return inner;
  };
  const postfix = (): Node => {
    let a = primary();
    while (op('%')) {
      i++;
      a = { t: 'bin', op: '/', a, b: { t: 'val', v: num(100) } };
    }
    return a;
  };
  const power = level(postfix, '^');
  const unary = (): Node => {
    if (!op('-', '+')) return power();
    const o = tokens[i++][1];
    return { t: 'un', op: o, a: unary() };
  };
  const or = level(level(level(level(unary, '*', '/'), '+', '-'), '&'), '=', '<>', '<', '>', '<=', '>=');
  try {
    const node = or();
    return i < tokens.length ? null : node;
  } catch {
    return null;
  }
}

function parse(text: string): Node | null {
  if (cache.has(text)) return cache.get(text) ?? null;
  const tokens = tokenize(text.replace(/^\s*=/, ''));
  const node = tokens && tokens.length > 0 ? build(tokens) : null;
  if (cache.size > 512) cache.clear();
  cache.set(text, node);
  return node;
}

const asNum = (v: CellValue): number | CellValue => {
  if (v.kind === 'num') return v.n;
  if (v.kind === 'blank') return 0;
  if (v.kind === 'bool') return v.b ? 1 : 0;
  if (v.kind === 'error') return v;
  const n = Number(v.s);
  return v.s.trim() !== '' && Number.isFinite(n) ? n : fail('#VALUE!');
};
const asBool = (v: CellValue): boolean | CellValue => {
  if (v.kind === 'bool') return v.b;
  if (v.kind === 'num') return v.n !== 0;
  if (v.kind === 'blank') return false;
  if (v.kind === 'error') return v;
  return fail('#VALUE!');
};

/** Excel's order of types: numbers before text before booleans. Blank takes the type of what it is compared with. */
export function compareValues(a: CellValue, b: CellValue): number {
  const rank = (v: CellValue) => (v.kind === 'num' ? 0 : v.kind === 'text' ? 1 : 2);
  const like = (other: CellValue): CellValue =>
    other.kind === 'text' ? { kind: 'text', s: '' } : other.kind === 'bool' ? bool(false) : num(0);
  const x = a.kind === 'blank' ? like(b) : a;
  const y = b.kind === 'blank' ? like(a) : b;
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  if (x.kind === 'num' && y.kind === 'num') return x.n - y.n;
  if (x.kind === 'bool' && y.kind === 'bool') return Number(x.b) - Number(y.b);
  const s = textOf(x).toLowerCase();
  const t = textOf(y).toLowerCase();
  return s < t ? -1 : s > t ? 1 : 0;
}

const COMPARE: Record<string, (d: number) => boolean> = {
  '=': (d) => d === 0,
  '<>': (d) => d !== 0,
  '<': (d) => d < 0,
  '>': (d) => d > 0,
  '<=': (d) => d <= 0,
  '>=': (d) => d >= 0,
};

interface Memo {
  rows: unknown;
  values: unknown;
  stamp: unknown;
  ranges: Map<string, CellValue[]>;
  results: Map<string, CellValue>;
}
const memos = new WeakMap<object, Memo>();

/** What was read from a table, kept while its rows and its value cache are the same objects. */
function memoOf(ctx: FormulaContext): Memo {
  const known = memos.get(ctx.table);
  const values = own(ctx.sheet, 'values');
  const stamp = own(ctx.sheet, 'valuesOf');
  if (known && known.rows === ctx.table.rows && known.values === values && known.stamp === stamp) return known;
  const fresh: Memo = { rows: ctx.table.rows, values, stamp, ranges: new Map(), results: new Map() };
  memos.set(ctx.table, fresh);
  return fresh;
}

/** True when the formula reads the same cells for every cell of the rule, so one result serves them all. */
function isAbsolute(node: Node): boolean {
  switch (node.t) {
    case 'val':
      return true;
    case 'ref':
      return node.cAbs && node.rAbs && (!node.to || (node.to.cAbs && node.to.rAbs));
    case 'un':
      return isAbsolute(node.a);
    case 'bin':
      return isAbsolute(node.a) && isAbsolute(node.b);
    case 'fn':
      return node.name !== 'ROW' && node.name !== 'COLUMN' && node.args.every(isAbsolute);
  }
}
const absolute = new WeakMap<Node, boolean>();

function run(node: Node, ctx: FormulaContext, depth: number): V {
  if (depth > 64) return fail('#VALUE!');
  const dr = ctx.at.row - ctx.anchor.row;
  const dc = ctx.at.col - ctx.anchor.col;
  const at = (n: Ref) => ({ r: n.rAbs ? n.r : n.r + dr, c: n.cAbs ? n.c : n.c + dc });
  const scalar = (n: Node): CellValue => {
    const v = run(n, ctx, depth + 1);
    return v.kind === 'array' ? (v.items[0] ?? BLANK) : v;
  };
  switch (node.t) {
    case 'val':
      return node.v;
    case 'ref': {
      const a = at(node);
      if (!node.to) return a.r < 0 || a.c < 0 ? fail('#REF!') : valueOfCell(ctx.sheet, ctx.table, a.r, a.c);
      const b = at(node.to);
      const r0 = Math.max(0, Math.min(a.r, b.r));
      const r1 = Math.min(ctx.table.rows.length - 1, Math.max(a.r, b.r));
      const c0 = Math.max(0, Math.min(a.c, b.c));
      const c1 = Math.min(ctx.table.columns.length - 1, Math.max(a.c, b.c));
      const memo = memoOf(ctx);
      const key = `${r0},${r1},${c0},${c1}`;
      const known = memo.ranges.get(key);
      if (known) return { kind: 'array', items: known };
      const items: CellValue[] = [];
      outer: for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          if (items.length >= 100_000) break outer;
          items.push(valueOfCell(ctx.sheet, ctx.table, r, c));
        }
      memo.ranges.set(key, items);
      return { kind: 'array', items };
    }
    case 'un': {
      const n = asNum(scalar(node.a));
      return typeof n !== 'number' ? n : num(node.op === '-' ? -n : n);
    }
    case 'bin': {
      const a = scalar(node.a);
      const b = scalar(node.b);
      if (a.kind === 'error') return a;
      if (b.kind === 'error') return b;
      if (node.op === '&') return { kind: 'text', s: textOf(a) + textOf(b) };
      if (Object.hasOwn(COMPARE, node.op)) return bool(COMPARE[node.op](compareValues(a, b)));
      const x = asNum(a);
      const y = asNum(b);
      if (typeof x !== 'number') return x;
      if (typeof y !== 'number') return y;
      if (node.op === '/') return y === 0 ? fail('#DIV/0!') : num(x / y);
      const r = node.op === '+' ? x + y : node.op === '-' ? x - y : node.op === '*' ? x * y : x ** y;
      return Number.isFinite(r) ? num(r) : fail('#NUM!');
    }
    case 'fn':
      return call(node.name, node.args, ctx, depth, scalar);
  }
}

function call(name: string, args: Node[], ctx: FormulaContext, depth: number, scalar: (n: Node) => CellValue): V {
  const arg = (k: number) => args[k] ?? NOTHING;
  const items = () =>
    args.flatMap((a) => {
      const v = run(a, ctx, depth + 1);
      return v.kind === 'array' ? v.items : [v];
    });
  const numbers = () => items().flatMap((v) => (v.kind === 'num' ? [v.n] : []));
  const one = (f: (n: number) => CellValue): CellValue => {
    const n = asNum(scalar(arg(0)));
    return typeof n === 'number' ? f(n) : n;
  };
  switch (name) {
    case 'AND':
    case 'OR': {
      const bools = items().flatMap((v) => (v.kind === 'blank' || v.kind === 'text' ? [] : [asBool(v)]));
      const bad = bools.find((b) => typeof b !== 'boolean');
      if (bad) return bad as CellValue;
      return bool(name === 'AND' ? bools.every(Boolean) : bools.some(Boolean));
    }
    case 'NOT': {
      const b = asBool(scalar(arg(0)));
      return typeof b === 'boolean' ? bool(!b) : b;
    }
    case 'IF': {
      const b = asBool(scalar(arg(0)));
      if (typeof b !== 'boolean') return b;
      return b ? scalar(args[1] ?? { t: 'val', v: bool(true) }) : scalar(args[2] ?? { t: 'val', v: bool(false) });
    }
    case 'ISBLANK':
      return bool(scalar(arg(0)).kind === 'blank');
    case 'ISNUMBER':
      return bool(scalar(arg(0)).kind === 'num');
    case 'ISTEXT':
      return bool(scalar(arg(0)).kind === 'text');
    case 'ISERROR':
      return bool(scalar(arg(0)).kind === 'error');
    case 'ISEVEN':
      return one((n) => bool(Math.trunc(n) % 2 === 0));
    case 'ISODD':
      return one((n) => bool(Math.trunc(n) % 2 !== 0));
    case 'ABS':
      return one((n) => num(Math.abs(n)));
    case 'LEN':
      return num(textOf(scalar(arg(0))).length);
    case 'MOD': {
      const x = asNum(scalar(arg(0)));
      const y = asNum(scalar(arg(1)));
      if (typeof x !== 'number') return x;
      if (typeof y !== 'number') return y;
      return y === 0 ? fail('#DIV/0!') : num(x - y * Math.floor(x / y));
    }
    case 'ROW':
      return num(ctx.at.row + 1);
    case 'COLUMN':
      return num(ctx.at.col + 1);
    case 'TODAY':
      return num(ctx.today ?? Math.floor(Date.now() / 86_400_000) + 25569);
    case 'SUM':
      return num(numbers().reduce((a, b) => a + b, 0));
    case 'MIN':
      return num(numbers().reduce((a, b) => Math.min(a, b), numbers()[0] ?? 0));
    case 'MAX':
      return num(numbers().reduce((a, b) => Math.max(a, b), numbers()[0] ?? 0));
    case 'COUNT':
      return num(numbers().length);
    case 'COUNTA':
      return num(items().filter((v) => v.kind !== 'blank').length);
    case 'AVERAGE': {
      const n = numbers();
      return n.length === 0 ? fail('#DIV/0!') : num(n.reduce((a, b) => a + b, 0) / n.length);
    }
    case 'COUNTIF': {
      const range = run(arg(0), ctx, depth + 1);
      const crit = scalar(arg(1));
      const list = range.kind === 'array' ? range.items : [range];
      return num(
        list.filter((v) => (v.kind === 'blank') === (crit.kind === 'blank') && compareValues(v, crit) === 0).length,
      );
    }
    default:
      return fail('#NAME?');
  }
}

/** The built-in evaluator. A formula it cannot read is an error value, so its rule matches nothing. */
export const simpleEvaluator: FormulaEvaluator = (formula, ctx) => {
  const node = parse(formula);
  if (!node) return fail('#NAME?');
  let abs = absolute.get(node);
  if (abs === undefined) absolute.set(node, (abs = isAbsolute(node)));
  const memo = abs ? memoOf(ctx) : undefined;
  const key = `${formula}|${ctx.today ?? ''}`;
  const hit = memo?.results.get(key);
  if (hit) return hit;
  const v = run(node, ctx, 0);
  const out = v.kind === 'array' ? (v.items[0] ?? BLANK) : v;
  memo?.results.set(key, out);
  return out;
};

let evaluator: FormulaEvaluator = simpleEvaluator;

/** Connects the page's engine (or any evaluator) to the rules; with no argument it goes back to the built-in one. */
export function setFormulaEvaluator(next: FormulaEvaluator = simpleEvaluator): void {
  evaluator = next;
}

export function evaluateFormula(formula: string, ctx: FormulaContext): CellValue {
  return evaluator(formula, ctx);
}

/** True when a value is TRUE or a nonzero number: what a formula rule takes as a match. */
export function isTrue(v: CellValue): boolean {
  return v.kind === 'bool' ? v.b : v.kind === 'num' ? v.n !== 0 : false;
}
