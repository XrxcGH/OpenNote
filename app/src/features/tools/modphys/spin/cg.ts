// Clebsch-Gordan coefficients by Racah's formula in exact arithmetic. Angular momenta are held doubled (2j), so half
// whole values are integers; the coefficient is a sign times the square root of a reduced fraction of BigInts.
import { fail } from '../shared/errors';

/** The largest j the tool couples; the factorials stay exact far beyond it. */
export const MAX_J2 = 40;

/** A typed angular momentum or projection such as 1/2, -3/2, 1, or 0.5, doubled. Throws 'badSpin' otherwise. */
export function parseHalf(raw: string): number {
  const text = raw.trim().replace(/[−–]/g, '-');
  const fraction = /^([+-]?)(\d+)\s*\/\s*2$/.exec(text);
  if (fraction) {
    const n = Number(fraction[2]);
    return fraction[1] === '-' ? -n : n;
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) fail('badSpin');
  const doubled = 2 * Number(text);
  if (!Number.isInteger(doubled)) fail('badSpin');
  return doubled;
}

/** A doubled value as text: 1, 3/2, −1/2. */
export function halfText(doubled: number): string {
  const sign = doubled < 0 ? '−' : '';
  const n = Math.abs(doubled);
  return n % 2 === 0 ? `${sign}${n / 2}` : `${sign}${n}/2`;
}

const FACT: bigint[] = [1n];
function fact(n: number): bigint {
  if (n < 0) throw new RangeError('negative factorial');
  for (let k = FACT.length; k <= n; k += 1) FACT.push(FACT[k - 1]! * BigInt(k));
  return FACT[n]!;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
};

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

export interface Coefficient {
  /** −1, 0, or 1. */
  sign: number;
  /** The coefficient squared, num / den, reduced. */
  num: bigint;
  den: bigint;
  value: number;
  /** Why the coefficient is zero, when a selection rule makes it so. */
  zero?: 'projection' | 'triangle';
  /** The terms of Racah's sum as fractions, for the worked steps. */
  terms: string[];
}

/** Checks one j and m, both doubled. */
function pair(j: number, m: number) {
  if (!Number.isInteger(j) || !Number.isInteger(m) || j < 0 || Math.abs(m) > j || (j - m) % 2 !== 0) fail('badSpin');
  if (j > MAX_J2) fail('badSpin');
}

/** ⟨j1 m1; j2 m2 | J M⟩, all arguments doubled. */
export function clebschGordan(j1: number, m1: number, j2: number, m2: number, J: number, M: number): Coefficient {
  pair(j1, m1);
  pair(j2, m2);
  pair(J, M);
  const none = (zero: 'projection' | 'triangle'): Coefficient => ({
    sign: 0,
    num: 0n,
    den: 1n,
    value: 0,
    zero,
    terms: [],
  });
  if (M !== m1 + m2) return none('projection');
  if (J < Math.abs(j1 - j2) || J > j1 + j2 || (j1 + j2 + J) % 2 !== 0) return none('triangle');
  const h = (x: number) => x / 2;
  // The prefactor under the square root, as a fraction.
  let rNum =
    BigInt(J + 1) *
    fact(h(J + j1 - j2)) *
    fact(h(J - j1 + j2)) *
    fact(h(j1 + j2 - J)) *
    fact(h(J + M)) *
    fact(h(J - M)) *
    fact(h(j1 - m1)) *
    fact(h(j1 + m1)) *
    fact(h(j2 - m2)) *
    fact(h(j2 + m2));
  let rDen = fact(h(j1 + j2 + J) + 1);
  // Racah's sum over every k that keeps the factorials non-negative.
  const a = [h(j1 + j2 - J), h(j1 - m1), h(j2 + m2)];
  const b = [h(J - j2 + m1), h(J - j1 - m2)];
  const kMin = Math.max(0, -b[0]!, -b[1]!);
  const kMax = Math.min(...a);
  let sNum = 0n;
  let sDen = 1n;
  const terms: string[] = [];
  for (let k = kMin; k <= kMax; k += 1) {
    const d = fact(k) * fact(a[0]! - k) * fact(a[1]! - k) * fact(a[2]! - k) * fact(b[0]! + k) * fact(b[1]! + k);
    const sign = k % 2 === 0 ? 1n : -1n;
    terms.push(`${sign < 0n ? '−' : '+'}1/${d}`);
    sNum = sNum * d + sign * sDen;
    sDen *= d;
    const g = gcd(sNum, sDen);
    if (g > 1n) {
      sNum /= g;
      sDen /= g;
    }
  }
  if (sNum === 0n) return { sign: 0, num: 0n, den: 1n, value: 0, terms };
  rNum *= sNum * sNum;
  rDen *= sDen * sDen;
  const g = gcd(rNum, rDen);
  rNum /= g;
  rDen /= g;
  const sign = sNum < 0n ? -1 : 1;
  return { sign, num: rNum, den: rDen, value: sign * Math.sqrt(Number(rNum) / Number(rDen)), terms };
}

/** The exact form: 0, ±a/b, ±a/√q, or ±√(p/q). */
export function exactText(c: Coefficient): string {
  if (c.sign === 0) return '0';
  const sign = c.sign < 0 ? '−' : '';
  const p = isqrt(c.num);
  const q = isqrt(c.den);
  const pSquare = p * p === c.num;
  const qSquare = q * q === c.den;
  if (pSquare && qSquare) return q === 1n ? `${sign}${p}` : `${sign}${p}/${q}`;
  if (pSquare) return `${sign}${p}/√${c.den}`;
  if (qSquare) return `${sign}√${c.num}/${q}`;
  return `${sign}√(${c.num}/${c.den})`;
}

/** The Wigner 3j symbol (j1 j2 J; m1 m2 −M) = (−1)^(j1 − j2 + M) ⟨j1 m1; j2 m2 | J M⟩ / √(2J + 1). */
export function threeJ(j1: number, m1: number, j2: number, m2: number, J: number, M: number): number {
  const c = clebschGordan(j1, m1, j2, m2, J, M);
  const phase = ((j1 - j2 + M) / 2) % 2 === 0 ? 1 : -1;
  return (phase * c.value) / Math.sqrt(J + 1);
}

export interface TableEntry {
  m1: number;
  m2: number;
  J: number;
  M: number;
  c: Coefficient;
}

/** Every non-zero coefficient of j1 × j2, ordered by J then M from the top down. */
export function couplingTable(j1: number, j2: number): TableEntry[] {
  if (j1 > 8 || j2 > 8) fail('tableTooLarge');
  const out: TableEntry[] = [];
  for (let J = j1 + j2; J >= Math.abs(j1 - j2); J -= 2)
    for (let M = J; M >= -J; M -= 2)
      for (let m1 = j1; m1 >= -j1; m1 -= 2) {
        const m2 = M - m1;
        if (Math.abs(m2) > j2 || (j2 - m2) % 2 !== 0) continue;
        const c = clebschGordan(j1, m1, j2, m2, J, M);
        if (c.sign !== 0) out.push({ m1, m2, J, M, c });
      }
  return out;
}
