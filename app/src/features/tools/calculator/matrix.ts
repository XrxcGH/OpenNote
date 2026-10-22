// The matrix calculator and the linear algebra behind Solve for systems of equations: reading a matrix as typed,
// sums, products, the transpose, the determinant, the inverse, the rank, row-reduced echelon form, and solving
// A x = b. Elimination picks the largest pivot in each column, which keeps rounding small, and answers are snapped to
// 15 digits so 1/3 * 3 comes back as 1.
import { snap } from '../../../core/expr';

export type Matrix = number[][];

/** The largest matrix the calculator works on, so a paste cannot stall the window. */
export const MAX_SIZE = 20;
const TOLERANCE = 1e-10;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

export type MatrixError = 'empty' | 'not-a-number' | 'ragged' | 'too-large' | 'shape' | 'singular' | 'square';

export type MatrixResult<T> = { ok: true; value: T } | { ok: false; error: MatrixError };

const fail = <T>(error: MatrixError): MatrixResult<T> => ({ ok: false, error });
const done = <T>(value: T): MatrixResult<T> => ({ ok: true, value });

/**
 * Reads a matrix: rows on lines of their own or between semicolons, numbers between spaces or commas. Brackets are
 * allowed, as in [[1, 2], [3, 4]] or [1 2; 3 4].
 */
export function readMatrix(text: string): MatrixResult<Matrix> {
  const body = text
    .trim()
    .replace(/^\[\s*\[/, '')
    .replace(/\]\s*\]$/, '')
    .replace(/^\[|\]$/g, '');
  const rows = body
    .split(/\]\s*,?\s*\[|;|\r?\n/)
    .map((row) => row.replace(/[[\]]/g, '').trim())
    .filter((row) => row !== '')
    .map((row) => row.split(/[\s,]+/).filter((piece) => piece !== ''));
  if (rows.length === 0) return fail('empty');
  if (rows.length > MAX_SIZE || rows.some((row) => row.length > MAX_SIZE)) return fail('too-large');
  if (rows.some((row) => row.some((piece) => !NUMBER.test(piece)))) return fail('not-a-number');
  if (rows.some((row) => row.length !== rows[0].length)) return fail('ragged');
  return done(rows.map((row) => row.map(Number)));
}

const shape = (m: Matrix) => [m.length, m[0]?.length ?? 0] as const;
const clean = (m: Matrix): Matrix => m.map((row) => row.map((v) => (Math.abs(v) < 1e-12 ? 0 : snap(v))));

export function add(a: Matrix, b: Matrix, sign: 1 | -1 = 1): MatrixResult<Matrix> {
  const [ar, ac] = shape(a);
  const [br, bc] = shape(b);
  if (ar !== br || ac !== bc) return fail('shape');
  return done(clean(a.map((row, i) => row.map((v, j) => v + sign * b[i][j]))));
}

export function multiply(a: Matrix, b: Matrix): MatrixResult<Matrix> {
  const [ar, ac] = shape(a);
  const [br, bc] = shape(b);
  if (ac !== br) return fail('shape');
  const out: Matrix = Array.from({ length: ar }, () => new Array<number>(bc).fill(0));
  for (let i = 0; i < ar; i += 1)
    for (let k = 0; k < ac; k += 1) for (let j = 0; j < bc; j += 1) out[i][j] += a[i][k] * b[k][j];
  return done(clean(out));
}

export function transpose(a: Matrix): Matrix {
  const [r, c] = shape(a);
  return Array.from({ length: c }, (_, j) => Array.from({ length: r }, (_, i) => a[i][j]));
}

/** Row-reduces a copy in place and returns it with the pivot columns and the sign of the row swaps. */
function eliminate(a: Matrix, columns = shape(a)[1]): { m: Matrix; pivots: number[]; sign: number; det: number } {
  const m = a.map((row) => [...row]);
  const rows = m.length;
  const pivots: number[] = [];
  let sign = 1;
  let det = 1;
  let r = 0;
  for (let c = 0; c < columns && r < rows; c += 1) {
    let best = r;
    for (let i = r + 1; i < rows; i += 1) if (Math.abs(m[i][c]) > Math.abs(m[best][c])) best = i;
    if (Math.abs(m[best][c]) < TOLERANCE) {
      det = 0;
      continue;
    }
    if (best !== r) {
      [m[best], m[r]] = [m[r], m[best]];
      sign = -sign;
    }
    const pivot = m[r][c];
    det *= pivot;
    for (let j = 0; j < m[r].length; j += 1) m[r][j] /= pivot;
    for (let i = 0; i < rows; i += 1) {
      if (i === r || m[i][c] === 0) continue;
      const factor = m[i][c];
      for (let j = 0; j < m[r].length; j += 1) m[i][j] -= factor * m[r][j];
    }
    pivots.push(c);
    r += 1;
  }
  return { m, pivots, sign, det };
}

export function rref(a: Matrix): Matrix {
  return clean(eliminate(a).m);
}

export function rank(a: Matrix): number {
  return eliminate(a).pivots.length;
}

export function determinant(a: Matrix): MatrixResult<number> {
  const [r, c] = shape(a);
  if (r !== c) return fail('square');
  const { pivots, sign, det } = eliminate(a);
  return done(pivots.length < r ? 0 : snap(sign * det));
}

export function inverse(a: Matrix): MatrixResult<Matrix> {
  const [r, c] = shape(a);
  if (r !== c) return fail('square');
  const joined = a.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  const { m, pivots } = eliminate(joined, c);
  if (pivots.length < r) return fail('singular');
  return done(clean(m.map((row) => row.slice(c))));
}

/** Solves A x = b for one x, where b is a column (or a row of the same length). */
export function solve(a: Matrix, b: Matrix): MatrixResult<Matrix> {
  const [r, c] = shape(a);
  const column = b.length === 1 && b[0].length === r ? transpose(b) : b;
  if (column.length !== r || r !== c) return fail(r !== c ? 'square' : 'shape');
  const joined = a.map((row, i) => [...row, ...column[i]]);
  const { m, pivots } = eliminate(joined, c);
  if (pivots.length < r) return fail('singular');
  return done(clean(m.map((row) => row.slice(c))));
}

const cell = (v: number) => String(Number(v.toPrecision(12)));

/** A matrix as text the calculator reads back: rows on lines, numbers between spaces. */
export function writeMatrix(m: Matrix): string {
  return m.map((row) => row.map(cell).join(' ')).join('\n');
}

/** A matrix as LaTeX, for an equation. */
export function matrixLatex(m: Matrix): string {
  return `\\begin{pmatrix}${m.map((row) => row.map(cell).join(' & ')).join(' \\\\ ')}\\end{pmatrix}`;
}
