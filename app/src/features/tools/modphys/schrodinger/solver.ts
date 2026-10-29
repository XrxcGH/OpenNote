// The one-dimensional time-independent Schrödinger equation by second-order finite differences. The Hamiltonian is
// a symmetric tridiagonal matrix, so its lowest eigenvalues come from Sturm-sequence bisection and its eigenvectors
// from inverse iteration, in O(N) work each. Lengths are in nm and energies in eV.
import { GENERAL, compileNode, freeNames, mathConstant, standardFunctions, tryParse } from '../../../../core/expr';
import { C } from '../shared/constants';
import { fail } from '../shared/errors';

/** ħ²/(2mₑ) in eV nm². */
export const HB2M = (C.hbar ** 2 / (2 * C.me) / C.e) * 1e18;

/** The number of eigenvalues of the tridiagonal (d, e) below λ, by the Sturm sequence. */
function countBelow(d: Float64Array, e: number, lambda: number): number {
  let count = 0;
  let q = d[0]! - lambda;
  if (q < 0) count += 1;
  for (let i = 1; i < d.length; i += 1) {
    q = d[i]! - lambda - (e * e) / (q === 0 ? 1e-300 : q);
    if (q < 0) count += 1;
  }
  return count;
}

/** The k-th smallest eigenvalue (k from 0) of the tridiagonal (d, e), by bisection between Gershgorin bounds. */
function kthEigenvalue(d: Float64Array, e: number, k: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of d) {
    lo = Math.min(lo, x - 2 * Math.abs(e));
    hi = Math.max(hi, x + 2 * Math.abs(e));
  }
  for (let it = 0; it < 200 && hi - lo > 1e-14 * Math.max(1, Math.abs(lo) + Math.abs(hi)); it += 1) {
    const mid = (lo + hi) / 2;
    if (countBelow(d, e, mid) > k) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Solves (T − λ) y = b for the tridiagonal T = (d, e) by the Thomas algorithm. */
function solveShifted(d: Float64Array, e: number, lambda: number, b: Float64Array): Float64Array {
  const n = d.length;
  const c = new Float64Array(n);
  const y = new Float64Array(n);
  let m = d[0]! - lambda || 1e-300;
  c[0] = e / m;
  y[0] = b[0]! / m;
  for (let i = 1; i < n; i += 1) {
    m = d[i]! - lambda - e * c[i - 1]! || 1e-300;
    c[i] = e / m;
    y[i] = (b[i]! - e * y[i - 1]!) / m;
  }
  for (let i = n - 2; i >= 0; i -= 1) y[i] -= c[i]! * y[i + 1]!;
  return y;
}

export interface Grid {
  /** Interior points; the wavefunction is zero just outside them. */
  x: Float64Array;
  h: number;
}

export function grid(lo: number, hi: number, n: number): Grid {
  if (!(hi > lo) || !Number.isInteger(n) || n < 50 || n > 20000) fail('badGrid');
  const h = (hi - lo) / (n + 1);
  return { x: Float64Array.from({ length: n }, (_, i) => lo + (i + 1) * h), h };
}

export interface State {
  energy: number;
  /** Normalized so that Σ ψ² h = 1, with ψ in nm^(−1/2). */
  psi: Float64Array;
}

/** The lowest `count` states of −(ħ²/2m) ψ'' + V ψ = E ψ, with m given as a multiple of mₑ. */
export function eigenstates(g: Grid, v: Float64Array, massRatio: number, count: number): State[] {
  const t = HB2M / massRatio / (g.h * g.h);
  const d = Float64Array.from(v, (one) => one + 2 * t);
  const e = -t;
  const out: State[] = [];
  for (let k = 0; k < count; k += 1) {
    const energy = kthEigenvalue(d, e, k);
    // Inverse iteration from a fixed start, shifted just off the eigenvalue.
    let y: Float64Array = Float64Array.from(d, (_, i) => 1 + 0.001 * Math.sin(i * 0.7));
    const shift = energy + 1e-10 * Math.max(1, Math.abs(energy));
    for (let it = 0; it < 3; it += 1) {
      y = solveShifted(d, e, shift, y);
      const norm = Math.sqrt(y.reduce((s, one) => s + one * one, 0));
      for (let i = 0; i < y.length; i += 1) y[i] /= norm;
    }
    const scale = 1 / Math.sqrt(g.h);
    // Make the first large lobe positive so that plots and tests are stable.
    const first = y.find((one) => Math.abs(one) > 1e-3) ?? 1;
    const sign = first < 0 ? -1 : 1;
    out.push({ energy, psi: Float64Array.from(y, (one) => one * scale * sign) });
  }
  return out;
}

export interface Expectation {
  x: number;
  x2: number;
  dx: number;
  /** ⟨p²⟩/ħ² in nm⁻², from the kinetic energy E − ⟨V⟩. */
  p2: number;
  product: number;
  kinetic: number;
}

export function expectation(g: Grid, v: Float64Array, s: State, massRatio: number): Expectation {
  let x = 0;
  let x2 = 0;
  let pv = 0;
  for (let i = 0; i < g.x.length; i += 1) {
    const w = s.psi[i]! ** 2 * g.h;
    x += g.x[i]! * w;
    x2 += g.x[i]! ** 2 * w;
    pv += v[i]! * w;
  }
  const kinetic = s.energy - pv;
  const p2 = (kinetic * massRatio) / HB2M;
  const dx = Math.sqrt(Math.max(0, x2 - x * x));
  return { x, x2, dx, p2, product: dx * Math.sqrt(p2), kinetic };
}

/** The probability of finding the particle in the region from x = a to x = b. */
export function probabilityIn(g: Grid, s: State, a: number, b: number): number {
  let sum = 0;
  for (let i = 0; i < g.x.length; i += 1) if (g.x[i]! >= a && g.x[i]! <= b) sum += s.psi[i]! ** 2 * g.h;
  return sum;
}

const TABLE = standardFunctions('strict');

/** A potential V(x) typed as an expression in x (nm) giving eV; it never runs as code. */
export function typedPotential(source: string): (x: number) => number {
  const parsed = tryParse(source, GENERAL);
  if (!parsed.ok) fail('badPotential');
  for (const name of freeNames(parsed.value))
    if (name !== 'x' && mathConstant(name) === undefined) fail('badPotential');
  let run: (x: number) => number;
  try {
    run = compileNode<number>(parsed.value, {
      strict: false,
      table: TABLE,
      bind: (name) => {
        if (name === 'x') return (x: number) => x;
        const value = mathConstant(name);
        return value === undefined ? undefined : () => value;
      },
    });
  } catch {
    fail('badPotential');
  }
  return (x: number) => {
    const y = run(x);
    if (!Number.isFinite(y)) fail('badPotential');
    return y;
  };
}
