// Interpolation: the polynomial through the points in Lagrange or Newton form, and natural or clamped cubic splines.
import { solveDense } from '../dense';
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { line, numbers, polyLatex, type NumLine, type NumOut, type NumTable } from './common';

export type InterpMethod = 'lagrange' | 'newton' | 'natural' | 'clamped';

export interface Points {
  x: number[];
  y: number[];
}

/** Points, one per line as "x, y", sorted by x. */
export function readPoints(text: string): Points {
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => numbers(l, 'points'));
  if (rows.length < 2 || rows.some((r) => r.length !== 2)) throw new KitError('badPoints');
  rows.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < rows.length; i++) if (rows[i][0] === rows[i - 1][0]) throw new KitError('dupX', fmt(rows[i][0]));
  return { x: rows.map((r) => r[0]), y: rows.map((r) => r[1]) };
}

/** Divided differences: column 0 is the data, column j holds the differences of order j. */
export function dividedDifferences(p: Points): number[][] {
  const n = p.x.length;
  const table: number[][] = [p.y.slice()];
  for (let j = 1; j < n; j++) {
    const prev = table[j - 1];
    table.push(Array.from({ length: n - j }, (_, i) => (prev[i + 1] - prev[i]) / (p.x[i + j] - p.x[i])));
  }
  return table;
}

/** The polynomial in powers of x (ascending) from the Newton form. */
export function newtonCoefficients(p: Points): number[] {
  const dd = dividedDifferences(p);
  let poly = [dd[p.x.length - 1][0]];
  for (let k = p.x.length - 2; k >= 0; k--) {
    // poly = poly * (x - x_k) + dd[k][0]
    const next = new Array<number>(poly.length + 1).fill(0);
    poly.forEach((a, i) => {
      next[i + 1] += a;
      next[i] -= a * p.x[k];
    });
    next[0] += dd[k][0];
    poly = next;
  }
  return poly;
}

export const lagrangeBasis = (p: Points, at: number): number[] =>
  p.x.map((xi, i) => p.x.reduce((prod, xj, j) => (j === i ? prod : (prod * (at - xj)) / (xi - xj)), 1));

export interface SplinePiece {
  x0: number;
  x1: number;
  /** a + b t + c t^2 + d t^3 with t = x - x0 */
  coefficients: [number, number, number, number];
}

/** A cubic spline through the points: natural (no bending at the ends) or clamped (given end slopes). */
export function splinePieces(p: Points, kind: 'natural' | 'clamped', slope0 = 0, slopeN = 0): SplinePiece[] {
  const n = p.x.length;
  const h = Array.from({ length: n - 1 }, (_, i) => p.x[i + 1] - p.x[i]);
  const delta = Array.from({ length: n - 1 }, (_, i) => (p.y[i + 1] - p.y[i]) / h[i]);
  // The unknowns are the second derivatives M_0 .. M_n-1 at the points.
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const r = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    A[i][i - 1] = h[i - 1];
    A[i][i] = 2 * (h[i - 1] + h[i]);
    A[i][i + 1] = h[i];
    r[i] = 6 * (delta[i] - delta[i - 1]);
  }
  if (kind === 'natural') {
    A[0][0] = 1;
    A[n - 1][n - 1] = 1;
  } else {
    A[0][0] = 2 * h[0];
    A[0][1] = h[0];
    r[0] = 6 * (delta[0] - slope0);
    A[n - 1][n - 2] = h[n - 2];
    A[n - 1][n - 1] = 2 * h[n - 2];
    r[n - 1] = 6 * (slopeN - delta[n - 2]);
  }
  const M = solveDense(A, r);
  if (!M) throw new KitError('singular');
  return Array.from({ length: n - 1 }, (_, i) => ({
    x0: p.x[i],
    x1: p.x[i + 1],
    coefficients: [p.y[i], delta[i] - (h[i] * (2 * M[i] + M[i + 1])) / 6, M[i] / 2, (M[i + 1] - M[i]) / (6 * h[i])],
  }));
}

export function evalSpline(pieces: readonly SplinePiece[], x: number): number {
  let piece = pieces[pieces.length - 1];
  for (const candidate of pieces) {
    if (x <= candidate.x1) {
      piece = candidate;
      break;
    }
  }
  const t = x - piece.x0;
  const [a, b, c, d] = piece.coefficients;
  return a + t * (b + t * (c + t * d));
}

export interface InterpResult extends NumOut {
  value: number;
  evaluate: (x: number) => number;
}

export function interpolate(source: string, method: InterpMethod, at: number, slope0 = 0, slopeN = 0): InterpResult {
  const p = readPoints(source);
  const n = p.x.length;
  const lo = p.x[0];
  const hi = p.x[n - 1];
  const steps: KitStep[] = [];
  const tables: NumTable[] = [];
  const lines: NumLine[] = [];
  let evaluate: (x: number) => number;
  let latex: string | undefined;
  let value: number;
  if (method === 'lagrange' || method === 'newton') {
    const poly = newtonCoefficients(p);
    evaluate = (x) => poly.reduceRight((s, a) => s * x + a, 0);
    latex = `p(x)=${polyLatex(poly)}`;
    value = evaluate(at);
    if (method === 'lagrange') {
      const basis = lagrangeBasis(p, at);
      value = basis.reduce((s, b, i) => s + b * p.y[i], 0);
      steps.push(
        step('numMethod', 'p(x)=\\sum_{i} y_i L_i(x),\\quad L_i(x)=\\prod_{j\\ne i}\\frac{x-x_j}{x_i-x_j}', {
          $method: 'kitMath.numerics.method.lagrange',
        }),
        step('numValue', `p(${fmt(at)})=${fmt(value, 10)}`),
      );
      tables.push({
        title: 'basis',
        columns: ['i', 'xi', 'yi', 'basis', 'term'],
        rows: p.x.map((x, i) => [String(i), fmt(x), fmt(p.y[i]), fmt(basis[i], 8), fmt(basis[i] * p.y[i], 8)]),
      });
    } else {
      const dd = dividedDifferences(p);
      steps.push(
        step('numMethod', 'p(x)=f[x_0]+f[x_0,x_1](x-x_0)+f[x_0,x_1,x_2](x-x_0)(x-x_1)+\\cdots', {
          $method: 'kitMath.numerics.method.newton',
        }),
        step('numValue', `p(${fmt(at)})=${fmt(value, 10)}`),
      );
      tables.push({
        title: 'differences',
        columns: ['xi', 'f0', ...dd.slice(1).map((_, j) => `~f[${j + 1}]`)],
        rows: p.x.map((x, i) => [fmt(x), ...dd.map((col) => (i < col.length ? fmt(col[i], 8) : ''))]),
      });
    }
    steps.push(step('numMethod', latex, { $method: 'kitMath.numerics.method.expanded' }));
    lines.push(line('interpValue', { x: fmt(at), value: fmt(value, 10) }));
    if (n >= 10) lines.push(line('rungeWarning'));
  } else {
    const pieces = splinePieces(p, method === 'natural' ? 'natural' : 'clamped', slope0, slopeN);
    evaluate = (x) => evalSpline(pieces, x);
    if (at < lo || at > hi) throw new KitError('outOfRange', `${fmt(lo)} to ${fmt(hi)}`);
    value = evaluate(at);
    steps.push(
      step('numMethod', 'S_i(x)=a_i+b_i t+c_i t^2+d_i t^3,\\quad t=x-x_i', {
        $method: `kitMath.numerics.method.${method}`,
      }),
      method === 'natural'
        ? step('splineNatural', 'S^{\\prime\\prime}(x_0)=S^{\\prime\\prime}(x_n)=0')
        : step('splineClamped', `S^{\\prime}(x_0)=${fmt(slope0)},\\ S^{\\prime}(x_n)=${fmt(slopeN)}`),
      step('numValue', `S(${fmt(at)})=${fmt(value, 10)}`),
    );
    tables.push({
      title: 'pieces',
      columns: ['from', 'to', '~a', '~b', '~c', '~d'],
      rows: pieces.map((q) => [fmt(q.x0), fmt(q.x1), ...q.coefficients.map((v) => fmt(v, 8))]),
    });
    lines.push(line('interpValue', { x: fmt(at), value: fmt(value, 10) }));
  }
  const from = Math.min(lo, at);
  const to = Math.max(hi, at);
  const curve: [number, number][] = Array.from({ length: 161 }, (_, k) => {
    const x = from + ((to - from) * k) / 160;
    return [x, evaluate(x)];
  });
  return {
    lines,
    tables,
    plots: [
      {
        label: 'interp',
        series: [
          { points: curve },
          { points: p.x.map((x, i): [number, number] => [x, p.y[i]]), dots: true, tone: 1 },
          { points: [[at, value]], dots: true, tone: 3 },
        ],
      },
    ],
    fields: [],
    steps,
    ...(latex ? { latex } : {}),
    value,
    evaluate,
  };
}
