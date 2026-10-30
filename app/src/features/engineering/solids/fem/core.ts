// The direct stiffness method, shared by every problem of the finite element tool: element matrices scattered into
// the global matrix by each element's degrees of freedom, the supported freedoms removed, the reduced system solved
// densely, and the reactions recovered. Natural frequencies come from K φ = ω² M φ, by Cholesky reduction to a
// standard symmetric problem.
import { symmetricEigen } from '../kit/numeric';
import { fail } from '../kit/types';

export interface Placed {
  /** The global degrees of freedom of the element's own, in order. */
  readonly dofs: readonly number[];
  readonly k: readonly (readonly number[])[];
  readonly m?: readonly (readonly number[])[];
  /** Loads the element puts on its nodes, such as a heat source. */
  readonly f?: readonly number[];
}

export const zeros = (n: number): number[][] => [...Array(n)].map(() => new Array<number>(n).fill(0));

export function assemble(size: number, elements: readonly Placed[], mass = false) {
  const K = zeros(size);
  const M = mass ? zeros(size) : undefined;
  const F = new Array<number>(size).fill(0);
  for (const e of elements) {
    e.dofs.forEach((I, a) => {
      e.dofs.forEach((J, b) => {
        K[I][J] += e.k[a][b];
        if (M && e.m) M[I][J] += e.m[a][b];
      });
      if (e.f) F[I] += e.f[a];
    });
  }
  return { K, M, F };
}

/**
 * Solves the symmetric system A x = b by Cholesky factoring within A's band, which a mesh numbered row by row keeps
 * narrow, then one step of refinement. Returns null when A is not positive definite: a pivot that falls to rounding
 * size against its diagonal means the model can move without straining.
 */
export function solveBanded(A: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  let w = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i - w; j++)
      if (A[i][j] !== 0) {
        w = i - j;
        break;
      }
  const L = new Float64Array(n * (w + 1));
  const at = (i: number, j: number) => i * (w + 1) + (i - j);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - w);
    for (let j = j0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = Math.max(j0, j - w); k < j; k++) sum -= L[at(i, k)] * L[at(j, k)];
      if (i !== j) L[at(i, j)] = sum / L[at(j, j)];
      else if (sum > 1e-11 * Math.abs(A[i][i])) L[at(i, i)] = Math.sqrt(sum);
      else return null;
    }
  }
  const solve = (rhs: readonly number[]) => {
    const x = [...rhs];
    for (let i = 0; i < n; i++) {
      for (let k = Math.max(0, i - w); k < i; k++) x[i] -= L[at(i, k)] * x[k];
      x[i] /= L[at(i, i)];
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let k = i + 1; k <= Math.min(n - 1, i + w); k++) x[i] -= L[at(k, i)] * x[k];
      x[i] /= L[at(i, i)];
    }
    return x;
  };
  const x = solve(b);
  const fix = solve(b.map((value, i) => value - A[i].reduce((sum, a, j) => sum + a * x[j], 0)));
  return x.map((value, i) => value + fix[i]);
}

/** Solves K u = F with the listed freedoms held at zero (or at a set value). */
export function solveHeld(K: readonly (readonly number[])[], F: readonly number[], held: ReadonlyMap<number, number>) {
  const size = K.length;
  const free = [...Array(size).keys()].filter((d) => !held.has(d));
  if (free.length === 0) fail('noFreedom');
  const u = new Array<number>(size).fill(0);
  held.forEach((value, d) => (u[d] = value));
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const rhs = free.map((r) => F[r] - [...held].reduce((sum, [d, value]) => sum + K[r][d] * value, 0));
  const solved = solveBanded(Kff, rhs);
  if (!solved) fail('mechanism');
  free.forEach((d, i) => (u[d] = solved[i]));
  // A mechanism can slip through elimination with a pivot of rounding size; check the answer against the loads,
  // counting what the held values push onto the free freedoms (a wall held at two temperatures has no load at all).
  const scale = Math.max(...K.map((row, r) => Math.abs(row[r])), 1e-300);
  if (
    u.some((value) => !Number.isFinite(value)) ||
    Math.max(...u.map(Math.abs)) * scale >
      1e14 * Math.max(...F.map(Math.abs), ...rhs.map(Math.abs), 1e-300) * (1 + size)
  )
    fail('mechanism');
  const reactions = new Map<number, number>();
  held.forEach((_, d) => reactions.set(d, K[d].reduce((sum, value, c) => sum + value * u[c], 0) - F[d]));
  return { u, reactions, free };
}

/** The lower Cholesky factor of a symmetric positive definite matrix. */
function cholesky(A: readonly (readonly number[])[]): number[][] {
  const n = A.length;
  const L = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 0)) fail('mechanism');
        L[i][i] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  }
  return L;
}

/** Solves L x = b (or Lᵀ x = b) by substitution. */
function triangular(L: number[][], b: readonly number[], transpose: boolean): number[] {
  const n = L.length;
  const x = [...b];
  if (!transpose) {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < i; k++) x[i] -= L[i][k] * x[k];
      x[i] /= L[i][i];
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      for (let k = i + 1; k < n; k++) x[i] -= L[k][i] * x[k];
      x[i] /= L[i][i];
    }
  }
  return x;
}

/** The natural frequencies (rad/s, lowest first) and mode shapes of K φ = ω² M φ on the free freedoms. */
export function modes(K: readonly (readonly number[])[], M: readonly (readonly number[])[], free: readonly number[]) {
  const Kf = free.map((r) => free.map((c) => K[r][c]));
  const Mf = free.map((r) => free.map((c) => M[r][c]));
  const L = cholesky(Mf);
  const n = free.length;
  // A = L⁻¹ K L⁻ᵀ, column by column.
  const X = [...Array(n).keys()].map((c) =>
    triangular(
      L,
      Kf.map((row) => row[c]),
      false,
    ),
  );
  const A = [...Array(n).keys()].map((r) =>
    triangular(
      L,
      X.map((col) => col[r]),
      false,
    ),
  );
  const sym = A.map((row, r) => row.map((value, c) => (value + A[c][r]) / 2));
  const { values, vectors } = symmetricEigen(sym);
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  return order.map(({ value, i }) => {
    const y = vectors.map((row) => row[i]);
    const phi = triangular(L, y, true);
    const peak = phi.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0) || 1;
    return { omega: Math.sqrt(Math.max(value, 0)), shape: phi.map((v) => v / peak) };
  });
}
