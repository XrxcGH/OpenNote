// Small dense-matrix routines for the Matrix tool: determinant, inverse, transpose, product, row reduction with
// its steps, rank, real eigenvalues, and linear systems. Pure: arrays of rows of numbers.

export type Matrix = number[][];

const TINY = 1e-12;
const clean = (value: number) => (Math.abs(value) < TINY ? 0 : Number(value.toPrecision(12)));
const copy = (m: Matrix): Matrix => m.map((row) => [...row]);

export const isSquare = (m: Matrix) => m.length > 0 && m.every((row) => row.length === m.length);

/** The tolerance that tells a pivot from rounding noise: relative to the largest entry. */
function toleranceOf(m: Matrix): number {
  const largest = Math.max(0, ...m.flat().map(Math.abs));
  return Math.max(largest, 1) * 1e-10;
}

export function transpose(m: Matrix): Matrix {
  return m[0].map((_, c) => m.map((row) => row[c]));
}

/** a times b, or null when a's columns are not b's rows. */
export function multiply(a: Matrix, b: Matrix): Matrix | null {
  if (a[0].length !== b.length) return null;
  return a.map((row) => b[0].map((_, c) => clean(row.reduce((total, value, k) => total + value * b[k][c], 0))));
}

/** The determinant of a square matrix, by elimination with partial pivoting. */
export function determinant(m: Matrix): number {
  const a = copy(m);
  const n = a.length;
  let det = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (a[pivot][col] === 0) return 0;
    if (pivot !== col) {
      [a[pivot], a[col]] = [a[col], a[pivot]];
      det = -det;
    }
    det *= a[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c < n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return clean(det);
}

/** Solves the n by n+1 augmented system. Null when the matrix part is singular. */
export function solveLinear(augmented: Matrix): number[] | null {
  const a = copy(augmented);
  const n = a.length;
  const tolerance = toleranceOf(a.map((row) => row.slice(0, n)));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) <= tolerance) return null;
    [a[pivot], a[col]] = [a[col], a[pivot]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** The inverse of a square matrix, or null when it has none. */
export function inverse(m: Matrix): Matrix | null {
  const n = m.length;
  const columns: number[][] = [];
  for (let c = 0; c < n; c++) {
    const solved = solveLinear(m.map((row, r) => [...row, r === c ? 1 : 0]));
    if (!solved) return null;
    columns.push(solved.map(clean));
  }
  return transpose(columns);
}

export type RowStep =
  | { kind: 'swap'; a: number; b: number; matrix: Matrix }
  | { kind: 'scale'; row: number; factor: number; matrix: Matrix }
  | { kind: 'add'; from: number; to: number; factor: number; matrix: Matrix };

export interface Reduction {
  steps: RowStep[];
  result: Matrix;
  /** The column of each pivot, in row order. */
  pivots: number[];
}

/** Gauss-Jordan elimination to reduced row echelon form, recording each row operation. Rows count from 0. */
export function reduce(m: Matrix): Reduction {
  const a = copy(m);
  const tolerance = toleranceOf(a);
  const tidy = (x: Matrix): Matrix =>
    x.map((row) => row.map((value) => (Math.abs(value) <= tolerance ? 0 : Number(value.toPrecision(12)))));
  const steps: RowStep[] = [];
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < a[0].length && row < a.length; col++) {
    let pivot = row;
    for (let r = row + 1; r < a.length; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) <= tolerance) continue;
    if (pivot !== row) {
      [a[pivot], a[row]] = [a[row], a[pivot]];
      steps.push({ kind: 'swap', a: row, b: pivot, matrix: tidy(a) });
    }
    const lead = a[row][col];
    if (lead !== 1) {
      a[row] = a[row].map((value) => value / lead);
      a[row][col] = 1;
      steps.push({ kind: 'scale', row, factor: 1 / lead, matrix: tidy(a) });
    }
    for (let r = 0; r < a.length; r++) {
      if (r === row || Math.abs(a[r][col]) <= tolerance) continue;
      const factor = -a[r][col];
      a[r] = a[r].map((value, c) => value + factor * a[row][c]);
      a[r][col] = 0;
      steps.push({ kind: 'add', from: row, to: r, factor, matrix: tidy(a) });
    }
    pivots.push(col);
    row++;
  }
  return { steps, result: tidy(a), pivots };
}

export const rankOf = (m: Matrix): number => reduce(m).pivots.length;

export type Solution = { kind: 'unique'; x: number[] } | { kind: 'none' } | { kind: 'infinite'; rank: number };

/** Solves A x = b for the augmented matrix [A | b]. */
export function solveSystem(augmented: Matrix): Solution {
  const unknowns = augmented[0].length - 1;
  const { result, pivots } = reduce(augmented);
  if (pivots.includes(unknowns)) return { kind: 'none' };
  if (pivots.length < unknowns) return { kind: 'infinite', rank: pivots.length };
  return { kind: 'unique', x: pivots.map((_, i) => result[i][unknowns]) };
}

interface Complex {
  re: number;
  im: number;
}

/** The coefficients of the characteristic polynomial, lowest power first (Faddeev-LeVerrier). */
function characteristic(a: Matrix): number[] {
  const n = a.length;
  const coefficients = new Array<number>(n + 1).fill(0);
  coefficients[n] = 1;
  let mk: Matrix = a.map((row) => row.map(() => 0));
  for (let k = 1; k <= n; k++) {
    const am = multiply(a, mk)!;
    mk = am.map((row, r) => row.map((value, c) => value + (r === c ? coefficients[n - k + 1] : 0)));
    const trace = multiply(a, mk)!.reduce((total, row, i) => total + row[i], 0);
    coefficients[n - k] = -trace / k;
  }
  return coefficients;
}

const evaluate = (coefficients: readonly number[], z: Complex): Complex => {
  let re = 0;
  let im = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    [re, im] = [re * z.re - im * z.im + coefficients[i], re * z.im + im * z.re];
  }
  return { re, im };
};

const divide = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

export interface Eigenvalues {
  /** The real eigenvalues, ascending, repeated by multiplicity. */
  real: number[];
  /** How many eigenvalues are complex, which this tool does not list. */
  complex: number;
}

/** The eigenvalues of a square matrix up to 8 by 8: roots of the characteristic polynomial (Durand-Kerner). */
export function eigenvalues(m: Matrix): Eigenvalues {
  const n = m.length;
  const p = characteristic(m);
  const bound = 1 + Math.max(...p.slice(0, n).map(Math.abs));
  let roots: Complex[] = Array.from({ length: n }, (_, k) => {
    const angle = 0.4 + (2 * Math.PI * k) / n;
    return { re: bound * 0.5 * Math.cos(angle), im: bound * 0.5 * Math.sin(angle) };
  });
  for (let round = 0; round < 800; round++) {
    let moved = 0;
    roots = roots.map((z, i) => {
      let denominator: Complex = { re: 1, im: 0 };
      roots.forEach((other, j) => {
        if (j === i) return;
        const d = { re: z.re - other.re, im: z.im - other.im };
        denominator = {
          re: denominator.re * d.re - denominator.im * d.im,
          im: denominator.re * d.im + denominator.im * d.re,
        };
      });
      const step = divide(evaluate(p, z), denominator);
      moved = Math.max(moved, Math.hypot(step.re, step.im));
      return { re: z.re - step.re, im: z.im - step.im };
    });
    if (moved < 1e-14 * bound) break;
  }
  const scale = Math.max(1, ...roots.map((z) => Math.hypot(z.re, z.im)));
  const real: number[] = [];
  let complex = 0;
  for (const z of roots) {
    if (Math.abs(z.im) <= 1e-6 * scale) real.push(clean(z.re));
    else complex++;
  }
  return { real: real.sort((x, y) => x - y), complex };
}

/** A number as a fraction when a small one matches it closely, else null. */
export function asFraction(value: number): { n: number; d: number } | null {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) return null;
  if (Number.isInteger(value)) return { n: value, d: 1 };
  for (let d = 2; d <= 1000; d++) {
    const n = Math.round(value * d);
    if (Math.abs(value - n / d) < 1e-9 * Math.max(1, Math.abs(value))) return { n, d };
  }
  return null;
}
