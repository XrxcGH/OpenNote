// Reads a calculus question: LaTeX in an equation (typed, or read from handwriting), or plain text on a page line.
// - A derivative: d/dx(...), \frac{d}{dx}, d^2/dx^2, f'(x), f''(2), or ∂/∂x.
// - An integral: ∫ ... dx, with or without limits.
// - A limit: lim_(x→a), from one side or at infinity.
// - A sum: Σ_(n=1)^10, or to infinity.
// A question that ends in "=" asks for its answer. Anything else is not a calculus question, and comes back as null.
import { build, freeNames } from '../../../core/expr';
import type { Node } from '../../../core/expr';
import { findParameters, parseExpression } from '../grapher/parser';
import { Unsupported, latexToText } from '../actions/convert';
import { substitute } from './algebra';

/** A limit of a sum, an integral, or a limit: a value, or plus or minus infinity. */
export type Bound = { node: Node } | { infinite: 1 | -1 };

export type Question =
  | { kind: 'derivative'; body: Node; x: string; order: number; partial: boolean; at?: Node }
  | { kind: 'integral'; body: Node; x: string; from?: Bound; to?: Bound }
  | { kind: 'limit'; body: Node; x: string; to: Bound; side?: 'left' | 'right' }
  | { kind: 'sum'; body: Node; x: string; from: Bound; to: Bound };

/** A function defined elsewhere on the page, such as f(x) = x^2, for f'(x). */
export interface KnownFunction {
  params: readonly string[];
  body: Node;
}

export interface ReadOptions {
  /** 'latex' for an equation, 'text' for a line of a page. */
  mode: 'latex' | 'text';
  functions?: (name: string) => KnownFunction | undefined;
}

export interface Read {
  question: Question;
  /** True when the question ends in "=", asking for its answer. */
  asks: boolean;
}

const FUNCTION_POWER = /\\(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh)\s*\^\s*\{?\s*(-?\d+)\s*\}?/g;

/** LaTeX's calculus notation as the plain marks the reader looks for: d/dx, ∂/∂x, ∫, lim, Σ, →, ∞. */
function plainMarks(latex: string): string {
  return latex
    .replace(/\\[dt]frac/g, '\\frac')
    .replace(/\\mathrm\{d\}/g, 'd')
    .replace(/\\(?:operatorname|mathrm)\{([a-z]+)\}/g, '\\$1')
    .replace(/\\frac\{\s*d\s*\^\s*\{?(\d)\}?\s*\}\{\s*d\s*([a-zA-Z])\s*\^\s*\{?\d\}?\s*\}/g, 'd^$1/d$2^$1 ')
    .replace(/\\frac\{\s*d\s*\}\{\s*d\s*([a-zA-Z])\s*\}/g, 'd/d$1 ')
    .replace(/\\frac\{\s*\\partial\s*\}\{\s*\\partial\s*([a-zA-Z])\s*\}/g, '∂/∂$1 ')
    .replace(/\\partial\s*/g, '∂')
    .replace(/\\int(?:\\limits)?/g, '∫')
    .replace(/\\lim(?:\\limits)?/g, 'lim')
    .replace(/\\sum(?:\\limits)?/g, 'Σ')
    .replace(/\\(?:to|rightarrow|longrightarrow)(?![a-zA-Z])/g, '→')
    .replace(/\\infty/g, '∞')
    .replace(/\\left\|([^|]*)\\right\|/g, '\\operatorname{abs}($1)')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\(?:left|right|big|Big)(?![a-zA-Z])/g, '');
}

/** Typed marks as the same: ->, oo, inf, int, sum, ∑, and the minus and times signs. */
function plainText(text: string): string {
  return text
    .replace(/->/g, '→')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\b(?:infinity|inf|oo)\b/g, '∞')
    .replace(/∑/g, 'Σ')
    .replace(/^\s*int(?![a-zA-Z])/, '∫')
    .replace(/^\s*sum(?![a-zA-Z])/, 'Σ')
    .replace(/[−–]/g, '-')
    .replace(/[×·]/g, '*');
}

/** |u| as abs(u), for bars that pair up plainly. */
const bars = (text: string) => text.replace(/\|([^|]+)\|/g, 'abs($1)');

/** Parses an expression from the question. Throws Unsupported when it cannot be read. */
export function expression(source: string, mode: ReadOptions['mode']): Node {
  let text = source.trim().replace(/π/g, 'pi');
  if (text === '') throw new Unsupported();
  if (mode === 'latex') {
    text = text.replace(FUNCTION_POWER, '\\$1^$2 ').replace(/\\operatorname\{abs\}/g, 'abs');
    text = latexToText(bars(text.replace(/\\(sec|csc|cot)\b/g, '$1 ')));
  } else text = bars(text);
  try {
    return parseExpression(text, { parameters: findParameters(text) });
  } catch {
    throw new Unsupported();
  }
}

/** A brace group, a bracket group, or one token at the start: its inside and the rest. */
function takeGroup(text: string): [string, string] | null {
  const s = text.trimStart();
  const open = s[0];
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : null;
  if (close) {
    let depth = 0;
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === open) depth += 1;
      else if (s[i] === close && --depth === 0) return [s.slice(1, i), s.slice(i + 1)];
    }
    return null;
  }
  const token = /^(-?\s*[\d.]+|-?∞|-?\\?pi|-?π|[a-zA-Z])/.exec(s);
  return token ? [token[0], s.slice(token[0].length)] : null;
}

function bound(text: string, mode: ReadOptions['mode']): Bound {
  const t = text.trim().replace(/^\+/, '');
  if (t === '∞' || t === '+∞') return { infinite: 1 };
  if (t === '-∞') return { infinite: -1 };
  return { node: expression(t, mode) };
}

/** Drops the brackets around a whole body, so d/dx(x^2) and d/dx[x^2] read alike. */
function unwrap(body: string): string {
  const group = /^[[(]/.test(body.trim()) ? takeGroup(body) : null;
  return group && group[1].trim() === '' ? group[0] : body;
}

function derivative(head: RegExpExecArray, rest: string, mode: ReadOptions['mode']): Question {
  const partial = head[0].startsWith('∂');
  const order = head[1] ? Number(head[1]) : 1;
  return { kind: 'derivative', body: expression(unwrap(rest), mode), x: head[2], order, partial };
}

function prime(text: string, options: ReadOptions): Question | null {
  const match = /^([a-zA-Z])('+|′+|\^\{?\\prime\}?)\s*\((.+)\)$/.exec(text.trim());
  const known = match && options.functions?.(match[1]);
  if (!match || !known || known.params.length !== 1) return null;
  const order = match[2].includes('prime') ? 1 : [...match[2]].length;
  const [param] = known.params;
  const arg = match[3].trim();
  if (/^[a-zA-Z]$/.test(arg)) {
    const body = substitute(known.body, param, build.name(arg));
    return { kind: 'derivative', body, x: arg, order, partial: false };
  }
  return { kind: 'derivative', body: known.body, x: param, order, partial: false, at: expression(arg, options.mode) };
}

function integral(rest: string, mode: ReadOptions['mode']): Question | null {
  let text = rest;
  let from: Bound | undefined;
  let to: Bound | undefined;
  const limits = /^\s*_/.test(text);
  if (limits) {
    const low = takeGroup(text.trimStart().slice(1));
    if (!low || !/^\s*\^/.test(low[1])) return null;
    const high = takeGroup(low[1].trimStart().slice(1));
    if (!high) return null;
    [from, to, text] = [bound(low[0], mode), bound(high[0], mode), high[1]];
  }
  const parts =
    /^(.*?)\s*(?<![a-zA-Z\\])d\s*([a-zA-Z])\s*$/s.exec(text) ?? /^(.*[^\sa-zA-Z].*?)d([a-zA-Z])\s*$/s.exec(text);
  if (!parts) return null;
  const body = parts[1].trim() === '' ? '1' : unwrap(parts[1]);
  return { kind: 'integral', body: expression(body, mode), x: parts[2], ...(from && to ? { from, to } : {}) };
}

function limit(rest: string, mode: ReadOptions['mode']): Question | null {
  const text = rest.replace(/^\s*_/, '');
  const group = /^\s*[{([]/.test(text)
    ? takeGroup(text)
    : (/^\s*([a-zA-Z]\s*→\s*\S+)(.*)$/s.exec(text)?.slice(1, 3) as [string, string] | undefined);
  const inside = group && /^\s*([a-zA-Z])\s*→\s*(.+?)\s*$/s.exec(group[0]);
  if (!inside) return null;
  const side = /(?:\^\s*\{?\s*([+-])\s*\}?|([^\s^→])([+-]))$/.exec(inside[2]);
  const sign = side ? (side[1] ?? side[3]) : undefined;
  const target = side ? inside[2].slice(0, side.index + (side[2] ? 1 : 0)) : inside[2];
  return {
    kind: 'limit',
    body: expression(unwrap(group[1]), mode),
    x: inside[1],
    to: bound(target, mode),
    ...(sign ? { side: sign === '+' ? ('right' as const) : ('left' as const) } : {}),
  };
}

function sum(rest: string, mode: ReadOptions['mode']): Question | null {
  if (!/^\s*_/.test(rest)) return null;
  const low = takeGroup(rest.trimStart().slice(1));
  const start = low && /^\s*([a-zA-Z])\s*=\s*(.+)$/s.exec(low[0]);
  if (!low || !start || !/^\s*\^/.test(low[1])) return null;
  const high = takeGroup(low[1].trimStart().slice(1));
  if (!high) return null;
  return {
    kind: 'sum',
    body: expression(unwrap(high[1]), mode),
    x: start[1],
    from: bound(start[2], mode),
    to: bound(high[0], mode),
  };
}

function question(text: string, options: ReadOptions): Question | null {
  const head = /^(?:d(?:\^\{?(\d)\}?)?\/d([a-zA-Z])(?:\^\{?\d\}?)?|∂\/∂([a-zA-Z]))/.exec(text);
  if (head) {
    if (head[3]) head[2] = head[3];
    return derivative(head, text.slice(head[0].length), options.mode);
  }
  if (text.startsWith('∫')) return integral(text.slice(1), options.mode);
  if (/^lim(?![a-zA-Z])/.test(text)) return limit(text.slice(3), options.mode);
  if (text.startsWith('Σ')) return sum(text.slice(1), options.mode);
  return prime(text, options);
}

/** Reads a calculus question, or null when the source is not one (or cannot be read). */
export function readQuestion(source: string, options: ReadOptions): Read | null {
  if (source.length > 2000) return null;
  let text = options.mode === 'latex' ? plainMarks(source) : plainText(source);
  text = text.trim();
  const asks = /=\s*$/.test(text);
  text = text.replace(/=\s*$/, '').trim();
  if (text.includes('=') && !/^(Σ|∫)/.test(text)) return null;
  try {
    const found = question(text, options);
    return found && sensible(found) ? { question: found, asks } : null;
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

/** A question whose variable appears where it should: d/dx of 5 is fine, but the bounds may not use the variable. */
function sensible(found: Question): boolean {
  const bounds = 'from' in found ? [found.from, found.to] : found.kind === 'limit' ? [found.to] : [];
  return bounds.every((b) => !b || 'infinite' in b || !freeNames(b.node).includes(found.x));
}
