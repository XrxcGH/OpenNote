// Exact matrices: entries are fractions on big integers, so 1/3 stays 1/3 and every step can be written down. Also
// reading a typed matrix, writing a matrix as LaTeX, and the elimination that the rest of the workbench builds on.
import { fractions } from '../../../../core/expr';
import { KitError, step, type KitStep } from '../types';

export type Q = fractions.Rational;
export type QM = Q[][];

export const Z: Q = fractions.ZERO_RATIONAL;
export const ONE: Q = fractions.ONE_RATIONAL;
export const q = (n: number | bigint, d: number | bigint = 1): Q => fractions.rational(BigInt(n), BigInt(d));
export const isZero = (a: Q): boolean => a.n === 0n;
export const isOne = (a: Q): boolean => a.n === 1n && a.d === 1n;
export const add = fractions.add;
export const sub = fractions.sub;
export const mul = fractions.mul;
export const div = fractions.div;
export const neg = fractions.neg;
export const cmp = fractions.compare;
export const toNum = fractions.toNumber;

export const MAX_EXACT = 8;

/** One entry: an integer, a decimal, or a fraction such as -3/4. */
export function readEntry(text: string): Q {
  const token = text.trim();
  const parts = token.split('/');
  try {
    if (parts.length === 1) {
      const v = fractions.fromDecimalText(token);
      if (v) return v;
    } else if (parts.length === 2) {
      const a = fractions.fromDecimalText(parts[0]);
      const b = fractions.fromDecimalText(parts[1]);
      if (a && b && !isZero(b)) return fractions.div(a, b);
      if (b && isZero(b)) throw new KitError('laDivideByZero', token);
    }
  } catch (error) {
    if (error instanceof KitError) throw error;
    throw new KitError('laTooBig');
  }
  throw new KitError('laBadEntry', token);
}

/** A matrix typed one row per line, with entries separated by spaces, commas, or semicolons. */
export function readMatrix(text: string, name = 'A'): QM {
  const rows = text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(readEntry),
    );
  if (rows.length === 0) throw new KitError('laEmpty', name);
  if (rows.some((row) => row.length !== rows[0].length)) throw new KitError('laRagged', name);
  if (rows.length > MAX_EXACT || rows[0].length > MAX_EXACT) throw new KitError('laTooLarge', String(MAX_EXACT));
  return rows;
}

/** A column or row of numbers as a column vector (a matrix with one column). */
export function readVector(text: string, name = 'b'): QM {
  const items = text
    .split(/[\s,;\n]+/)
    .filter(Boolean)
    .map(readEntry);
  if (items.length === 0) throw new KitError('laEmpty', name);
  if (items.length > MAX_EXACT) throw new KitError('laTooLarge', String(MAX_EXACT));
  return items.map((v) => [v]);
}

export const rows = (m: QM): number => m.length;
export const cols = (m: QM): number => m[0]?.length ?? 0;
export const copy = (m: QM): QM => m.map((r) => r.slice());
export const identity = (n: number): QM =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : Z)));
export const transpose = (m: QM): QM => m[0].map((_, j) => m.map((r) => r[j]));

export function multiply(a: QM, b: QM): QM {
  if (cols(a) !== rows(b)) throw new KitError('laShapes', `${rows(a)}x${cols(a)} * ${rows(b)}x${cols(b)}`);
  return a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => add(s, mul(v, b[k][j])), Z)));
}

export const equal = (a: QM, b: QM): boolean =>
  rows(a) === rows(b) && cols(a) === cols(b) && a.every((r, i) => r.every((v, j) => cmp(v, b[i][j]) === 0));

// ---------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------

export const text = (a: Q): string => fractions.formatFraction(a);

export function latex(a: Q): string {
  if (a.d === 1n) return String(a.n);
  return `${a.n < 0n ? '-' : ''}\\frac{${a.n < 0n ? -a.n : a.n}}{${a.d}}`;
}

/** A matrix as LaTeX. With `bar`, a vertical line is drawn before that column, for an augmented matrix. */
export function matrixLatex(m: QM, bar?: number): string {
  const body = m.map((r) => r.map(latex).join(' & ')).join(' \\\\ ');
  if (bar === undefined || bar <= 0 || bar >= cols(m)) return `\\begin{pmatrix} ${body} \\end{pmatrix}`;
  const spec = `${'c'.repeat(bar)}|${'c'.repeat(cols(m) - bar)}`;
  return `\\left(\\begin{array}{${spec}} ${body} \\end{array}\\right)`;
}

export const vectorLatex = (v: readonly Q[]): string => matrixLatex(v.map((x) => [x]));

// ---------------------------------------------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------------------------------------------

export interface Elimination {
  m: QM;
  pivots: number[];
  steps: KitStep[];
}

const rowName = (i: number) => `R${i + 1}`;

/** The coefficient text for a row operation: "2" in R2 - 2R1, omitted when it is 1. */
function coefficient(c: Q): string {
  const a = c.n < 0n ? fractions.neg(c) : c;
  return isOne(a) ? '' : a.d === 1n ? String(a.n) : `(${text(a)})`;
}

function opText(target: number, source: number, factor: Q): string {
  const sign = factor.n < 0n ? '-' : '+';
  return `${rowName(target)} ← ${rowName(target)} ${sign} ${coefficient(factor)}${rowName(source)}`;
}

/**
 * Gauss-Jordan elimination on the first `limit` columns (all of them by default), recording each row operation as a
 * step with the matrix after it. `bar` marks the augmented column in the pictures.
 */
export function rref(input: QM, options: { limit?: number; bar?: number; record?: boolean } = {}): Elimination {
  const m = copy(input);
  const limit = options.limit ?? cols(m);
  const record = options.record !== false;
  const steps: KitStep[] = [];
  const pivots: number[] = [];
  const show = (key: 'laRowOp' | 'laSwap' | 'laScale', op: string) => {
    if (record) steps.push(step(key, matrixLatex(m, options.bar), { op }));
  };
  let r = 0;
  for (let c = 0; c < limit && r < rows(m); c++) {
    const pivot = m.findIndex((row, i) => i >= r && !isZero(row[c]));
    if (pivot < 0) continue;
    if (pivot !== r) {
      [m[r], m[pivot]] = [m[pivot], m[r]];
      show('laSwap', `${rowName(r)} ↔ ${rowName(pivot)}`);
    }
    const lead = m[r][c];
    if (!isOne(lead)) {
      m[r] = m[r].map((v) => div(v, lead));
      show('laScale', `${rowName(r)} ← ${rowName(r)} ÷ ${lead.d === 1n ? text(lead) : `(${text(lead)})`}`);
    }
    for (let i = 0; i < rows(m); i++) {
      if (i === r || isZero(m[i][c])) continue;
      const factor = m[i][c];
      m[i] = m[i].map((v, j) => sub(v, mul(factor, m[r][j])));
      show('laRowOp', opText(i, r, neg(factor)));
    }
    pivots.push(c);
    r++;
  }
  return { m, pivots, steps };
}

/** A basis for the null space, from a matrix already in reduced row echelon form. */
export function nullBasis(reduced: QM, pivots: readonly number[], n: number): QM[] {
  const free = Array.from({ length: n }, (_, j) => j).filter((j) => !pivots.includes(j));
  return free.map((f) => {
    const v: Q[] = new Array<Q>(n).fill(Z);
    v[f] = ONE;
    pivots.forEach((p, i) => (v[p] = neg(reduced[i][f])));
    return v.map((x) => [x]);
  });
}

/** The determinant by elimination to an upper triangular form (exact). */
export function determinantOf(input: QM): Q {
  const m = copy(input);
  const n = rows(m);
  let det = ONE;
  for (let c = 0; c < n; c++) {
    const pivot = m.findIndex((row, i) => i >= c && !isZero(row[c]));
    if (pivot < 0) return Z;
    if (pivot !== c) {
      [m[c], m[pivot]] = [m[pivot], m[c]];
      det = neg(det);
    }
    det = mul(det, m[c][c]);
    for (let i = c + 1; i < n; i++) {
      const f = div(m[i][c], m[c][c]);
      if (!isZero(f)) m[i] = m[i].map((v, j) => sub(v, mul(f, m[c][j])));
    }
  }
  return det;
}

export function requireSquare(m: QM, name = 'A'): void {
  if (rows(m) !== cols(m)) throw new KitError('laNotSquare', name);
}

export const columnOf = (m: QM, j: number): QM => m.map((r) => [r[j]]);

/** Joins matrices side by side. */
export const hcat = (...ms: QM[]): QM => ms[0].map((_, i) => ms.flatMap((m) => m[i]));
