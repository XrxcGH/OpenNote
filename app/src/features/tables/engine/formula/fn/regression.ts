// Least-squares regression: LINEST, LOGEST, TREND, and GROWTH. Owner: tables:fn-stats. Lazy chunk only.
// Written from the documented behavior. LINEST gives the coefficients last variable first, then the intercept. With
// stats it adds four rows: the standard errors; R squared and the standard error of y; F and the degrees of freedom;
// and the regression and residual sums of squares. Cells those rows leave empty hold #N/A. A variable that is a
// combination of the others gets the coefficient 0 and is left out of the degrees of freedom.
//
// The fit centers the data when there is an intercept and uses Gram-Schmidt with a second orthogonalization pass,
// which keeps 12 or more digits on NIST's harder linear datasets where the normal equations would not.

import { asArray } from '../../arrays';
import { err, isError, toNumber, type ArrayValue, type FormulaError, type Scalar, type Value } from '../../values';
import { failed, type Run } from './statsKit';

export interface Fit {
  /** One coefficient per column of x, in column order; 0 for a column left out. */
  readonly coef: number[];
  readonly intercept: number;
  /** Standard errors in the same order; 0 for a column left out. NaN when there are no degrees of freedom. */
  readonly se: number[];
  readonly seIntercept: number;
  readonly r2: number;
  readonly sey: number;
  readonly f: number;
  readonly df: number;
  readonly ssreg: number;
  readonly ssresid: number;
}

const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Upper-triangular solve and inverse helpers over the kept columns. */
function invertUpper(r: number[][]): number[][] {
  const k = r.length;
  const inv = r.map(() => new Array<number>(k).fill(0));
  for (let j = 0; j < k; j++) {
    inv[j][j] = 1 / r[j][j];
    for (let i = j - 1; i >= 0; i--) {
      let s = 0;
      for (let m = i + 1; m <= j; m++) s += r[i][m] * inv[m][j];
      inv[i][j] = -s / r[i][i];
    }
  }
  return inv;
}

/** Orthogonalizes the columns. Returns the kept column indices, Q's columns, and R over the kept columns. */
function gramSchmidt(cols: number[][]): { kept: number[]; q: number[][]; r: number[][] } {
  const kept: number[] = [];
  const q: number[][] = [];
  const r: number[][] = [];
  cols.forEach((col, j) => {
    const v = [...col];
    const coeffs = new Array<number>(q.length).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      q.forEach((qi, i) => {
        const c = dot(qi, v);
        coeffs[i] += c;
        for (let t = 0; t < v.length; t++) v[t] -= c * qi[t];
      });
    }
    const norm = Math.sqrt(dot(v, v));
    const size = Math.sqrt(dot(col, col));
    if (norm === 0 || norm <= 1e-13 * size) return;
    kept.push(j);
    q.push(v.map((x) => x / norm));
    r.forEach((row, i) => row.push(coeffs[i]));
    r.push([...new Array<number>(q.length - 1).fill(0), norm]);
  });
  return { kept, q, r };
}

/** Least squares of y on the columns of x, with or without an intercept. */
export function leastSquares(cols: readonly number[][], y: readonly number[], intercept: boolean): Fit {
  const n = y.length;
  const k = cols.length;
  const means = cols.map((c) => (intercept ? c.reduce((a, b) => a + b, 0) / n : 0));
  const my = intercept ? y.reduce((a, b) => a + b, 0) / n : 0;
  const centered = cols.map((c, j) => c.map((x) => x - means[j]));
  const yc = y.map((v) => v - my);
  const { kept, q, r } = gramSchmidt(centered);
  const qty = q.map((qi) => dot(qi, yc));
  const rinv = invertUpper(r);
  const b = rinv.map((row) => dot(row, qty));
  const coef = new Array<number>(k).fill(0);
  kept.forEach((j, i) => (coef[j] = b[i]));
  const b0 = intercept ? my - dot(coef, means) : 0;
  const fitted = y.map((_, t) => b0 + cols.reduce((s, c, j) => s + coef[j] * c[t], 0));
  const ssresid = y.reduce((s, v, t) => s + (v - fitted[t]) ** 2, 0);
  const ssreg = fitted.reduce((s, v) => s + (v - my) ** 2, 0);
  const df = n - kept.length - (intercept ? 1 : 0);
  const s2 = df > 0 ? ssresid / df : NaN;
  const se = new Array<number>(k).fill(0);
  kept.forEach((j, i) => (se[j] = Math.sqrt(s2 * dot(rinv[i], rinv[i]))));
  // Var(b0) = s2 (1/n + m' (Xc'Xc)^-1 m), where (Xc'Xc)^-1 is the inverse of R times its transpose.
  const keptMeans = kept.map((j) => means[j]);
  const w = rinv.map((_, m) => rinv.reduce((s, row, i) => s + row[m] * keptMeans[i], 0));
  const seIntercept = intercept ? Math.sqrt(s2 * (1 / n + dot(w, w))) : NaN;
  const total = ssreg + ssresid;
  return {
    coef,
    intercept: b0,
    se,
    seIntercept,
    r2: total === 0 ? 1 : ssreg / total,
    sey: Math.sqrt(s2),
    f: df > 0 && kept.length > 0 ? ssreg / kept.length / s2 : NaN,
    df,
    ssreg,
    ssresid,
  };
}

/** Reads a block whose items must all be numbers. */
function block(value: Value): ArrayValue | FormulaError {
  if (isError(value)) return value;
  const a = asArray(value);
  for (const v of a.data) {
    if (isError(v)) return v;
    if (typeof v !== 'number') return err('VALUE');
  }
  return a;
}

const omitted = (v: Value | undefined): boolean => v === undefined || v === null;

interface Problem {
  readonly cols: number[][];
  readonly y: number[];
  /** True when y is a row, so each row of x is one variable. */
  readonly byRow: boolean;
}

/** The variables of x as columns of numbers, matched to y as the documented rules say. */
function problemOf(yv: Value, xv: Value | undefined, transformY?: (y: number) => number): Problem | FormulaError {
  const ya = block(yv);
  if (isError(ya)) return ya;
  const n = ya.data.length;
  let y = ya.data as number[];
  if (transformY !== undefined) {
    if (y.some((v) => v <= 0)) return err('NUM');
    y = y.map(transformY);
  }
  const byRow = ya.rows === 1 && ya.cols > 1;
  if (omitted(xv)) return { cols: [y.map((_, i) => i + 1)], y, byRow };
  const xa = block(xv as Value);
  if (isError(xa)) return xa;
  if (xa.rows === ya.rows && xa.cols === ya.cols) return { cols: [xa.data as number[]], y, byRow };
  if (ya.cols === 1 && xa.rows === n) {
    return {
      cols: Array.from({ length: xa.cols }, (_, j) => y.map((_, i) => xa.data[i * xa.cols + j] as number)),
      y,
      byRow,
    };
  }
  if (byRow && xa.cols === n) {
    return { cols: Array.from({ length: xa.rows }, (_, j) => xa.data.slice(j * n, j * n + n) as number[]), y, byRow };
  }
  return err('REF');
}

const flagOf = (v: Value | undefined, fallback: boolean): boolean | FormulaError => {
  if (omitted(v)) return fallback;
  const n = toNumber(v as Value);
  return typeof n === 'number' ? n !== 0 : n;
};

const cell = (x: number): Scalar => (Number.isFinite(x) ? x : err('NUM'));

/** The LINEST table, or LOGEST's when `log` is set (coefficients raised to e, from a fit of ln y). */
function estimate(log: boolean): Run {
  return ([yv, xv, constV, statsV]) => {
    const p = problemOf(yv, xv, log ? Math.log : undefined);
    if (failed(p)) return p;
    const withConst = flagOf(constV, true);
    const stats = flagOf(statsV, false);
    if (isError(withConst)) return withConst;
    if (isError(stats)) return stats;
    const fit = leastSquares(p.cols, p.y, withConst);
    const out = (x: number) => cell(log ? Math.exp(x) : x);
    const width = p.cols.length + 1;
    const first = [...[...fit.coef].reverse().map(out), out(fit.intercept)];
    if (!stats) return { kind: 'array', rows: 1, cols: width, data: first };
    const na = err('NA');
    const pad = (cells: Scalar[]) => [...cells, ...new Array<Scalar>(width - cells.length).fill(na)];
    const seB = withConst ? cell(fit.seIntercept) : na;
    const rows: Scalar[][] = [
      first,
      [...[...fit.se].reverse().map(cell), seB],
      pad([cell(fit.r2), cell(fit.sey)]),
      pad([cell(fit.f), fit.df]),
      pad([cell(fit.ssreg), cell(fit.ssresid)]),
    ];
    return { kind: 'array', rows: 5, cols: width, data: rows.flat() };
  };
}

/** TREND, or GROWTH when `log` is set: the fitted values at new x. */
function predict(log: boolean): Run {
  return ([yv, xv, newV, constV]) => {
    const p = problemOf(yv, xv, log ? Math.log : undefined);
    if (failed(p)) return p;
    const withConst = flagOf(constV, true);
    if (isError(withConst)) return withConst;
    const fit = leastSquares(p.cols, p.y, withConst);
    const k = p.cols.length;
    let points: number[][];
    let shape: { rows: number; cols: number };
    if (omitted(newV)) {
      points = p.y.map((_, i) => p.cols.map((c) => c[i]));
      const ya = asArray(yv);
      shape = { rows: ya.rows, cols: ya.cols };
    } else {
      const na = block(newV as Value);
      if (isError(na)) return na;
      if (k === 1) {
        points = (na.data as number[]).map((x) => [x]);
        shape = { rows: na.rows, cols: na.cols };
      } else if (!p.byRow && na.cols === k) {
        points = Array.from({ length: na.rows }, (_, i) => na.data.slice(i * k, i * k + k) as number[]);
        shape = { rows: na.rows, cols: 1 };
      } else if (p.byRow && na.rows === k) {
        points = Array.from({ length: na.cols }, (_, i) => p.cols.map((_, j) => na.data[j * na.cols + i] as number));
        shape = { rows: 1, cols: na.cols };
      } else {
        return err('REF');
      }
    }
    const data = points.map((pt) => {
      const v = fit.intercept + pt.reduce((s, x, j) => s + fit.coef[j] * x, 0);
      return cell(log ? Math.exp(v) : v);
    });
    return { kind: 'array', ...shape, data };
  };
}

export const runs: Readonly<Record<string, Run>> = {
  LINEST: estimate(false),
  LOGEST: estimate(true),
  TREND: predict(false),
  GROWTH: predict(true),
};
