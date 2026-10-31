// Counting in exact BigInt: arrangements and selections with and without repetition, multinomials, Stirling numbers
// of both kinds, Bell, Catalan, partitions, and derangements. Linear recurrences with constant coefficients get
// their first terms and, when the characteristic roots are rational, an exact closed form. The master theorem
// names the case of a divide-and-conquer recurrence.
import { ONE, ZERO, add, cmp, frac, fracText, isZero, mul, neg, sign } from '../core/frac';
import type { Frac } from '../core/frac';
import { solveExact } from '../core/linsolve';
import { fail } from '../core/util';

const LIMIT = 2000;
const check = (n: number, k = 0) => {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) fail('countWhole');
  if (n > LIMIT || k > LIMIT) fail('countBig', { limit: LIMIT });
};

export function factorial(n: number): bigint {
  check(n);
  let f = 1n;
  for (let i = 2n; i <= BigInt(n); i += 1n) f *= i;
  return f;
}

/** n! / (n - k)!: arrangements of k from n. */
export function permutations(n: number, k: number): bigint {
  check(n, k);
  if (k > n) return 0n;
  let f = 1n;
  for (let i = 0; i < k; i += 1) f *= BigInt(n - i);
  return f;
}

export function choose(n: number, k: number): bigint {
  check(n, k);
  if (k > n) return 0n;
  const m = Math.min(k, n - k);
  let c = 1n;
  for (let i = 1; i <= m; i += 1) c = (c * BigInt(n - m + i)) / BigInt(i);
  return c;
}

export const multichoose = (n: number, k: number): bigint => (n === 0 ? (k === 0 ? 1n : 0n) : choose(n + k - 1, k));

export function multinomial(parts: number[]): bigint {
  parts.forEach((p) => check(p));
  const n = parts.reduce((a, b) => a + b, 0);
  check(n);
  return parts.reduce((acc, p) => acc / factorial(p), factorial(n));
}

/** Stirling numbers of the second kind S(n, k): partitions of n things into k nonempty blocks. */
export function stirling2(n: number, k: number): bigint {
  check(n, k);
  if (n > 400) fail('countBig', { limit: 400 });
  let row = [1n];
  for (let i = 1; i <= n; i += 1) {
    const next = Array<bigint>(i + 1).fill(0n);
    for (let j = 1; j <= i; j += 1) next[j] = BigInt(j) * (row[j] ?? 0n) + (row[j - 1] ?? 0n);
    row = next;
  }
  return row[k] ?? 0n;
}

/** Unsigned Stirling numbers of the first kind c(n, k): permutations of n with k cycles. */
export function stirling1(n: number, k: number): bigint {
  check(n, k);
  if (n > 400) fail('countBig', { limit: 400 });
  let row = [1n];
  for (let i = 1; i <= n; i += 1) {
    const next = Array<bigint>(i + 1).fill(0n);
    for (let j = 1; j <= i; j += 1) next[j] = BigInt(i - 1) * (row[j] ?? 0n) + (row[j - 1] ?? 0n);
    row = next;
  }
  return row[k] ?? 0n;
}

/** Bell numbers by the Bell triangle. */
export function bell(n: number): bigint {
  check(n);
  if (n > 400) fail('countBig', { limit: 400 });
  let row = [1n];
  for (let i = 0; i < n; i += 1) {
    const next = [row[row.length - 1]];
    for (const v of row) next.push(next[next.length - 1] + v);
    row = next;
  }
  return row[0];
}

export const catalan = (n: number): bigint => choose(2 * n, n) / BigInt(n + 1);

/** The number of partitions of n into positive parts, by Euler's pentagonal recurrence. */
export function partitions(n: number): bigint {
  check(n);
  const p = [1n];
  for (let m = 1; m <= n; m += 1) {
    let total = 0n;
    for (let k = 1; ; k += 1) {
      const g1 = (k * (3 * k - 1)) / 2;
      if (g1 > m) break;
      const sign = k % 2 ? 1n : -1n;
      total += sign * p[m - g1];
      const g2 = (k * (3 * k + 1)) / 2;
      if (g2 <= m) total += sign * p[m - g2];
    }
    p.push(total);
  }
  return p[n];
}

/** Derangements: permutations with no fixed point, by D(n) = (n - 1)(D(n - 1) + D(n - 2)). */
export function derangements(n: number): bigint {
  check(n);
  let [a, b] = [1n, 0n];
  if (n === 0) return 1n;
  for (let i = 2; i <= n; i += 1) [a, b] = [b, BigInt(i - 1) * (a + b)];
  return b;
}

export interface Recurrence {
  terms: bigint[];
  /** Rational characteristic roots with their multiplicities, when all roots are rational. */
  roots: { r: Frac; m: number }[] | null;
  /** The closed form a_n = sum of c * n^j * r^n, as coefficient, power of n, and root. */
  closed: { c: Frac; j: number; r: Frac }[] | null;
}

const divisors = (n: bigint): bigint[] => {
  const a = n < 0n ? -n : n;
  const out: bigint[] = [];
  for (let d = 1n; d * d <= a && d < 100000n; d += 1n)
    if (a % d === 0n) {
      out.push(d);
      if (d * d !== a) out.push(a / d);
    }
  return out;
};

/** a_n = c_1 a_{n-1} + ... + c_k a_{n-k}, with whole coefficients and starting values. */
export function recurrence(coefs: number[], start: number[], count: number): Recurrence {
  if (coefs.length === 0 || coefs.length > 6) fail('recOrder', { max: 6 });
  if (start.length !== coefs.length) fail('recStart', { k: coefs.length });
  if ([...coefs, ...start].some((v) => !Number.isSafeInteger(v))) fail('recWhole');
  const n = Math.min(Math.max(count, coefs.length), 200);
  const c = coefs.map(BigInt);
  const terms = start.map(BigInt);
  while (terms.length < n) {
    const i = terms.length;
    terms.push(c.reduce((s, ci, j) => s + ci * terms[i - 1 - j], 0n));
  }
  // Characteristic polynomial x^k - c1 x^(k-1) - ... - ck, as coefficients from the highest power.
  let poly = [1n, ...c.map((v) => -v)];
  while (poly.length > 1 && poly[poly.length - 1] === 0n) poly = poly.slice(0, -1);
  const zeroRoots = coefs.length + 1 - poly.length;
  const roots: { r: Frac; m: number }[] = [];
  let rest = poly.map((v) => frac(v));
  const evalAt = (p: Frac[], r: Frac) => p.reduce((acc, v) => add(mul(acc, r), v), ZERO);
  const divide = (p: Frac[], r: Frac) => {
    const out: Frac[] = [];
    let acc = ZERO;
    for (const v of p.slice(0, -1)) {
      acc = add(mul(acc, r), v);
      out.push(acc);
    }
    return out;
  };
  const last = poly[poly.length - 1];
  const candidates = last === 0n ? [] : divisors(last).flatMap((d) => [frac(d), frac(-d)]);
  for (const r of candidates) {
    let m = 0;
    while (rest.length > 1 && isZero(evalAt(rest, r))) {
      rest = divide(rest, r);
      m += 1;
    }
    if (m) roots.push({ r, m });
  }
  if (rest.length > 1 || zeroRoots > 0) return { terms, roots: null, closed: null };
  roots.sort((a, b) => cmp(b.r, a.r));
  // Solve for the coefficient of each n^j r^n from the starting values.
  const basis = roots.flatMap(({ r, m }) => Array.from({ length: m }, (_, j) => ({ j, r })));
  const pow = (x: Frac, e: number) => Array.from({ length: e }, () => x).reduce(mul, ONE);
  const A = start.map((_, i) => basis.map(({ j, r }) => mul(frac(i ** j), pow(r, i))));
  const sol = solveExact(
    A,
    start.map((v) => frac(v)),
  );
  if (!sol) return { terms, roots, closed: null };
  return { terms, roots, closed: basis.map((b, k) => ({ ...b, c: sol[k] })) };
}

export const closedText = (closed: { c: Frac; j: number; r: Frac }[]): string =>
  closed
    .filter((t) => !isZero(t.c))
    .map((t, k) => {
      const size = sign(t.c) < 0 ? neg(t.c) : t.c;
      const lead = k === 0 ? (sign(t.c) < 0 ? '−' : '') : sign(t.c) < 0 ? ' − ' : ' + ';
      const power = t.j ? ` n${t.j > 1 ? `^${t.j}` : ''}` : '';
      return `${lead}${fracText(size)}${power} (${fracText(t.r)})^n`;
    })
    .join('') || '0';

export type MasterCase = 1 | 2 | 3;

/** T(n) = a T(n / b) + Theta(n^k log^p n): the master theorem's case and the growth of T. */
export function master(a: number, b: number, k: number, p: number): { crit: number; case: MasterCase } {
  if (!(a >= 1) || !(b > 1)) fail('masterAB');
  if (k < 0 || p < 0) fail('masterF');
  const crit = Math.log(a) / Math.log(b);
  if (Math.abs(k - crit) < 1e-12) return { crit, case: 2 };
  return { crit, case: k < crit ? 1 : 3 };
}
