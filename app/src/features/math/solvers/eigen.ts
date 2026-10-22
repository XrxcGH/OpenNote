// The matrix eigen visualizer: eigenvalues and eigenvectors of a 2×2 or 3×3 matrix, from the characteristic
// polynomial, with the null space of A − λI for each real eigenvalue, and the data to draw what the matrix does: a
// grid and the unit square (or the unit cube, seen at an angle) before and after, with the eigenvector lines.
import { SolverError, niceNumber } from './expr';
import { determinant, nullSpace } from './linalg';
import { cx, cabs, cmul, csub, roots, type Complex } from './polynomial';
import { step, type Step, type XY } from './steps';

export interface Eigenpair {
  readonly value: Complex;
  /** How many times it is a root of the characteristic polynomial. */
  readonly algebraic: number;
  /** Real eigenvectors, a basis of the eigenspace; for a complex eigenvalue, one complex vector as text. */
  readonly vectors: readonly (readonly number[])[];
  readonly complexVector?: string;
}

export interface EigenResult {
  readonly size: 2 | 3;
  /** The characteristic polynomial's coefficients, highest power first, for λⁿ + … */
  readonly characteristic: readonly number[];
  readonly pairs: readonly Eigenpair[];
  readonly steps: readonly Step[];
  /** True when the eigenvectors span the whole space. */
  readonly diagonalizable: boolean;
  readonly plot: {
    readonly before: readonly (readonly XY[])[];
    readonly after: readonly (readonly XY[])[];
    readonly eigenLines: readonly (readonly XY[])[];
  };
}

const vecText = (v: readonly number[]) => `(${v.map((x) => niceNumber(Math.abs(x) < 1e-12 ? 0 : x)).join(', ')})`;

function complexText(z: Complex): string {
  if (Math.abs(z.im) < 1e-12) return niceNumber(z.re);
  const im = `${niceNumber(Math.abs(z.im))}i`;
  return Math.abs(z.re) < 1e-12 ? `${z.im < 0 ? '−' : ''}${im}` : `${niceNumber(z.re)} ${z.im < 0 ? '−' : '+'} ${im}`;
}

function polyText(c: readonly number[]): string {
  const n = c.length - 1;
  let out = '';
  c.forEach((coef, i) => {
    const power = n - i;
    if (Math.abs(coef) < 1e-12) return;
    const x = power === 0 ? '' : power === 1 ? 'λ' : `λ^${power}`;
    const mag = Math.abs(coef);
    const body = x && Math.abs(mag - 1) < 1e-12 ? x : `${niceNumber(mag)}${x ? `·${x}` : ''}`;
    out += out ? ` ${coef < 0 ? '−' : '+'} ${body}` : `${coef < 0 ? '−' : ''}${body}`;
  });
  return out || '0';
}

export function eigen(input: readonly (readonly number[])[]): EigenResult {
  const n = input.length;
  if ((n !== 2 && n !== 3) || input.some((row) => row.length !== n || row.some((x) => !Number.isFinite(x))))
    throw new SolverError('matrix-size');
  const A = input.map((row) => [...row]);
  const steps: Step[] = [];
  const trace = A.reduce((s, row, i) => s + row[i], 0);
  const det = determinant(A);
  let characteristic: number[];
  if (n === 2) {
    characteristic = [1, -trace, det];
    steps.push(
      step('eigenCharacteristic2', `det(A − λI) = ${polyText(characteristic)} = 0`, {
        trace: niceNumber(trace),
        det: niceNumber(det),
      }),
    );
  } else {
    const minors =
      A[0][0] * A[1][1] -
      A[0][1] * A[1][0] +
      A[0][0] * A[2][2] -
      A[0][2] * A[2][0] +
      A[1][1] * A[2][2] -
      A[1][2] * A[2][1];
    characteristic = [1, -trace, minors, -det];
    steps.push(
      step('eigenCharacteristic3', `det(A − λI) = −(${polyText(characteristic)}) = 0`, {
        trace: niceNumber(trace),
        minors: niceNumber(minors),
        det: niceNumber(det),
      }),
    );
  }
  const found = roots([...characteristic].reverse());
  // Real roots first, largest first; then complex ones.
  found.sort((a, b) => (a.z.im === 0 ? 0 : 1) - (b.z.im === 0 ? 0 : 1) || b.z.re - a.z.re || b.z.im - a.z.im);
  steps.push(
    step('eigenValues', found.map((r) => `λ = ${complexText(r.z)}${r.times > 1 ? ` (×${r.times})` : ''}`).join(',  ')),
  );

  const scale = Math.max(1, ...A.flat().map(Math.abs));
  const pairs: Eigenpair[] = found.map((root) => {
    if (root.z.im === 0) {
      const lambda = root.z.re;
      const shifted = A.map((row, i) => row.map((x, j) => (i === j ? x - lambda : x)));
      let vectors = nullSpace(shifted, 1e-7 * scale);
      // A root found to only about 1e-8 (a repeated one) can leave A − λI just short of singular.
      if (!vectors.length) vectors = nullSpace(shifted, 1e-4 * scale);
      steps.push(
        step('eigenVector', `A − ${niceNumber(lambda)}I: v = ${vectors.map(vecText).join(', ') || '—'}`, {
          lambda: niceNumber(lambda),
          dimension: String(vectors.length),
        }),
      );
      return { value: root.z, algebraic: root.times, vectors };
    }
    const vector = complexVector(A, root.z);
    steps.push(step('eigenComplex', `λ = ${complexText(root.z)}: v = ${vector}`, { lambda: complexText(root.z) }));
    return { value: root.z, algebraic: root.times, vectors: [], complexVector: vector };
  });
  const realCount = pairs.reduce((s, p) => s + p.vectors.length, 0);
  const complexCount = pairs.filter((p) => p.value.im !== 0).length;
  const diagonalizable = realCount + complexCount === n;
  steps.push(step(diagonalizable ? 'eigenDiagonalizable' : 'eigenDefective'));
  return { size: n as 2 | 3, characteristic, pairs, steps, diagonalizable, plot: plot(A, pairs) };
}

/** A complex eigenvector, from the null space of A − λI over the complex numbers. */
function complexVector(A: readonly (readonly number[])[], lambda: Complex): string {
  const M = A.map((row, i) => row.map((x, j) => (i === j ? csub(cx(x), lambda) : cx(x))));
  let v: Complex[];
  if (A.length === 2) {
    // (a − λ) v₁ + b v₂ = 0: take v = (b, λ − a), or from the second row when b is 0.
    v = cabs(M[0][1]) > 1e-12 ? [M[0][1], csub(cx(0), M[0][0])] : [csub(cx(0), M[1][1]), M[1][0]];
  } else {
    // The cross product of two rows of A − λI is orthogonal (bilinearly) to both, so it is in the null space.
    const cross = (a: Complex[], b: Complex[]) => [
      csub(cmul(a[1], b[2]), cmul(a[2], b[1])),
      csub(cmul(a[2], b[0]), cmul(a[0], b[2])),
      csub(cmul(a[0], b[1]), cmul(a[1], b[0])),
    ];
    const options = [cross(M[0], M[1]), cross(M[0], M[2]), cross(M[1], M[2])];
    v = options.reduce((best, one) => (norm(one) > norm(best) ? one : best));
  }
  // Scale so the largest entry is 1.
  const big = v.reduce((best, z) => (cabs(z) > cabs(best) ? z : best));
  const d = big.re * big.re + big.im * big.im;
  const scaled = v.map((z) => cx((z.re * big.re + z.im * big.im) / d, (z.im * big.re - z.re * big.im) / d));
  return `(${scaled.map(complexText).join(', ')})`;
}

const norm = (v: readonly Complex[]) => Math.hypot(...v.map(cabs));

/** Grid lines and the unit square, or the unit cube seen at an angle, before and after A; and the eigenvector lines. */
function plot(A: readonly (readonly number[])[], pairs: readonly Eigenpair[]) {
  const apply = (v: readonly number[]) => A.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
  if (A.length === 2) {
    const lines: number[][][] = [];
    for (let k = -2; k <= 2; k += 1) {
      lines.push(
        [
          [k, -2],
          [k, 2],
        ],
        [
          [-2, k],
          [2, k],
        ],
      );
    }
    const square = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const toXY = (p: readonly number[]) => ({ x: p[0], y: p[1] });
    const before = [...lines, square].map((line) => line.map(toXY));
    const after = [...lines, square].map((line) => line.map((p) => toXY(apply(p))));
    const eigenLines = pairs.flatMap((pair) =>
      pair.vectors.map((v) => [toXY(v.map((x) => -3 * x)), toXY(v.map((x) => 3 * x))]),
    );
    return { before, after, eigenLines };
  }
  // An oblique view: x to the right, y up, z toward the viewer and down to the left.
  const view = (p: readonly number[]) => ({ x: p[0] - 0.5 * p[2], y: p[1] - 0.35 * p[2] });
  const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z])));
  const edges = corners.flatMap((a, i) =>
    corners
      .slice(i + 1)
      .filter((b) => a.reduce((s, x, k) => s + Math.abs(x - b[k]), 0) === 1)
      .map((b) => [a, b]),
  );
  const before = edges.map((edge) => edge.map(view));
  const after = edges.map((edge) => edge.map((p) => view(apply(p))));
  const eigenLines = pairs.flatMap((pair) =>
    pair.vectors.map((v) => [view(v.map((x) => -2 * x)), view(v.map((x) => 2 * x))]),
  );
  return { before, after, eigenLines };
}
