// Generating functions as truncated power series: an expression in x with + - * / ^ and parentheses, such as
// (1 + x + x^2) / (1 - x)^2 or 1/((1 - x)(1 - x^5)), expands to its first coefficients with exact fractions.
// Division is power-series division, so the divisor needs a nonzero constant term. Inclusion-exclusion counts a
// union from the sizes of the sets and of every intersection.
import { ONE, ZERO, add, div, isZero, mul, neg, parseFrac, sub } from '../core/frac';
import type { Frac } from '../core/frac';
import { fail } from '../core/util';

/** A power series cut off after `n` coefficients. */
type Series = Frac[];

const constant = (c: Frac, n: number): Series => Array.from({ length: n }, (_, i) => (i === 0 ? c : ZERO));

function times(a: Series, b: Series): Series {
  const out = a.map(() => ZERO);
  for (let i = 0; i < a.length; i += 1)
    if (!isZero(a[i])) for (let j = 0; i + j < a.length; j += 1) out[i + j] = add(out[i + j], mul(a[i], b[j]));
  return out;
}

function over(a: Series, b: Series): Series {
  if (isZero(b[0])) fail('gfDivide');
  const q: Series = [];
  for (let k = 0; k < a.length; k += 1) {
    let r = a[k];
    for (let j = 1; j <= k; j += 1) r = sub(r, mul(b[j], q[k - j]));
    q.push(div(r, b[0]));
  }
  return q;
}

/** The first `n` coefficients of the generating function typed in `text`. */
export function expandSeries(text: string, n: number): Frac[] {
  const src = text.replace(/\s+/g, '').replace(/·|×/g, '*').replace(/−/g, '-');
  if (!src) fail('gfEmpty');
  let at = 0;
  const peek = () => src[at];
  const expect = (c: string) => {
    if (src[at] !== c) fail('gfSyntax', { at: at + 1 });
    at += 1;
  };
  const atom = (): Series => {
    if (peek() === '(') {
      at += 1;
      const inner = sum();
      expect(')');
      return inner;
    }
    if (peek() === 'x' || peek() === 'X') {
      at += 1;
      return Array.from({ length: n }, (_, i) => (i === 1 ? ONE : ZERO));
    }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(at));
    if (!m) return fail('gfSyntax', { at: at + 1 });
    at += m[0].length;
    return constant(parseFrac(m[0])!, n);
  };
  const power = (): Series => {
    const base = atom();
    if (peek() !== '^') return base;
    at += 1;
    const m = /^\d+/.exec(src.slice(at));
    if (!m || Number(m[0]) > 1000) return fail('gfPower', { at: at + 1 });
    at += m[0].length;
    let out = constant(ONE, n);
    for (let k = 0; k < Number(m[0]); k += 1) out = times(out, base);
    return out;
  };
  const unary = (): Series => {
    if (peek() === '-') {
      at += 1;
      return unary().map(neg);
    }
    if (peek() === '+') at += 1;
    return power();
  };
  const product = (): Series => {
    let out = unary();
    for (;;) {
      const c = peek();
      if (c === '*') {
        at += 1;
        out = times(out, unary());
      } else if (c === '/') {
        at += 1;
        out = over(out, unary());
      } else if (c === '(' || c === 'x' || c === 'X' || (c !== undefined && /\d/.test(c))) {
        out = times(out, power());
      } else return out;
    }
  };
  const sum = (): Series => {
    let out = product();
    for (;;) {
      if (peek() === '+') {
        at += 1;
        const b = product();
        out = out.map((c, i) => add(c, b[i]));
      } else if (peek() === '-') {
        at += 1;
        const b = product();
        out = out.map((c, i) => sub(c, b[i]));
      } else return out;
    }
  };
  const out = sum();
  if (at < src.length) fail('gfSyntax', { at: at + 1 });
  return out;
}

export interface Inclusion {
  sets: string[];
  /** The sum of the sizes of the intersections of k sets, for k = 1 up to the number of sets. */
  levels: bigint[];
  union: bigint;
  /** The universe minus the union, when the universe is given. */
  neither: bigint | null;
}

/**
 * Inclusion-exclusion from lines such as "A 12" and "A B 5" (the intersection of A and B has 5). Every intersection
 * of the sets named must be given.
 */
export function inclusionExclusion(text: string, universe: bigint | null): Inclusion {
  const sizes = new Map<string, bigint>();
  const sets: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const words = line.split(/[\s,∩&]+/).filter(Boolean);
      const size = words.pop();
      if (!size || !/^\d+$/.test(size) || words.length === 0) fail('ieLine', { line: i + 1 });
      const key = [...new Set(words)].sort().join(' ');
      if (sizes.has(key)) fail('ieTwice', { sets: key });
      sizes.set(key, BigInt(size!));
      for (const w of words) if (!sets.includes(w)) sets.push(w);
    });
  if (sets.length === 0) fail('ieEmpty');
  if (sets.length > 8) fail('ieMany', { max: 8 });
  const sorted = [...sets].sort();
  const levels = sets.map(() => 0n);
  for (let mask = 1; mask < 1 << sorted.length; mask += 1) {
    const names = sorted.filter((_, i) => mask & (1 << i));
    const size = sizes.get(names.join(' '));
    if (size === undefined) fail('ieMissing', { sets: names.join(' ∩ ') });
    levels[names.length - 1] += size!;
  }
  const union = levels.reduce((s, x, k) => (k % 2 === 0 ? s + x : s - x), 0n);
  if (union < 0n || (universe !== null && union > universe)) fail('ieInconsistent');
  return { sets, levels, union, neither: universe === null ? null : universe - union };
}
