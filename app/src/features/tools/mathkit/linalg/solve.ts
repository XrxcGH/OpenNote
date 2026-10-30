// Linear systems and the four fundamental subspaces, in exact arithmetic with every row operation shown: solving a
// system of equations, reduced row echelon form, the inverse by [A | I], the determinant, and bases for the null,
// column, and row spaces.
import { KitError, step, type KitStep } from '../types';
import { line, type NumOut } from '../numerics/common';
import {
  ONE,
  Z,
  add,
  columnOf,
  cols,
  copy,
  determinantOf,
  div,
  hcat,
  identity,
  isZero,
  latex,
  matrixLatex,
  mul,
  neg,
  nullBasis,
  readMatrix,
  readVector,
  requireSquare,
  rref,
  rows,
  sub,
  text,
  vectorLatex,
  type Q,
  type QM,
} from './frac';

const base = (lines: NumOut['lines'], steps: KitStep[], latexText?: string): NumOut => ({
  lines,
  tables: [],
  plots: [],
  fields: [],
  steps,
  ...(latexText ? { latex: latexText } : {}),
});

export const tuple = (v: readonly Q[]): string => `(${v.map(text).join(', ')})`;

/** x = particular + t1 v1 + t2 v2 as LaTeX. */
function parametricLatex(particular: readonly Q[], basis: readonly QM[]): string {
  const terms = basis.map((v, k) => `t_{${k + 1}}${vectorLatex(v.map((r) => r[0]))}`);
  return `\\mathbf{x}=${[vectorLatex(particular), ...terms].join('+')}`;
}

export function solveSystem(aText: string, bText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const b = readVector(bText, 'b');
  if (rows(b) !== rows(A)) throw new KitError('laShapes', `${rows(A)}x${cols(A)} and ${rows(b)}x1`);
  const n = cols(A);
  const aug = hcat(A, b);
  const e = rref(aug, { limit: n, bar: n });
  const steps: KitStep[] = [step('laSetup', matrixLatex(aug, n), {}), ...e.steps];
  const bad = e.m.findIndex((row) => row.slice(0, n).every(isZero) && !isZero(row[n]));
  if (bad >= 0) {
    steps.push(step('laInconsistent', undefined, { value: text(e.m[bad][n]) }));
    return base([line('laNone', { value: text(e.m[bad][n]) })], steps);
  }
  const free = Array.from({ length: n }, (_, j) => j).filter((j) => !e.pivots.includes(j));
  const particular: Q[] = new Array<Q>(n).fill(Z);
  e.pivots.forEach((p, i) => (particular[p] = e.m[i][n]));
  if (free.length === 0) {
    steps.push(step('laReadSolution', vectorLatex(particular)));
    return base([line('laUnique', { x: tuple(particular) })], steps, `\\mathbf{x}=${vectorLatex(particular)}`);
  }
  const coefficients = e.m.map((row) => row.slice(0, n));
  const basis = nullBasis(coefficients, e.pivots, n);
  const form = parametricLatex(particular, basis);
  steps.push(step('laFreeVariables', form, { free: free.map((j) => `x${j + 1}`).join(', ') }));
  return base([line('laInfinite', { free: String(free.length), x: tuple(particular) })], steps, form);
}

export function reduceOnly(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const e = rref(A);
  const steps = [step('laSetup', matrixLatex(A), {}), ...e.steps];
  const pivotText = e.pivots.map((p) => `${p + 1}`).join(', ');
  return base(
    [
      line('laRank', { rank: String(e.pivots.length), nullity: String(cols(A) - e.pivots.length) }),
      line('laPivots', { cols: pivotText || '-' }),
    ],
    steps,
    `\\operatorname{rref}(A)=${matrixLatex(e.m)}`,
  );
}

export function inverseOf(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  requireSquare(A);
  const n = rows(A);
  const aug = hcat(A, identity(n));
  const e = rref(aug, { limit: n, bar: n });
  const steps: KitStep[] = [step('laSetup', matrixLatex(aug, n), {}), ...e.steps];
  if (e.pivots.length < n) {
    steps.push(step('laNoInverse', undefined, { rank: String(e.pivots.length), n: String(n) }));
    return base([line('laSingular')], steps);
  }
  const inverse = e.m.map((r) => r.slice(n));
  steps.push(step('laReadInverse', matrixLatex(inverse)));
  const detail = inverse.map((r) => r.map(text).join(' ')).join('; ');
  return base([line('laInverse', { inverse: detail })], steps, `A^{-1}=${matrixLatex(inverse)}`);
}

/** The cofactor expansion along the first row, as LaTeX, with each minor's value. */
function cofactorLatex(A: QM): { latex: string; value: Q } {
  const n = rows(A);
  if (n === 1) return { latex: latex(A[0][0]), value: A[0][0] };
  if (n === 2) {
    const value = sub(mul(A[0][0], A[1][1]), mul(A[0][1], A[1][0]));
    return { latex: `${paren(A[0][0])}${paren(A[1][1])}-${paren(A[0][1])}${paren(A[1][0])}=${latex(value)}`, value };
  }
  let total = Z;
  const parts: string[] = [];
  for (let j = 0; j < n; j++) {
    const minor = A.slice(1).map((row) => row.filter((_, c) => c !== j));
    const m = determinantOf(minor);
    const sign = j % 2 === 0 ? ONE : neg(ONE);
    total = add(total, mul(mul(sign, A[0][j]), m));
    parts.push(`${j % 2 === 0 ? '+' : '-'}${paren(A[0][j])}\\cdot ${latex(m)}`);
  }
  return { latex: `${parts.join(' ').replace(/^\+/, '')}=${latex(total)}`, value: total };
}

const paren = (a: Q): string => (a.n < 0n ? `(${latex(a)})` : latex(a));

export function determinantSteps(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  requireSquare(A);
  const n = rows(A);
  const steps: KitStep[] = [step('laSetup', matrixLatex(A), {})];
  if (n <= 4) {
    const c = cofactorLatex(A);
    steps.push(step('laCofactor', c.latex));
  }
  // Elimination to an upper triangular matrix: the determinant is the product of the diagonal, with a sign per swap.
  const m = copy(A);
  let sign = 1;
  for (let c = 0; c < n; c++) {
    const pivot = m.findIndex((row, i) => i >= c && !isZero(row[c]));
    if (pivot < 0) break;
    if (pivot !== c) {
      [m[c], m[pivot]] = [m[pivot], m[c]];
      sign = -sign;
      steps.push(step('laSwap', matrixLatex(m), { op: `R${c + 1} ↔ R${pivot + 1}` }));
    }
    for (let i = c + 1; i < n; i++) {
      if (isZero(m[i][c])) continue;
      const f = div(m[i][c], m[c][c]);
      m[i] = m[i].map((v, j) => sub(v, mul(f, m[c][j])));
      steps.push(
        step('laRowOp', matrixLatex(m), {
          op: `R${i + 1} ← R${i + 1} − ${f.d === 1n ? text(f) : `(${text(f)})`}R${c + 1}`,
        }),
      );
    }
  }
  const det = determinantOf(A);
  const diagonal = m.map((r, i) => latex(r[i])).join('\\cdot ');
  steps.push(step('laDiagonalProduct', `${sign < 0 ? '-' : ''}${diagonal}=${latex(det)}`));
  return base([line('laDet', { det: text(det) })], steps, `\\det A=${latex(det)}`);
}

/** Bases for the null space, column space, and row space, with the rank and nullity. */
export function subspaces(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const n = cols(A);
  const e = rref(A);
  const rank = e.pivots.length;
  const nulls = nullBasis(e.m, e.pivots, n);
  const colBasis = e.pivots.map((p) => columnOf(A, p));
  const rowBasis = e.m.slice(0, rank).map((r) => r.map((v) => [v]));
  const list = (vs: QM[]) => (vs.length ? vs.map((v) => vectorLatex(v.map((r) => r[0]))).join(',\\ ') : '\\text{none}');
  const steps: KitStep[] = [
    step('laSetup', matrixLatex(A), {}),
    ...e.steps,
    step('laNullBasis', `\\operatorname{Nul}A=\\operatorname{span}\\left\\{${list(nulls)}\\right\\}`),
    step('laColBasis', `\\operatorname{Col}A=\\operatorname{span}\\left\\{${list(colBasis)}\\right\\}`),
    step('laRowBasis', `\\operatorname{Row}A=\\operatorname{span}\\left\\{${list(rowBasis)}\\right\\}`),
    step('laRankNullity', `\\operatorname{rank}A+\\operatorname{nullity}A=${rank}+${n - rank}=${n}`),
  ];
  const vecs = (vs: QM[]) => vs.map((v) => tuple(v.map((r) => r[0]))).join(', ') || '-';
  return base(
    [
      line('laRank', { rank: String(rank), nullity: String(n - rank) }),
      line('laNullText', { basis: vecs(nulls) }),
      line('laColText', { basis: vecs(colBasis) }),
      line('laRowText', { basis: vecs(rowBasis) }),
    ],
    steps,
    `\\operatorname{rank}A=${rank},\\ \\operatorname{nullity}A=${n - rank}`,
  );
}
