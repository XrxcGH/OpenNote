// Factorizations and the problems that use them: LU with row exchanges (exact), QR by Gram-Schmidt and the singular
// value decomposition (decimal), orthogonal projection and least squares by the normal equations (exact), and
// changing basis (exact).
import { symmetricEigen } from '../eigen';
import { fmt } from '../numeric';
import { line, polyLatex, type NumOut } from '../numerics/common';
import { KitError, step, type KitStep } from '../types';
import {
  ONE,
  Z,
  add,
  cmp,
  cols,
  copy,
  div,
  equal,
  hcat,
  identity,
  isZero,
  matrixLatex,
  mul,
  multiply,
  readEntry,
  readMatrix,
  readVector,
  requireSquare,
  rref,
  rows,
  sub,
  text,
  toNum,
  transpose,
  type Q,
  type QM,
} from './frac';
import { tuple } from './solve';

const abs = (a: Q): Q => (a.n < 0n ? { n: -a.n, d: a.d } : a);
const out = (lines: NumOut['lines'], steps: KitStep[], latexText?: string, extra: Partial<NumOut> = {}): NumOut => ({
  lines,
  tables: [],
  plots: [],
  fields: [],
  steps,
  ...(latexText ? { latex: latexText } : {}),
  ...extra,
});

export function luSteps(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  requireSquare(A);
  const n = rows(A);
  const U = copy(A);
  const L: QM = identity(n).map((r) => r.map(() => Z));
  const perm = Array.from({ length: n }, (_, i) => i);
  const steps: KitStep[] = [step('laSetup', matrixLatex(A), {})];
  for (let c = 0; c < n - 1; c++) {
    let pivot = c;
    for (let i = c + 1; i < n; i++) if (cmp(abs(U[i][c]), abs(U[pivot][c])) > 0) pivot = i;
    if (isZero(U[pivot][c])) continue;
    if (pivot !== c) {
      [U[c], U[pivot]] = [U[pivot], U[c]];
      [L[c], L[pivot]] = [L[pivot], L[c]];
      [perm[c], perm[pivot]] = [perm[pivot], perm[c]];
      steps.push(step('laSwap', matrixLatex(U), { op: `R${c + 1} ↔ R${pivot + 1}` }));
    }
    for (let i = c + 1; i < n; i++) {
      if (isZero(U[i][c])) continue;
      const f = div(U[i][c], U[c][c]);
      L[i][c] = f;
      U[i] = U[i].map((v, j) => sub(v, mul(f, U[c][j])));
      steps.push(
        step('laLuMultiplier', matrixLatex(U), { op: `R${i + 1} ← R${i + 1} − (${text(f)})R${c + 1}`, l: text(f) }),
      );
    }
  }
  for (let i = 0; i < n; i++) L[i][i] = ONE;
  const P = identity(n).map((_, i) => identity(n)[perm[i]]);
  const exact = equal(multiply(P, A), multiply(L, U));
  const form = `P=${matrixLatex(P)},\\ L=${matrixLatex(L)},\\ U=${matrixLatex(U)}`;
  steps.push(step('laLuResult', form), step('laLuCheck', `PA=LU\\ \\text{${exact ? 'holds' : 'fails'}}`));
  return out([line('laLu', { check: exact ? 'yes' : 'no' })], steps, form);
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const decimalVector = (v: readonly number[], digits = 6) =>
  `\\begin{pmatrix} ${v.map((x) => fmt(x, digits).replace('−', '-')).join(' \\\\ ')} \\end{pmatrix}`;
const decimalMatrix = (m: readonly (readonly number[])[], digits = 6) =>
  `\\begin{pmatrix} ${m.map((r) => r.map((x) => fmt(x, digits).replace('−', '-')).join(' & ')).join(' \\\\ ')} \\end{pmatrix}`;

export function qrSteps(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const m = rows(A);
  const n = cols(A);
  if (n > m) throw new KitError('laWide');
  const a = Array.from({ length: n }, (_, j) => A.map((r) => toNum(r[j])));
  const qs: number[][] = [];
  const R = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const steps: KitStep[] = [step('laSetup', matrixLatex(A), {})];
  for (let j = 0; j < n; j++) {
    const v = a[j].slice();
    qs.forEach((qi, i) => {
      R[i][j] = dot(qi, a[j]);
      for (let k = 0; k < m; k++) v[k] -= R[i][j] * qi[k];
    });
    const norm = Math.sqrt(dot(v, v));
    if (norm < 1e-10 * Math.max(1, Math.sqrt(dot(a[j], a[j])))) throw new KitError('laDependent', String(j + 1));
    R[j][j] = norm;
    qs.push(v.map((x) => x / norm));
    steps.push(
      step(
        'laGramSchmidt',
        `\\mathbf{v}_{${j + 1}}=${decimalVector(v)},\\ \\|\\mathbf{v}_{${j + 1}}\\|=${fmt(norm, 8)}`,
        { j: String(j + 1) },
      ),
      step('laNormalize', `\\mathbf{q}_{${j + 1}}=${decimalVector(qs[j])}`, { j: String(j + 1) }),
    );
  }
  const Q = Array.from({ length: m }, (_, i) => qs.map((c) => c[i]));
  let error = 0;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      error = Math.max(error, Math.abs(Q[i].reduce((s, v, k) => s + v * R[k][j], 0) - toNum(A[i][j])));
  const form = `Q=${decimalMatrix(Q)},\\ R=${decimalMatrix(R)}`;
  steps.push(step('laQrResult', form, { error: fmt(error, 3) }));
  return out([line('laQr', { error: fmt(error, 3) })], steps, form);
}

// ---------------------------------------------------------------------------------------------------------------
// Projection and least squares
// ---------------------------------------------------------------------------------------------------------------

interface Normal {
  x: QM;
  p: QM;
  r: QM;
  steps: KitStep[];
}

function normalEquations(A: QM, b: QM): Normal {
  if (rows(A) !== rows(b)) throw new KitError('laShapes', `${rows(A)}x${cols(A)} and ${rows(b)}x1`);
  const At = transpose(A);
  const AtA = multiply(At, A);
  const Atb = multiply(At, b);
  const n = cols(A);
  const e = rref(hcat(AtA, Atb), { limit: n, bar: n });
  const steps: KitStep[] = [
    step('laSetup', `A=${matrixLatex(A)},\\ \\mathbf{b}=${matrixLatex(b)}`, {}),
    step(
      'laNormal',
      `A^{T}A\\hat{\\mathbf{x}}=A^{T}\\mathbf{b}:\\ ${matrixLatex(AtA)}\\hat{\\mathbf{x}}=${matrixLatex(Atb)}`,
    ),
    ...e.steps,
  ];
  if (e.pivots.length < n) throw new KitError('laDependentColumns');
  const x = e.m.map((r) => [r[n]]);
  const p = multiply(A, x);
  const r = b.map((row, i) => [sub(row[0], p[i][0])]);
  steps.push(
    step('laLsqSolution', `\\hat{\\mathbf{x}}=${matrixLatex(x)}`),
    step(
      'laProjectionVector',
      `\\mathbf{p}=A\\hat{\\mathbf{x}}=${matrixLatex(p)},\\ \\mathbf{r}=\\mathbf{b}-\\mathbf{p}=${matrixLatex(r)}`,
    ),
  );
  const orth = multiply(At, r).every((row) => row.every(isZero));
  steps.push(step('laOrthogonal', `A^{T}\\mathbf{r}=\\mathbf{0}\\ \\text{${orth ? 'holds' : 'fails'}}`));
  return { x, p, r, steps };
}

const squaredNorm = (v: QM): Q => v.reduce((s, r) => add(s, mul(r[0], r[0])), Z);

export function projection(aText: string, bText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const b = readVector(bText, 'b');
  const nrm = normalEquations(A, b);
  const form = `\\mathbf{p}=${matrixLatex(nrm.p)}`;
  return out(
    [line('laProjection', { p: tuple(nrm.p.map((r) => r[0])), r: tuple(nrm.r.map((r) => r[0])) })],
    nrm.steps,
    form,
  );
}

export function leastSquares(aText: string, bText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const b = readVector(bText, 'b');
  const nrm = normalEquations(A, b);
  const err2 = squaredNorm(nrm.r);
  const x = nrm.x.map((r) => r[0]);
  return out(
    [line('laLsq', { x: tuple(x), e2: text(err2), e: fmt(Math.sqrt(toNum(err2)), 8) })],
    nrm.steps,
    `\\hat{\\mathbf{x}}=${matrixLatex(nrm.x)}`,
  );
}

/** The least-squares polynomial of a given degree through points typed as "x, y" lines. */
export function polynomialLeastSquares(pointsText: string, degree: number): NumOut {
  const pts = pointsText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(readEntry),
    );
  if (pts.length < 2 || pts.some((p) => p.length !== 2)) throw new KitError('badPoints');
  if (!Number.isInteger(degree) || degree < 0 || degree >= pts.length || degree > 6)
    throw new KitError('badWhole', `degree: 0 to ${Math.min(6, pts.length - 1)}`);
  const A: QM = pts.map(([x]) => Array.from({ length: degree + 1 }, (_, k) => pow(x, k)));
  const b: QM = pts.map(([, y]) => [y]);
  const nrm = normalEquations(A, b);
  const coeffs = nrm.x.map((r) => toNum(r[0]));
  const form = `y=${polyLatex(coeffs, 'x', 8)}`;
  const xs = pts.map(([x]) => toNum(x));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const curve: [number, number][] = Array.from({ length: 81 }, (_, k) => {
    const x = lo + ((hi - lo) * k) / 80;
    return [x, coeffs.reduceRight((s, a) => s * x + a, 0)];
  });
  const err2 = squaredNorm(nrm.r);
  const exact = nrm.x.map((r) => text(r[0])).join(', ');
  return out(
    [line('laFit', { coefficients: exact, model: polyLatex(coeffs, 'x', 8), e: fmt(Math.sqrt(toNum(err2)), 8) })],
    [...nrm.steps, step('numValue', form)],
    form,
    {
      plots: [
        {
          label: 'fit',
          series: [
            { points: curve },
            { points: pts.map(([x, y]): [number, number] => [toNum(x), toNum(y)]), dots: true, tone: 1 },
          ],
        },
      ],
    },
  );
}

function pow(x: Q, k: number): Q {
  let r: Q = ONE;
  for (let i = 0; i < k; i++) r = mul(r, x);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Singular values
// ---------------------------------------------------------------------------------------------------------------

/** sqrt(k) written exactly when k is a whole number. */
function sqrtLatex(k: number): string {
  const r = Math.round(k);
  if (Math.abs(k - r) > 1e-8 * Math.max(1, k)) return fmt(Math.sqrt(k), 8);
  const s = Math.round(Math.sqrt(r));
  return s * s === r ? String(s) : `\\sqrt{${r}}`;
}

export function svdSteps(aText: string): NumOut {
  const A = readMatrix(aText, 'A');
  const m = rows(A);
  const n = cols(A);
  const AtA = multiply(transpose(A), A);
  const e = symmetricEigen(AtA.map((r) => r.map(toNum)));
  const order = e.values.map((_, i) => i).sort((i, j) => e.values[j] - e.values[i]);
  // The rank is decided on the eigenvalues of A^T A, whose rounding error is about eps times the largest one: a
  // lambda of 1e-15 is a zero, though its square root, 3e-8, would look like a real singular value.
  const top = Math.max(0, e.values[order[0]] ?? 0);
  const floor = Math.max(m, n) * top * 2.2e-16 * 10;
  const lambdas = order.map((i) => (e.values[i] > floor ? e.values[i] : 0));
  const sigmas = lambdas.map(Math.sqrt);
  const rank = Math.min(m, n, lambdas.filter((l) => l > 0).length);
  const V = e.vectors.map((row) => order.map((j) => row[j]));
  const steps: KitStep[] = [
    step('laSetup', matrixLatex(A), {}),
    step('laAtA', `A^{T}A=${matrixLatex(AtA)}`),
    step('laSigma', lambdas.map((l, i) => `\\lambda_{${i + 1}}=${fmt(l, 8)}`).join(',\\ ')),
    step('laSigmaRoots', sigmas.map((_, i) => `\\sigma_{${i + 1}}=${sqrtLatex(lambdas[i])}`).join(',\\ ')),
  ];
  const U: number[][] = Array.from({ length: m }, () => new Array<number>(rank).fill(0));
  for (let k = 0; k < rank; k++) {
    const av = A.map((row) => row.reduce((s, v, j) => s + toNum(v) * V[j][k], 0));
    av.forEach((x, i) => (U[i][k] = x / sigmas[k]));
  }
  steps.push(
    step('laSvdV', `V=${decimalMatrix(V)}`),
    step('laSvdU', `\\mathbf{u}_i=\\frac{1}{\\sigma_i}A\\mathbf{v}_i:\\ U=${decimalMatrix(U)}`),
  );
  let error = 0;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      error = Math.max(error, Math.abs(U[i].reduce((s, u, k) => s + u * sigmas[k] * V[j][k], 0) - toNum(A[i][j])));
  steps.push(step('laSvdCheck', `\\max|A-U\\Sigma V^{T}|=${fmt(error, 3)}`));
  const values = sigmas
    .slice(0, Math.min(m, n))
    .map((s) => fmt(s, 10))
    .join(', ');
  return out(
    [line('laSingularValues', { values, rank: String(rank) })],
    steps,
    `\\sigma=${sigmas
      .slice(0, Math.min(m, n))
      .map((_, i) => sqrtLatex(lambdas[i]))
      .join(',\\ ')}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Change of basis
// ---------------------------------------------------------------------------------------------------------------

function invertible(B: QM, name: string): void {
  requireSquare(B, name);
  if (rref(B, { record: false }).pivots.length < rows(B)) throw new KitError('laNotBasis', name);
}

/** The coordinates of v in the basis B, the columns of B. */
export function coordinates(bText: string, vText: string): NumOut {
  const B = readMatrix(bText, 'B');
  const v = readVector(vText, 'v');
  invertible(B, 'B');
  if (rows(v) !== rows(B)) throw new KitError('laShapes', `${rows(B)}x${cols(B)} and ${rows(v)}x1`);
  const n = cols(B);
  const e = rref(hcat(B, v), { limit: n, bar: n });
  const c = e.m.map((r) => [r[n]]);
  const steps = [
    step('laSetup', `B=${matrixLatex(B)},\\ \\mathbf{v}=${matrixLatex(v)}`, {}),
    step('laCoords', `B[\\mathbf{v}]_B=\\mathbf{v}`),
    ...e.steps,
    step('laCoordsResult', `[\\mathbf{v}]_B=${matrixLatex(c)}`),
  ];
  return out([line('laCoordinates', { c: tuple(c.map((r) => r[0])) })], steps, `[\\mathbf{v}]_B=${matrixLatex(c)}`);
}

/** The matrix that turns B-coordinates into C-coordinates: C inverse times B. */
export function transition(bText: string, cText: string): NumOut {
  const B = readMatrix(bText, 'B');
  const C = readMatrix(cText, 'C');
  invertible(B, 'B');
  invertible(C, 'C');
  if (rows(B) !== rows(C)) throw new KitError('laShapes', `${rows(B)} and ${rows(C)}`);
  const n = rows(C);
  const e = rref(hcat(C, B), { limit: n, bar: n });
  const P = e.m.map((r) => r.slice(n));
  const steps = [
    step('laSetup', `B=${matrixLatex(B)},\\ C=${matrixLatex(C)}`, {}),
    step('laTransition', 'P_{C\\leftarrow B}=C^{-1}B'),
    ...e.steps,
    step('laTransitionResult', `P_{C\\leftarrow B}=${matrixLatex(P)}`),
  ];
  return out(
    [line('laTransitionLine', { p: P.map((r) => r.map(text).join(' ')).join('; ') })],
    steps,
    `P_{C\\leftarrow B}=${matrixLatex(P)}`,
  );
}

/** The matrix of the map x -> T x relative to a basis B of the input space and a basis C of the output space. */
export function mapMatrix(tText: string, bText: string, cText: string): NumOut {
  const T = readMatrix(tText, 'T');
  const B = readMatrix(bText, 'B');
  const C = readMatrix(cText, 'C');
  invertible(B, 'B');
  invertible(C, 'C');
  if (cols(T) !== rows(B) || rows(T) !== rows(C)) throw new KitError('laShapes', `T ${rows(T)}x${cols(T)}`);
  const TB = multiply(T, B);
  const n = rows(C);
  const e = rref(hcat(C, TB), { limit: n, bar: n });
  const M = e.m.map((r) => r.slice(n));
  const steps = [
    step('laSetup', `T=${matrixLatex(T)}`, {}),
    step('laMapRule', '[T]_{C\\leftarrow B}=C^{-1}TB'),
    step('laMapProduct', `TB=${matrixLatex(TB)}`),
    ...e.steps,
    step('laMapResult', `[T]_{C\\leftarrow B}=${matrixLatex(M)}`),
  ];
  return out(
    [line('laMapLine', { m: M.map((r) => r.map(text).join(' ')).join('; ') })],
    steps,
    `[T]_{C\\leftarrow B}=${matrixLatex(M)}`,
  );
}
