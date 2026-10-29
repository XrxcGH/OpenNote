// Reads one line of worked math into a statement: a chain of equal values, equations and inequalities, a system, a
// definition such as f(x) = x^2, a substitution such as let u = x^2, or a note. Calculus inside a line (d/dx, f'(x),
// ∫ with or without limits, [F]_a^b, lim, and Σ) is worked out here with the calculus tools, so the comparisons only
// see values. Never throws for the text, however odd: a line it cannot read comes back as 'unreadable'.
import { build, freeNames } from '../../../core/expr';
import type { Node, Quantity } from '../../../core/expr';
import { substitute } from '../calculus/algebra';
import { derivativeOf } from '../calculus/derivative';
import { limitOf } from '../calculus/limit';
import { definedOn, evaluator, integrateNumerically, valueOf } from '../calculus/numeric';
import { textOf } from '../calculus/print';
import { expression, readQuestion } from '../calculus/read';
import type { Bound, Question } from '../calculus/read';
import { sumOf } from '../calculus/series';
// The checker stays pure: the tools index would load the tool windows, so it reads the notes evaluator itself.
// eslint-disable-next-line opennote/feature-boundaries -- see the line above
import { evaluateNotes } from '../../tools/calculator/notes';
import { compareAt } from './sample';
import { evaluateMatrix, looksLikeMatrix, MatrixShape, type Matrix } from './matrix';
import {
  dropLead,
  dropMarks,
  dropNotes,
  dropSideLabels,
  dropWordLabel,
  hasWords,
  listedAnswers,
  normalize,
  notation,
  splitLine,
  type Rel,
} from './text';
import type { ReasonCode } from './types';

/** An indefinite integral inside a line, kept as a name. Its slope is its body, times d(variable)/dx. */
export interface Integral {
  name: string;
  body: Node;
  /** The integration variable in terms of the line's variable: u = x^2 gives x^2, plain x gives x. */
  inner: Node;
  base: string;
}

export interface Scalar {
  kind: 'scalar';
  node: Node;
  integrals: Integral[];
  /** Where the value came from, when the whole part is one calculus question: for "the derivative is ...". */
  origin?: 'derivative' | 'integral' | 'definite' | 'limit' | 'sum';
  /** The worked-out answer for that question, as text, when the tools found one. */
  answer?: string;
  /** The other reading of a slash before a product: 1/2x read as 1/(2x), for a line that is right only that way. */
  alt?: Node;
  text: string;
  /** lim_(h→0) of a body with other letters in it: the limit's letter, point, and body, to compare with the next. */
  limit?: { x: string; to: number; body: Node };
}

export type Value =
  | Scalar
  | { kind: 'infinite'; sign: 1 | -1; text: string; origin?: Scalar['origin'] }
  | { kind: 'matrix'; m: Matrix; text: string }
  | { kind: 'quantity'; q: Quantity; text: string }
  /** A part that cannot be worked out, such as a limit that does not settle. */
  | { kind: 'unknown'; reason: ReasonCode; text: string }
  /** A part that is wrong on its face, such as meters plus seconds. */
  | { kind: 'invalid'; reason: ReasonCode; text: string };

export interface Atom {
  left: Scalar;
  rel: Rel;
  right: Scalar;
}

export type Statement =
  | { kind: 'blank' }
  /** values: a = b = c = 2 gives each letter the number at its end. */
  | { kind: 'given'; reason: 'definition' | 'substitution' | 'note'; values?: [string, Node][] }
  | { kind: 'values'; parts: Value[]; continues: boolean }
  /** Equations and inequalities: any of the groups (or), each group all of its atoms (and). */
  | {
      kind: 'relations';
      groups: Atom[][];
      text: string;
      /** The chain after a label, as in x = 1/3 = 0.33: [1/3, 0.33], each equal to the one before. */
      tail?: Value[];
    }
  | { kind: 'unreadable'; reason: ReasonCode };

export interface KnownFunction {
  param: string;
  body: Node;
}

/** What earlier lines set up: functions such as f(x) = x^2, and substitutions such as u = x^2. */
export interface Context {
  functions: Map<string, KnownFunction>;
  substitutions: Map<string, Node>;
  /** Letters given by an equation such as y = x^2, for dy/dx and y' on the lines after it. */
  explicit: Map<string, Node>;
}

export const newContext = (): Context => ({ functions: new Map(), substitutions: new Map(), explicit: new Map() });

const CONSTANTS = new Set(['pi', 'e', 'tau', 'phi']);
/** Letters for the parts worked out before parsing. Upper case and rare in school math. */
const HOLDERS = 'QZWJKYVXUGHMNOP';

export const variables = (node: Node): string[] => freeNames(node).filter((name) => !CONSTANTS.has(name));

class Unreadable extends Error {
  constructor(readonly reason: ReasonCode = 'unreadable') {
    super(reason);
  }
}

function parse(text: string): Node {
  try {
    return expression(text, 'text');
  } catch {
    throw new Unreadable();
  }
}

/** The bracket group starting at `at` (which must be an opening bracket) and the index after it, or null. */
function groupAt(text: string, at: number): [string, number] | null {
  const open = text[at];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return null;
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close && --depth === 0) return [text.slice(at + 1, i), i + 1];
  }
  return null;
}

/** f(2), f(x + 1), f'(x), and f''(x) for a function defined on an earlier line, written out. */
function expandFunctions(text: string, ctx: Context): string {
  if (ctx.functions.size === 0) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const head = /^([a-zA-Z])('*)\(/.exec(text.slice(i));
    const before = i > 0 ? text[i - 1] : ' ';
    const known = head && !/[a-zA-Z]/.test(before) ? ctx.functions.get(head[1]) : undefined;
    const group = known && head ? groupAt(text, i + head[0].length - 1) : null;
    if (!known || !head || !group) {
      out += text[i];
      i += 1;
      continue;
    }
    const body = head[2].length > 0 ? derivativeOf(known.body, known.param, head[2].length) : known.body;
    const arg = parse(expandFunctions(group[0], ctx));
    out += `(${textOf(substitute(body, known.param, arg))})`;
    i = group[1];
  }
  return out;
}

/** dy/dx, d^2y/dx^2, and y' or y'' standing alone. */
const LEIBNIZ = /(?<![a-zA-Z])d(?:\^\(?(\d)\)?)?\s*([a-zA-Z])\s*\/\s*d\s*([a-zA-Z])(?:\^\(?\d\)?)?/g;
const PRIME = /(?<![a-zA-Z])([a-zA-Z])('+)(?![a-zA-Z(']|\s*\()/g;

/**
 * The letter y' is worked out by, when the line does not say: x, else t, else the only letter. y = kx^2 has k as a
 * parameter, so the alphabet does not decide; with several letters and neither x nor t, nothing does.
 */
function baseOf(body: Node): string {
  const names = variables(body);
  if (names.length === 0 || names.includes('x')) return 'x';
  if (names.includes('t')) return 't';
  if (names.length === 1) return names[0];
  throw new Unreadable('cannotDecide');
}

/**
 * dy/dx and y' for a letter an earlier line gave, such as y = x^2, worked out as the derivative. A dy/dx with no such
 * line cannot be checked: d, y, and x are not letters multiplied together.
 */
function expandLeibniz(text: string, ctx: Context): { text: string; answer?: string } {
  let whole: string | undefined;
  const worked = (letter: string, x: string | undefined, order: number, match: string) => {
    const body = ctx.explicit.get(letter);
    if (!body) throw new Unreadable('cannotDecide');
    const by = x ?? baseOf(body);
    const d = textOf(derivativeOf(body, by, order));
    if (match.trim() === text.trim()) whole = d;
    return `(${d})`;
  };
  const out = text
    .replace(LEIBNIZ, (match, order: string | undefined, y: string, x: string) =>
      worked(y, x, order ? Number(order) : 1, match),
    )
    .replace(PRIME, (match, y: string, marks: string) =>
      ctx.explicit.has(y) ? worked(y, undefined, marks.length, match) : match,
    );
  return whole ? { text: out, answer: whole } : { text: out };
}

/** Where a calculus part that starts at `at` ends: its bracket group, or the end of the side. */
function spanEnd(text: string, at: number): number {
  let i = at;
  while (text[i] === ' ') i += 1;
  const group = groupAt(text, i);
  return group && text.slice(group[1]).trim() === '' ? group[1] : text.length;
}

/** The end of an integral that starts at `at`: just after its d<letter> outside every bracket. */
function integralEnd(text: string, at: number): number {
  let depth = 0;
  for (let i = at + 1; i < text.length; i += 1) {
    const c = text[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (depth === 0 && c === 'd' && /[a-zA-Z]/.test(text[i + 1] ?? '')) {
      const before = text[i - 1] ?? ' ';
      const after = text[i + 2] ?? ' ';
      if (!/[a-zA-Z]/.test(before) && !/[a-zA-Z(]/.test(after)) return i + 2;
    }
  }
  return -1;
}

function boundValue(b: Bound): number {
  return 'infinite' in b ? b.infinite * Infinity : valueOf(b.node);
}

function nodeOf(value: number): Node {
  return value < 0 ? build.neg(build.num(-value)) : build.num(value);
}

type Worked = { node: Node; answer?: string } | { integral: Omit<Integral, 'name'> } | { infinite: 1 | -1 };

/** A limit, by the calculus tools, or else by values ever closer to the point that settle. */
function limitValue(q: Extract<Question, { kind: 'limit' }>): Worked {
  const found = limitOf(q);
  if (found.ok) return 'infinite' in found.value ? { infinite: found.value.infinite } : { node: found.value.node };
  const free = variables(q.body).filter((name) => name !== q.x);
  if (free.length === 1) return { node: limitIn(q, free[0]) };
  if (free.length > 0) throw new Unreadable('cannotEvaluate');
  return { node: nodeOf(numericLimit(q)) };
}

/**
 * lim_(h→0) ((x + h)^2 - x^2)/h, with x left free: the limit at x = -3 to 6, each worked out on its own, and the
 * polynomial in x through those values (2x here). Throws when they fit no polynomial, as for sin(x + h).
 */
function limitIn(q: Extract<Question, { kind: 'limit' }>, p: string): Node {
  const values: number[] = [];
  for (let k = -3; k <= 6; k += 1) {
    const at = { ...q, body: substitute(q.body, p, nodeOf(k)) };
    const found = limitOf(at);
    const value = found.ok && 'node' in found.value ? valueOf(found.value.node) : numericLimit(at);
    values.push(Math.round(value * 1e6) / 1e6);
  }
  const node = newtonPolynomial(values, p, -3);
  if (!node) throw new Unreadable('cannotEvaluate');
  return node;
}

/** A limit in one letter by values ever closer to the point, when they settle. */
function numericLimit(q: Extract<Question, { kind: 'limit' }>): number {
  const f = evaluator(q.body);
  const to = boundValue(q.to);
  const at = (h: number, side: 1 | -1) =>
    Number.isFinite(to) ? f({ [q.x]: to + side * h }) : f({ [q.x]: Math.sign(to) / h });
  const sides: (1 | -1)[] = q.side === 'left' ? [-1] : q.side === 'right' ? [1] : [1, -1];
  const estimates = sides.map((side) => [1e-3, 1e-4, 1e-5].map((h) => at(h, side)));
  const settled = estimates.every((row) => row.every(Number.isFinite) && Math.abs(row[2] - row[1]) < 1e-6);
  if (!settled) throw new Unreadable('cannotEvaluate');
  const values = estimates.map((row) => row[2]);
  if (values.length === 2 && Math.abs(values[0] - values[1]) > 1e-5) throw new Unreadable('cannotEvaluate');
  return Math.round(values[0] * 1e6) / 1e6;
}

function definiteValue(q: Extract<Question, { kind: 'integral' }>, from: Bound, to: Bound): Worked {
  if (variables(q.body).some((name) => name !== q.x)) throw new Unreadable('cannotEvaluate');
  const [a, b] = [boundValue(from), boundValue(to)];
  const f = evaluator(q.body);
  const g = (x: number) => f({ [q.x]: x });
  if (!Number.isFinite(a) || !Number.isFinite(b) || !definedOn(g, a, b)) throw new Unreadable('cannotEvaluate');
  const value = integrateNumerically(g, a, b);
  if (!Number.isFinite(value)) throw new Unreadable('cannotEvaluate');
  return { node: nodeOf(value) };
}

/** Works out one calculus question: a derivative as a tree, a definite integral, limit, or sum as a value. */
function work(q: Question, ctx: Context): Worked {
  const sub = (node: Node) => applySubstitutions(node, ctx);
  switch (q.kind) {
    case 'derivative': {
      let d = derivativeOf(sub(q.body), q.x, q.order);
      if (q.at) d = substitute(d, q.x, sub(q.at));
      return { node: d, answer: textOf(d) };
    }
    case 'integral': {
      if (q.from && q.to) return definiteValue({ ...q, body: sub(q.body) }, q.from, q.to);
      const inner = ctx.substitutions.get(q.x);
      const base = inner ? (variables(inner)[0] ?? 'x') : q.x;
      return { integral: { body: sub(q.body), inner: inner ?? build.name(q.x), base } };
    }
    case 'limit':
      return limitValue({ ...q, body: sub(q.body) });
    case 'sum': {
      const found = sumOf({ ...q, body: sub(q.body) });
      if (found.ok && !found.approximate) return { node: found.value };
      const closed = polynomialSum({ ...q, body: sub(q.body) });
      if (!closed) throw new Unreadable('cannotEvaluate');
      return { node: closed };
    }
  }
}

/**
 * Σ_(k=1)^n k as a formula in n, for a sum to a letter of a polynomial in k. The sums for n = a - 1 to a + 8 are
 * worked out. Their differences give the polynomial in n (Newton's forward differences), checked past its degree.
 * Null for anything else, such as 2^k, which is left unchecked.
 */
function polynomialSum(q: Extract<Question, { kind: 'sum' }>): Node | null {
  if (!('node' in q.from) || !('node' in q.to) || q.to.node.type !== 'name') return null;
  const n = q.to.node.name;
  const a = valueOf(q.from.node);
  if (!Number.isInteger(a) || n === q.x || variables(q.body).some((name) => name !== q.x)) return null;
  const term = evaluator(q.body);
  const sums = [0];
  for (let k = a; sums.length < 10; k += 1) sums.push(sums[sums.length - 1] + term({ [q.x]: k }));
  return newtonPolynomial(sums, n, a - 1);
}

/**
 * The polynomial in `n` through values[i] at n = start + i (ten of them), by Newton's forward differences, so its
 * degree is checked past itself. Null when nothing up to degree 7 fits.
 */
function newtonPolynomial(values: number[], n: string, start: number): Node | null {
  if (!values.every(Number.isFinite)) return null;
  const sums = values;
  const leading: number[] = [];
  let row = sums;
  while (row.length > 0) {
    leading.push(row[0]);
    const next: number[] = [];
    for (let i = 1; i < row.length; i += 1) next.push(row[i] - row[i - 1]);
    row = next;
  }
  const size = Math.max(1, ...sums.map(Math.abs));
  const degree = leading.reduce((d, v, j) => (Math.abs(v) > 1e-9 * size ? j : d), 0);
  if (degree > 7) return null;
  const a = start + 1;
  // S(n) = Σ_j Δ^j S(a - 1) · C(n - a + 1, j).
  let out: Node = build.num(0);
  let choose: Node = build.num(1);
  for (let j = 0; j <= degree; j += 1) {
    if (j > 0) choose = build.div(build.mul(choose, build.sub(build.name(n), build.num(a - 1 + j - 1))), build.num(j));
    const c = Math.round(leading[j] * 1e9) / 1e9;
    if (c !== 0) out = build.add(out, build.mul(build.num(c), choose));
  }
  return out;
}

function applySubstitutions(node: Node, ctx: Context): Node {
  let out = node;
  for (let round = 0; round < 3; round += 1) {
    for (const [name, value] of ctx.substitutions) out = substitute(out, name, value);
  }
  return out;
}

/** The start of a derivative (d/dx, d^2/dx^2, ∂/∂x), a limit (lim_(x→0)), or a sum (Σ_(n=1)^(10)). */
const GROUP = String.raw`(?:\([^()]*\))`;
const HEAD = new RegExp(
  [
    String.raw`^(?:d(?:\^\(?\d\)?)?\/d[a-zA-Z](?:\^\(?\d\)?)?`,
    String.raw`∂\/∂[a-zA-Z]`,
    String.raw`lim\s*_?\s*${GROUP}?`,
    String.raw`Σ\s*_?\s*${GROUP}?\s*(?:\^\s*(?:${GROUP}|[\w∞]+))?)`,
  ].join('|'),
);

interface Holder {
  letter: string;
  worked: Worked;
}

/** _0^2 or _0^π after [F]: a bound may be a letter such as π, which \w does not match. */
const BOUND = String.raw`(\([^()]*\)|-?[\p{L}\p{N}_.]+)`;
const BOUNDS = new RegExp(String.raw`^\]\s*_\s*${BOUND}\s*\^\s*${BOUND}`, 'u');

/** Replaces each calculus part with a letter, worked out. Returns the text with letters, and the letters. */
function takeCalculus(text: string, ctx: Context): { text: string; holders: Holder[]; whole?: Question } {
  const holders: Holder[] = [];
  const free = [...HOLDERS].filter((letter) => !text.includes(letter));
  let out = text;
  let whole: Question | undefined;
  for (let guard = 0; guard < 12; guard += 1) {
    const start = out.search(
      /∫|(?<![a-zA-Z])(?:d(?:\^\(?\d\)?)?\/d[a-zA-Z]|∂\/∂[a-zA-Z])|(?<![a-zA-Z])lim(?![a-zA-Z])|Σ|\]\s*_/,
    );
    if (start < 0) break;
    let from = start;
    let end: number;
    if (/^\]\s*_/.test(out.slice(start))) {
      // [F]_a^b: back to its opening bracket.
      let depth = 0;
      for (from = start; from >= 0; from -= 1) {
        if (out[from] === ']') depth += 1;
        else if (out[from] === '[' && --depth === 0) break;
      }
      if (from < 0) throw new Unreadable();
      const bounds = BOUNDS.exec(out.slice(start));
      if (!bounds) throw new Unreadable();
      end = start + bounds[0].length;
      const body = parse(out.slice(from + 1, start));
      const x = variables(body)[0] ?? 'x';
      const at = (bound: string) => substitute(body, x, parse(bound.replace(/^\((.*)\)$/, '$1')));
      const node = build.sub(at(bounds[2]), at(bounds[1]));
      const letter = free.shift();
      if (!letter) throw new Unreadable();
      holders.push({ letter, worked: { node } });
      out = `${out.slice(0, from)} (${letter}) ${out.slice(end)}`;
      continue;
    }
    if (out[start] === '∫') end = integralEnd(out, start);
    else {
      const head = HEAD.exec(out.slice(start));
      end = spanEnd(out, start + (head ? head[0].length : 1));
    }
    if (end < 0) throw new Unreadable();
    const piece = out.slice(from, end);
    const read = readQuestion(piece, { mode: 'text' });
    if (!read) throw new Unreadable();
    if (from === 0 && out.slice(end).trim() === '' && holders.length === 0) whole = read.question;
    const letter = free.shift();
    if (!letter) throw new Unreadable();
    holders.push({ letter, worked: work(read.question, ctx) });
    out = `${out.slice(0, from)} (${letter}) ${out.slice(end)}`;
  }
  return { text: out, holders, ...(whole ? { whole } : {}) };
}

const UNITS = 'km|cm|mm|nm|kg|mg|mph|kph|min|hr|ms|ft|in|mi|yd|lb|oz|mL|ml|kWh|kW|kJ|Hz|Pa|kPa|GB|MB|KB|N|J|W';
/** A number with a unit of two letters or more (or N, J, W), a rate such as 5 m/s, or a conversion "in km". */
const UNIT_WORDS = new RegExp(
  [
    String.raw`\d\s*(?:${UNITS})\b`,
    String.raw`\d\s*[a-zA-Z]+\s*\/\s*[a-zA-Z]+\b`,
    String.raw`\bin\s+[a-zA-Z]+\s*$`,
  ].join('|'),
);
const FUNCTION_WORDS = /\b(?:sin|cos|tan|sec|csc|cot|ln|log|exp|sqrt|abs|det|lim|asin|acos|atan|sinh|cosh|tanh)\b/;

/** True when a part reads as a quantity with units, such as 5 km / 2 h or 60 mph in km/h. */
function unitLike(text: string): boolean {
  return UNIT_WORDS.test(text) && !FUNCTION_WORDS.test(text) && !/[∫Σ]/.test(text);
}

const SI_LETTERS = 'msghLAVKNJW';
const UNIT_NAME = new RegExp(`^(?:${UNITS})$`);

/**
 * True when every letter in the line is a unit and a one-letter unit stands after a number and a space, as in
 * 5 m + 3 s or 2 m * 3 m = 6 m^2, and every side has one. 5m = 20 and 5 m = 20 stay algebra.
 */
function singleLetterUnits(text: string): boolean {
  const words = [...text.matchAll(/[a-zA-Z]+/g)];
  let spaced = false;
  for (const word of words) {
    const before = text.slice(0, word.index);
    if (UNIT_NAME.test(word[0])) continue;
    if (word[0].length !== 1 || !SI_LETTERS.includes(word[0])) return false;
    if (/\d\s+$/.test(before)) spaced = true;
    else if (!/\/\s*$/.test(before)) return false;
  }
  // 5 m = 20 may be algebra: every side needs a unit.
  return (
    spaced &&
    text
      .split(/[=<>]/)
      .filter((side) => side.trim() !== '')
      .every((side) => /[a-zA-Z]/.test(side))
  );
}

function readQuantity(text: string): Value {
  const result = evaluateNotes([`${text} =`])[0];
  if (result.kind === 'result') return { kind: 'quantity', q: result.value, text };
  if (result.kind === 'error' && result.error.code === 'unit-mismatch') {
    return { kind: 'invalid', reason: 'unitsAdd', text };
  }
  throw new Unreadable();
}

function readMatrix(text: string): Value {
  try {
    const value = evaluateMatrix(text);
    if (value.kind === 'matrix') return { kind: 'matrix', m: value.m, text };
    return { kind: 'scalar', node: nodeOf(value.n), integrals: [], text };
  } catch (error) {
    if (error instanceof MatrixShape) return { kind: 'invalid', reason: 'matrixShape', text };
    throw new Unreadable();
  }
}

/** One side of a line as a value. */
export function readValue(raw: string, ctx: Context, units: boolean, at?: [string, string]): Value {
  const text = raw.trim();
  if (text === '') throw new Unreadable();
  if (!text.includes('∫') && /(?:^|\s)d[a-zA-Z]$/.test(text.replace(/\s*\/\s*/g, '/'))) throw new Unreadable();
  if (/^[+]?∞$/.test(text)) return { kind: 'infinite', sign: 1, text };
  if (/^-∞$/.test(text)) return { kind: 'infinite', sign: -1, text };
  if (units) return readQuantity(text);
  if (looksLikeMatrix(text)) {
    try {
      return readMatrix(text);
    } catch (error) {
      // Square brackets used as round ones, as in 2[x + 1]: read as plain math below.
      if (!(error instanceof Unreadable)) throw error;
    }
  }
  const leibniz = expandLeibniz(text, ctx);
  const brackets = leibniz.text.replace(/\[(?![^\]]*\]\s*_)/g, '(').replace(/\](?!\s*_)/g, ')');
  const expanded = expandFunctions(brackets, ctx);
  const { text: plain, holders, whole } = takeCalculus(expanded, ctx);
  let node = applySubstitutions(parse(plain), ctx);
  const integrals: Integral[] = [];
  for (const holder of holders) {
    const w = holder.worked;
    if ('integral' in w) integrals.push({ name: holder.letter, ...w.integral });
    else if ('infinite' in w) {
      if (holders.length === 1 && plain.trim() === `(${holder.letter})`) {
        return { kind: 'infinite', sign: w.infinite, text, origin: whole?.kind === 'limit' ? 'limit' : undefined };
      }
      throw new Unreadable('cannotEvaluate');
    } else node = substitute(node, holder.letter, w.node);
  }
  let origin: Scalar['origin'] = whole
    ? whole.kind === 'integral'
      ? whole.from
        ? 'definite'
        : 'integral'
      : whole.kind
    : undefined;
  let answer = holders.length === 1 && 'node' in holders[0].worked ? holders[0].worked.answer : undefined;
  const limit =
    whole?.kind === 'limit' && variables(whole.body).length > 1 && !('infinite' in whole.to)
      ? { x: whole.x, to: valueOf(whole.to.node), body: applySubstitutions(whole.body, ctx) }
      : undefined;
  if (leibniz.answer) [origin, answer] = ['derivative', leibniz.answer];
  if (at) {
    // d/dx(x^3) at x = 2: the value there.
    node = substitute(node, at[0], applySubstitutions(parse(at[1]), ctx));
    answer = undefined;
  }
  // i^2 = -1: i is the imaginary unit, not a letter to try numbers in.
  if (variables(node).some((name) => name === 'i' || name === 'j')) throw new Unreadable('complexNumbers');
  const alt = integrals.length === 0 ? otherReading(text, ctx, at) : undefined;
  return {
    kind: 'scalar',
    node,
    integrals,
    text,
    ...(origin ? { origin } : {}),
    ...(answer ? { answer } : {}),
    ...(alt ? { alt } : {}),
    ...(limit ? { limit } : {}),
  };
}

/**
 * A slash right before a product with no mark between, as in 1/2x or 2x/3y: handwriting and typed notes often mean
 * 1/(2x), and the strict reading is (1/2)x. Not 1/x, 1/2 x, 1/2x^2 or 1/sin(x), which read one way.
 */
const SLASH_PRODUCT = /\/\s*(\d+(?:\.\d+)?[a-zA-Z]+|[a-zA-Z]{2,})(?![\w('^])/g;
const FUNCTION_START = /^(?:sin|cos|tan|sec|csc|cot|ln|log|exp|sqrt|abs|det|pi)/;

function otherReading(text: string, ctx: Context, at?: [string, string]): Node | undefined {
  let changed = false;
  const grouped = text.replace(SLASH_PRODUCT, (whole, run: string) => {
    // dy/dx is a derivative, not d times y over d times x.
    if (FUNCTION_START.test(run.replace(/^[\d.]+/, '')) || /^d[a-zA-Z]$/.test(run)) return whole;
    changed = true;
    return `/(${run})`;
  });
  if (!changed) return undefined;
  try {
    const value = readValue(grouped, ctx, false, at);
    return value.kind === 'scalar' ? value.node : undefined;
  } catch {
    return undefined;
  }
}

const DEFINITION = /^([a-zA-Z])\s*\(\s*([a-zA-Z])\s*\)$/;
const DIFFERENTIAL = /^d[a-zA-Z]$/;
const ASSIGN = /^(?:let|put|set|where|with)\s+([a-zA-Z])$/i;

function hasCalculus(text: string): boolean {
  return (
    /∫|(?<![a-zA-Z])d(?:\^\(?\d\)?)?\/d[a-zA-Z]|∂|(?<![a-zA-Z])lim(?![a-zA-Z])|Σ|\]\s*_|[a-zA-Z]'+\(/.test(text) ||
    new RegExp(LEIBNIZ.source).test(text) ||
    new RegExp(PRIME.source).test(text)
  );
}

function scalarOf(value: Value): Scalar {
  if (value.kind !== 'scalar') throw new Unreadable();
  return value;
}

/** Reads one line. Definitions and substitutions are added to the context for the lines after it. */
export function readLine(raw: string, ctx: Context): Statement {
  const plain = notation(dropWordLead(dropMarks(dropNotes(dropLead(normalize(raw))))));
  if (plain === '') return { kind: 'blank' };
  // x = 0.1.2 is no number, and dx alone is a differential with no integral: never shown with a check mark.
  if (/\d\.\d+\.\d/.test(plain)) return { kind: 'unreadable', reason: 'unreadable' };
  const labelled = dropSideLabels(plain);
  if (labelled === null) return { kind: 'given', reason: 'note' };
  const text = listedAnswers(dropWordLabel(labelled));
  if (text.length > 2000) return { kind: 'unreadable', reason: 'tooLong' };
  // Problem 2, or 2x = 6 divide by 2: words, not letters multiplied together.
  if (hasWords(text)) return { kind: 'unreadable', reason: 'notMath' };
  try {
    return readStatement(text, ctx);
  } catch (error) {
    if (error instanceof Unreadable) return { kind: 'unreadable', reason: error.reason };
    if (error instanceof RangeError) return { kind: 'unreadable', reason: 'tooLong' };
    return { kind: 'unreadable', reason: 'unreadable' };
  }
}

/**
 * let x = y = z = 1, set y' = 0, ans x = 2: the word before the working is dropped, so it is never read as letters
 * multiplied together. let u = x^2 keeps its word: it names a substitution.
 */
function dropWordLead(text: string): string {
  const lead = /^(?:let|set|put|ans|answer|check)\s+/i.exec(text);
  if (!lead) return text;
  const rest = text.slice(lead[0].length);
  return /^(?:let|set|put)\s/i.test(lead[0]) && /^[a-zA-Z]\s*=[^=]*$/.test(rest) ? text : rest;
}

/** d/dx(x^3) at x = 2, or |_(x=2): the point, and the line without it. */
const AT =
  /\s*(?:\bat\s+([a-zA-Z])\s*=\s*|\|_\s*[({]?\s*([a-zA-Z])\s*=\s*)(-?[\d.]+(?:\/[\d.]+)?|\([^()]*\)|pi)\s*[)}]?(?=\s*(?:=|$))/;

function takePoint(text: string): { text: string; side: number; at: [string, string] } | null {
  const found = AT.exec(text);
  if (!found) return null;
  const before = text.slice(0, found.index);
  const side = splitLine(before).clauses[0]?.rels.length ?? 0;
  return { text: before + text.slice(found.index + found[0].length), side, at: [found[1] ?? found[2], found[3]] };
}

/** A letter or f(x) before a chain of equal values: x = 1/3 = 0.33 names its value, it is not one of them. */
const LABEL = /^(?:[a-zA-Z]|[a-zA-Z]\s*\(\s*[a-zA-Z]\s*\))$/;

function readStatement(line: string, ctx: Context): Statement {
  const point = takePoint(line);
  const text = point ? point.text : line;
  const split = splitLine(text);
  const { clauses } = split;
  const unitLine = singleLetterUnits(text);
  // x = y = z, or a = b = c = 2: letters named equal (and given the number at the end), a note, not a step to check.
  const [only] = clauses;
  if (clauses.length === 1 && only.sides.length > 2 && only.rels.every((r) => r === '=')) {
    const letters = only.sides.slice(0, -1);
    const end = only.sides[only.sides.length - 1].trim();
    if (letters.every((side) => /^[a-zA-Z]$/.test(side.trim())) && /^(?:[a-zA-Z]|-?\d+(?:\.\d+)?)$/.test(end)) {
      if (!/^-?\d/.test(end)) return { kind: 'given', reason: 'note' };
      return { kind: 'given', reason: 'note', values: letters.map((side) => [side.trim(), parse(end)]) };
    }
  }
  const valueAt = (side: string, i: number, units: boolean) =>
    readValue(side, ctx, units, point && point.side === i ? point.at : undefined);

  // u = x, du = dx, dv = e^x dx, v = e^x: substitutions and differentials, as notes for the steps after them.
  const assignments = clauses.map((c) => (c.rels.length === 1 && c.rels[0] === '=' ? c : null));
  const differentialLine = assignments.every(Boolean) && clauses.some((c) => DIFFERENTIAL.test(c.sides[0]));
  const lead = clauses.length === 1 && clauses[0].rels.length === 1 ? ASSIGN.exec(clauses[0].sides[0]) : null;
  if (differentialLine || lead) {
    for (const c of clauses) {
      const name = lead ? lead[1] : /^[a-zA-Z]$/.test(c.sides[0]) ? c.sides[0] : null;
      if (name && !DIFFERENTIAL.test(c.sides[0])) {
        ctx.substitutions.set(name, applySubstitutions(parse(expandFunctions(c.sides[1], ctx)), ctx));
      }
    }
    return { kind: 'given', reason: differentialLine ? 'note' : 'substitution' };
  }

  const plusMinus = clauses.length === 1 && clauses[0].sides.some((side) => side.includes('±'));
  if (!plusMinus && split.join === 'and' && clauses.length === 1 && clauses[0].rels.every((rel) => rel === '=')) {
    const { sides } = clauses[0];
    if (sides.length === 1) {
      return { kind: 'values', parts: [valueAt(sides[0], 0, unitLine || unitLike(sides[0]))], continues: false };
    }
    const definition = sides.length === 2 ? DEFINITION.exec(sides[0]) : null;
    if (definition && definition[1] !== definition[2] && !ctx.functions.has(definition[1]) && !hasCalculus(sides[1])) {
      const body = applySubstitutions(parse(expandFunctions(sides[1], ctx)), ctx);
      ctx.functions.set(definition[1], { param: definition[2], body });
      return { kind: 'given', reason: 'definition' };
    }
    const continues = sides[0] === '';
    const units = unitLine || sides.some(unitLike);
    const special = units || sides.some((s) => hasCalculus(s) || looksLikeMatrix(s) || s.includes('∞'));
    if (sides.length > 2 && !units && LABEL.test(sides[0])) return labelled(sides, ctx);
    if (continues || special || sides.length > 2) {
      const parts = sides.map((side, i) => (continues && i === 0 ? null : valueAt(side, i, units)));
      return { kind: 'values', parts: parts.filter((p): p is Value => p !== null), continues };
    }
    const [left, right] = sides.map((side, i) => valueAt(side, i, false));
    if (left.kind === 'scalar' && right.kind === 'scalar') {
      // Plain numbers (3 + 4 = 7), or an identity such as sin(x)^2 + cos(x)^2 = 1: a claim to check, not to solve.
      const names = variables(build.sub(left.node, right.node));
      const identity =
        names.length > 0 && compareAt(evaluator(left.node), evaluator(right.node), names, 97).result === 'same';
      if (names.length === 0 || identity || callClaim(sides[0], right, ctx)) {
        return { kind: 'values', parts: [left, right], continues: false };
      }
    }
  }

  // Equations and inequalities. x = ±2 is x = 2 or x = -2.
  let groups = clauses;
  let join = split.join;
  if (plusMinus) {
    const [c] = clauses;
    groups = [
      { sides: c.sides.map((s) => s.replace(/±/g, '+')), rels: c.rels },
      { sides: c.sides.map((s) => s.replace(/±/g, '-')), rels: c.rels },
    ];
    join = 'or';
  }
  const atomsOf = (c: (typeof groups)[number]): Atom[] => {
    if (c.rels.length === 0) throw new Unreadable();
    const sides = c.sides.map((side) => scalarOf(readValue(side, ctx, false)));
    return c.rels.map((rel, i) => ({ left: sides[i], rel, right: sides[i + 1] }));
  };
  const all = groups.map(atomsOf);
  const statement: Statement = { kind: 'relations', groups: join === 'or' ? all : [all.flat()], text };
  remember(statement, ctx);
  return statement;
}

/**
 * f(x + h) = x^2 + 2xh + h^2 after f(x) = x^2: the function worked out at a new argument, a claim to check rather than
 * an equation to solve. Only when the right side uses every letter of the argument; f(2x) = 8 is still solved, and so
 * is f(x) = 4 with the function's own letter.
 */
function callClaim(side: string, right: Scalar, ctx: Context): boolean {
  const call = /^([a-zA-Z])\((.+)\)$/.exec(side.trim());
  const known = call ? ctx.functions.get(call[1]) : undefined;
  if (!call || !known || groupAt(side.trim(), 1)?.[1] !== side.trim().length) return false;
  if (call[2].trim() === known.param) return false;
  const inArg = variables(parse(call[2]));
  const onRight = variables(right.node);
  return inArg.length > 0 && inArg.every((name) => onRight.includes(name));
}

/** y = x^2 gives y for a dy/dx on a later line. */
function remember(statement: Extract<Statement, { kind: 'relations' }>, ctx: Context) {
  if (statement.groups.length !== 1 || statement.groups[0].length !== 1) return;
  const [atom] = statement.groups[0];
  if (atom.rel !== '=' || atom.left.node.type !== 'name') return;
  const { name } = atom.left.node;
  if (!variables(atom.right.node).includes(name)) ctx.explicit.set(name, atom.right.node);
}

/**
 * x = 1/3 = 0.33, y = x^2 + 2x + 1 = (x + 1)^2, or f(x) = (x + 1)^2 = x^2 + 2x + 1: the values after the label are
 * the chain. With a letter, the line is also the equation x = 1/3, and the chain's values are its tail.
 */
function labelled(sides: string[], ctx: Context): Statement {
  const definition = DEFINITION.exec(sides[0]);
  if (definition && !ctx.functions.has(definition[1]) && !hasCalculus(sides[1])) {
    const body = applySubstitutions(parse(expandFunctions(sides[1], ctx)), ctx);
    const parts = sides.slice(1).map((side) => readValue(side, ctx, false));
    ctx.functions.set(definition[1], { param: definition[2], body });
    return { kind: 'values', parts, continues: false };
  }
  const parts = sides.slice(1).map((side) => readValue(side, ctx, false));
  const [first] = parts;
  if (definition || first.kind !== 'scalar' || first.integrals.length > 0) {
    return { kind: 'values', parts, continues: false };
  }
  const left = scalarOf(readValue(sides[0], ctx, false));
  const statement: Statement = {
    kind: 'relations',
    groups: [[{ left, rel: '=', right: first }]],
    text: sides.join(' = '),
    tail: parts,
  };
  remember(statement, ctx);
  return statement;
}
