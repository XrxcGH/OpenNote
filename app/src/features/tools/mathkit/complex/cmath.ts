// Complex arithmetic and a small reader for complex expressions such as (1+i)^8, e^z/(z-1) or 1/(2+cos(t)). It is
// its own reader because the shared expression engine is real only. Text becomes a tree of fixed operations and is
// never run as code.
import { KitError } from '../types';

export interface C {
  re: number;
  im: number;
}

export const c = (re: number, im = 0): C => ({ re, im });
export const ZERO = c(0);
export const ONE = c(1);
export const I = c(0, 1);
export const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
export const sub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
export const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a: C, k: number): C => c(a.re * k, a.im * k);
export const neg = (a: C): C => c(0 - a.re, 0 - a.im);
export const conj = (a: C): C => c(a.re, -a.im);
export const abs = (a: C): number => Math.hypot(a.re, a.im);
export const arg = (a: C): number => Math.atan2(a.im, a.re);

export function div(a: C, b: C): C {
  // Smith's method keeps large and small parts from overflowing.
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const d = b.re + b.im * r;
    return c((a.re + a.im * r) / d, (a.im - a.re * r) / d);
  }
  const r = b.re / b.im;
  const d = b.re * r + b.im;
  return c((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}

export const exp = (a: C): C => scale(c(Math.cos(a.im), Math.sin(a.im)), Math.exp(a.re));
/** The principal logarithm: ln|a| + i Arg a, with Arg in (-pi, pi]. */
export const log = (a: C): C => c(Math.log(abs(a)), arg(a));

export function sqrt(a: C): C {
  const m = abs(a);
  if (m === 0) return ZERO;
  const re = Math.sqrt((m + a.re) / 2);
  const im = Math.sqrt((m - a.re) / 2);
  return c(re, a.im < 0 ? -im : im);
}

export function pow(a: C, b: C): C {
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 4096) {
    let n = Math.abs(b.re);
    let base = a;
    let out = ONE;
    while (n > 0) {
      if (n & 1) out = mul(out, base);
      base = mul(base, base);
      n = Math.floor(n / 2);
    }
    return b.re < 0 ? div(ONE, out) : out;
  }
  if (a.re === 0 && a.im === 0) return b.re > 0 ? ZERO : c(NaN, NaN);
  return exp(mul(b, log(a)));
}

export const sin = (a: C): C => c(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
export const cos = (a: C): C => c(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
export const sinh = (a: C): C => c(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
export const cosh = (a: C): C => c(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));
export const tan = (a: C): C => div(sin(a), cos(a));
export const tanh = (a: C): C => div(sinh(a), cosh(a));

const FUNCTIONS: Record<string, (a: C) => C> = {
  exp,
  ln: log,
  log,
  sqrt,
  sin,
  cos,
  tan,
  sinh,
  cosh,
  tanh,
  abs: (a) => c(abs(a)),
  conj,
  re: (a) => c(a.re),
  im: (a) => c(a.im),
  arg: (a) => c(arg(a)),
};

export type Tree =
  | { t: 'num'; v: C }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Tree }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Tree; b: Tree }
  | { t: 'call'; fn: string; a: Tree };

interface Token {
  kind: 'num' | 'id' | 'op' | 'end';
  text: string;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const text = source.replace(/\*\*/g, '^').replace(/[·×]/g, '*').replace(/−/g, '-').replace(/π/g, 'pi');
  let at = 0;
  while (at < text.length) {
    const ch = text[at];
    if (/\s/.test(ch)) {
      at++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(at));
      if (!m) throw new KitError('unreadable', source);
      tokens.push({ kind: 'num', text: m[0] });
      at += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(text.slice(at))!;
      tokens.push({ kind: 'id', text: m[0] });
      at += m[0].length;
    } else if ('+-*/^(),'.includes(ch)) {
      tokens.push({ kind: 'op', text: ch });
      at++;
    } else {
      throw new KitError('unreadable', source);
    }
  }
  tokens.push({ kind: 'end', text: '' });
  return tokens;
}

/** Reads complex expression text. `vars` names the variables; i and j are the imaginary unit. */
export function readComplex(source: string, vars: readonly string[] = ['z']): Tree {
  if (!source.trim()) throw new KitError('empty');
  const tokens = tokenize(source);
  let at = 0;
  const peek = () => tokens[at];
  const fail = (): never => {
    throw new KitError('unreadable', source);
  };
  const eat = (text: string) => {
    if (peek().kind === 'op' && peek().text === text) {
      at++;
      return true;
    }
    return false;
  };
  const startsPrimary = () => {
    const token = peek();
    return token.kind === 'num' || token.kind === 'id' || (token.kind === 'op' && token.text === '(');
  };
  function primary(): Tree {
    const token = peek();
    if (token.kind === 'num') {
      at++;
      return { t: 'num', v: c(Number(token.text)) };
    }
    if (token.kind === 'id') {
      at++;
      const name = token.text;
      if (name === 'i' || name === 'j') return { t: 'num', v: I };
      if (name === 'pi') return { t: 'num', v: c(Math.PI) };
      if (name === 'e' && !vars.includes('e')) return { t: 'num', v: c(Math.E) };
      if (vars.includes(name)) return { t: 'var', name };
      if (name in FUNCTIONS) {
        if (!eat('(')) fail();
        const inner = sum();
        if (!eat(')')) fail();
        return { t: 'call', fn: name, a: inner };
      }
      throw new KitError('unknown-name', name);
    }
    if (eat('(')) {
      const inner = sum();
      if (!eat(')')) fail();
      return inner;
    }
    return fail();
  }
  function power(): Tree {
    const base = primary();
    if (eat('^')) {
      const sign = eat('-') ? -1 : (eat('+'), 1);
      const exponent = power();
      return { t: 'bin', op: '^', a: base, b: sign < 0 ? { t: 'neg', a: exponent } : exponent };
    }
    return base;
  }
  function unary(): Tree {
    if (eat('-')) return { t: 'neg', a: unary() };
    if (eat('+')) return unary();
    return power();
  }
  function product(): Tree {
    let left = unary();
    for (;;) {
      if (eat('*')) left = { t: 'bin', op: '*', a: left, b: unary() };
      else if (eat('/')) left = { t: 'bin', op: '/', a: left, b: unary() };
      else if (startsPrimary()) left = { t: 'bin', op: '*', a: left, b: power() };
      else return left;
    }
  }
  function sum(): Tree {
    let left = product();
    for (;;) {
      if (eat('+')) left = { t: 'bin', op: '+', a: left, b: product() };
      else if (eat('-')) left = { t: 'bin', op: '-', a: left, b: product() };
      else return left;
    }
  }
  const tree = sum();
  if (peek().kind !== 'end') fail();
  return tree;
}

export type CFn = (values: Readonly<Record<string, C>>) => C;

export function evaluateTree(tree: Tree, values: Readonly<Record<string, C>>): C {
  switch (tree.t) {
    case 'num':
      return tree.v;
    case 'var':
      return values[tree.name] ?? c(NaN, NaN);
    case 'neg':
      return neg(evaluateTree(tree.a, values));
    case 'call':
      return FUNCTIONS[tree.fn](evaluateTree(tree.a, values));
    case 'bin': {
      const a = evaluateTree(tree.a, values);
      const b = evaluateTree(tree.b, values);
      if (tree.op === '+') return add(a, b);
      if (tree.op === '-') return sub(a, b);
      if (tree.op === '*') return mul(a, b);
      if (tree.op === '/') return div(a, b);
      return pow(a, b);
    }
  }
}

/** Text as a function of the named complex variables. */
export function compileComplex(
  source: string,
  vars: readonly string[] = ['z'],
): (values: Readonly<Record<string, C>>) => C {
  const tree = readComplex(source, vars);
  return (values) => evaluateTree(tree, values);
}

/** A complex number as text, a + bi, with tiny parts treated as zero. */
export function formatC(a: C, digits = 8): string {
  const scaleOf = Math.max(Math.abs(a.re), Math.abs(a.im), 1e-300);
  const clean = (v: number) => (Math.abs(v) < 1e-11 * Math.max(scaleOf, 1) ? 0 : v);
  const part = (v: number) => {
    const text = Number(clean(v).toPrecision(digits)).toString();
    return text.replace('-', '−');
  };
  const re = clean(a.re);
  const im = clean(a.im);
  if (im === 0) return part(re);
  const imag = Math.abs(im) === 1 ? 'i' : `${part(Math.abs(im))}i`;
  if (re === 0) return `${im < 0 ? '−' : ''}${imag}`;
  return `${part(re)} ${im < 0 ? '−' : '+'} ${imag}`;
}

/** The same number as LaTeX. */
export function latexC(a: C, digits = 8): string {
  return formatC(a, digits).replace(/−/g, '-').replace(/ \+ /g, '+').replace(/ - /g, '-');
}
