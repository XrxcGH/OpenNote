// Numerical integration for the kits. Adaptive Gauss-Kronrod 7-15 (the rule of QUADPACK, a public-domain library)
// splits the interval with the largest error estimate until the total is within tolerance. Infinite limits are mapped
// onto finite ones. Gauss-Legendre nodes and weights for n up to 20 show the rule itself.
import { NumError } from './errors';

/** Kronrod nodes on [0, 1]: the odd ones (1, 3, 5) are also the 7-point Gauss nodes, with 0 last. */
const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945, 0.5860872354676911,
  0.4058451513773972, 0.20778495500789848, 0,
];
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592, 0.1690047266392679,
  0.19035057806478542, 0.20443294007529889, 0.20948214108472782,
];
/** The 7-point Gauss weights for XGK[1], XGK[3], XGK[5], and 0. */
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];

interface Piece {
  a: number;
  b: number;
  value: number;
  error: number;
}

function gk15(f: (x: number) => number, a: number, b: number): Piece {
  const center = (a + b) / 2;
  const half = (b - a) / 2;
  const fc = f(center);
  let kronrod = fc * WGK[7];
  let gauss = fc * WG[3];
  for (let j = 0; j < 7; j += 1) {
    const dx = half * XGK[j];
    const sum = f(center - dx) + f(center + dx);
    kronrod += WGK[j] * sum;
    if (j % 2 === 1) gauss += WG[(j - 1) / 2] * sum;
  }
  const value = kronrod * half;
  return { a, b, value, error: Math.abs((kronrod - gauss) * half) };
}

export interface QuadResult {
  value: number;
  /** The estimated absolute error. */
  error: number;
  /** How many pieces the interval ended in. */
  pieces: number;
  evaluations: number;
}

export interface QuadOptions {
  atol?: number;
  rtol?: number;
  maxPieces?: number;
}

/**
 * ∫ f(x) dx from a to b by adaptive Gauss-Kronrod. Either limit may be ±Infinity: [a, ∞) maps by x = a + t/(1-t),
 * and (-∞, ∞) by x = t/(1-t²). Throws 'noConvergence' when the tolerance is not met within maxPieces.
 */
export function integrate(f: (x: number) => number, a: number, b: number, options: QuadOptions = {}): QuadResult {
  if (Number.isNaN(a) || Number.isNaN(b)) throw new NumError('notFinite');
  if (a === b) return { value: 0, error: 0, pieces: 0, evaluations: 0 };
  if (a > b) {
    const flipped = integrate(f, b, a, options);
    return { ...flipped, value: -flipped.value };
  }
  if (a === -Infinity && b === Infinity) {
    return finite((t) => f(t / (1 - t * t)) * ((1 + t * t) / (1 - t * t) ** 2), -1, 1, options);
  }
  if (b === Infinity) return finite((t) => f(a + t / (1 - t)) / (1 - t) ** 2, 0, 1, options);
  if (a === -Infinity) return finite((t) => f(b - t / (1 - t)) / (1 - t) ** 2, 0, 1, options);
  return finite(f, a, b, options);
}

function finite(f: (x: number) => number, a: number, b: number, options: QuadOptions): QuadResult {
  const atol = options.atol ?? 1e-12;
  const rtol = options.rtol ?? 1e-10;
  const maxPieces = options.maxPieces ?? 2000;
  const pieces: Piece[] = [gk15(f, a, b)];
  let evaluations = 15;
  for (;;) {
    const value = pieces.reduce((s, p) => s + p.value, 0);
    const error = pieces.reduce((s, p) => s + p.error, 0);
    if (!Number.isFinite(value)) throw new NumError('notFinite', 'the integrand is not finite');
    if (error <= Math.max(atol, rtol * Math.abs(value))) return { value, error, pieces: pieces.length, evaluations };
    if (pieces.length >= maxPieces) throw new NumError('noConvergence', `estimated error ${error}`);
    let worst = 0;
    for (let i = 1; i < pieces.length; i += 1) if (pieces[i].error > pieces[worst].error) worst = i;
    const { a: lo, b: hi } = pieces[worst];
    const mid = (lo + hi) / 2;
    if (mid <= lo || mid >= hi) return { value, error, pieces: pieces.length, evaluations };
    pieces.splice(worst, 1, gk15(f, lo, mid), gk15(f, mid, hi));
    evaluations += 30;
  }
}

/** Gauss-Legendre nodes and weights on [-1, 1] for n = 1 to 20, nodes in ascending order. */
export function gaussLegendre(n: number): { nodes: number[]; weights: number[] } {
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new NumError('domain', 'n must be a whole number from 1 to 20');
  const nodes = new Array<number>(n).fill(0);
  const weights = new Array<number>(n).fill(0);
  for (let i = 0; i < Math.ceil(n / 2); i += 1) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    for (let iter = 0; iter < 100; iter += 1) {
      const [p, d] = legendre(n, z);
      const dz = p / d;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    const dp = legendre(n, z)[1];
    nodes[i] = -z;
    nodes[n - 1 - i] = z;
    weights[i] = 2 / ((1 - z * z) * dp * dp);
    weights[n - 1 - i] = weights[i];
  }
  return { nodes, weights };
}

/** P_n(z) and P_n'(z) by the three-term recurrence. */
function legendre(n: number, z: number): [number, number] {
  let p0 = 1;
  let p1 = z;
  if (n === 0) return [1, 0];
  for (let k = 2; k <= n; k += 1) {
    const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
    p0 = p1;
    p1 = p2;
  }
  return [p1, (n * (z * p1 - p0)) / (z * z - 1)];
}

/** ∫ f from a to b by the n-point Gauss-Legendre rule. */
export function gaussIntegrate(f: (x: number) => number, a: number, b: number, n: number): number {
  const { nodes, weights } = gaussLegendre(n);
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  return half * nodes.reduce((sum, x, i) => sum + weights[i] * f(mid + half * x), 0);
}
