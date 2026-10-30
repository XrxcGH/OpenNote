// Exact matrices of fractions for the Markov chain tool: typed decimals such as 0.9 are exactly 9/10, so a
// stationary distribution comes out as 5/6 and not 0.8333333333. Built on core/expr's big-integer fractions.

import { fractions, type Rational } from '../../../../core/expr';

export type Q = Rational;
export type QMat = Q[][];

export const q0: Q = fractions.ZERO_RATIONAL;
export const q1: Q = fractions.ONE_RATIONAL;
export const qAdd = fractions.add;
export const qSub = fractions.sub;
export const qMul = fractions.mul;
export const qDiv = fractions.div;
export const qNeg = fractions.neg;
export const qSign = fractions.sign;
export const qNum = fractions.toNumber;
export const qInt = (k: number): Q => fractions.rational(BigInt(k));
export const qIsZero = (a: Q): boolean => a.n === 0n;
export const qEq = (a: Q, b: Q): boolean => fractions.compare(a, b) === 0;
export const qText = (a: Q): string => fractions.formatFraction(a).replace(/^-/, '−');
export const qTex = (a: Q): string =>
  a.d === 1n ? String(a.n) : `${a.n < 0n ? '-' : ''}\\frac{${a.n < 0n ? -a.n : a.n}}{${a.d}}`;

/** Reads "0.9", "-2", "1/3", "2.5e-1" or "1/2.5" exactly; null for anything else. */
export function readQ(text: string): Q | null {
  const t = text.trim().replace(/−/g, '-');
  if (!t) return null;
  const parts = t.split('/');
  if (parts.length > 2) return null;
  try {
    const a = fractions.fromDecimalText(parts[0]);
    if (!a) return null;
    if (parts.length === 1) return a;
    const b = fractions.fromDecimalText(parts[1]);
    if (!b || b.n === 0n) return null;
    return fractions.div(a, b);
  } catch {
    return null;
  }
}

export const qIdentity = (n: number): QMat =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? q1 : q0)));

export function qMatMul(a: QMat, b: QMat): QMat {
  return a.map((row) =>
    b[0].map((_, j) => row.reduce((sum, x, k) => (qIsZero(x) ? sum : qAdd(sum, qMul(x, b[k][j]))), q0)),
  );
}

export const qMatSub = (a: QMat, b: QMat): QMat => a.map((row, i) => row.map((x, j) => qSub(x, b[i][j])));
export const qTranspose = (a: QMat): QMat => a[0].map((_, j) => a.map((row) => row[j]));
export const qToNumbers = (a: QMat): number[][] => a.map((row) => row.map(qNum));

/** Solves A X = B exactly by Gauss–Jordan elimination. Returns null when A is singular. */
export function qSolve(a: QMat, b: QMat): QMat | null {
  const n = a.length;
  const m = b[0]?.length ?? 0;
  const aug = a.map((row, i) => [...row, ...b[i]]);
  for (let c = 0; c < n; c += 1) {
    const p = aug.findIndex((row, r) => r >= c && !qIsZero(row[c]));
    if (p < 0) return null;
    [aug[c], aug[p]] = [aug[p], aug[c]];
    const pivot = aug[c][c];
    aug[c] = aug[c].map((x) => qDiv(x, pivot));
    for (let r = 0; r < n; r += 1) {
      if (r === c || qIsZero(aug[r][c])) continue;
      const f = aug[r][c];
      aug[r] = aug[r].map((x, k) => qSub(x, qMul(f, aug[c][k])));
    }
  }
  return aug.map((row) => row.slice(n, n + m));
}

/** A^k by repeated squaring. */
export function qMatPow(a: QMat, k: number): QMat {
  let result = qIdentity(a.length);
  let base = a;
  let e = k;
  while (e > 0) {
    if (e % 2 === 1) result = qMatMul(result, base);
    e = Math.floor(e / 2);
    if (e > 0) base = qMatMul(base, base);
  }
  return result;
}
