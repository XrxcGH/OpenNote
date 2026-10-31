// State-space design for ẋ = Ax + Bu, y = Cx + Du: controllability and observability, pole placement by
// Ackermann's formula, full-order observers by duality, the separation principle, integral action, and the linear
// quadratic regulator. The Riccati equation is solved by the matrix sign function of the Hamiltonian, refined by two
// Newton (Kleinman) steps and checked by its residual.
import { conjugateClosed } from '../lib/complexList';
import { ControlError, matTex } from '../lib/errors';
import {
  add,
  cols,
  det,
  eye,
  inv,
  lstsq,
  lyap,
  MatError,
  mul,
  norm1,
  normMax,
  rank,
  rows,
  scale,
  solve,
  transpose,
  zeros,
  type Mat,
  type ReadonlyMat,
} from '../lib/linalg';
import { eigenvalues, simulate } from '../lib/sim';
import { step, type Step } from '../lib/steps';
import { complexText, fmt, fmtTex, polyFromRoots, polyTex, type Complex, type SS } from '../lib/tf';

export const MAX_STATES = 8;

const list = (zs: readonly Complex[]) => zs.map((z) => complexText(z)).join(', ');

/** A matrix as LaTeX with six significant digits. */
export const matrixTex = (m: ReadonlyMat): string => matTex(m.map((row) => row.map((x) => fmtTex(tidyOf(x, m)))));

/** A matrix as text, rows split by semicolons: "[8, 4]" or "[1, 0; 0, 1]". */
export const matrixText = (m: ReadonlyMat): string =>
  `[${m.map((row) => row.map((x) => fmt(tidyOf(x, m))).join(', ')).join('; ')}]`;

/** Rounds entries that are round-off next to the matrix's largest one. */
function tidyOf(x: number, m: ReadonlyMat): number {
  return Math.abs(x) < 1e-12 * Math.max(1, normMax(m)) ? 0 : x;
}

/** Checks the shapes of A, B, C, and D; an empty D is taken as zero. */
export function makeSS(a: Mat, b: Mat, c: Mat, d: Mat | null): SS {
  const n = rows(a);
  if (cols(a) !== n) throw new ControlError('notSquare');
  if (n > MAX_STATES) throw new ControlError('tooManyStates', { max: String(MAX_STATES) });
  if (rows(b) !== n) throw new ControlError('bRows', { n: String(n) });
  if (cols(c) !== n) throw new ControlError('cCols', { n: String(n) });
  const dd = d ?? zeros(rows(c), cols(b));
  if (rows(dd) !== rows(c) || cols(dd) !== cols(b)) {
    throw new ControlError('dShape', { p: String(rows(c)), m: String(cols(b)) });
  }
  return { a, b, c, d: dd };
}

/** The controllability matrix [B, AB, …, Aⁿ⁻¹B]. */
export function ctrb(a: ReadonlyMat, b: ReadonlyMat): Mat {
  const blocks: Mat[] = [];
  let x: Mat = b.map((row) => [...row]);
  for (let k = 0; k < rows(a); k += 1) {
    blocks.push(x);
    x = mul(a, x);
  }
  return a.map((_, i) => blocks.flatMap((blk) => blk[i]));
}

/** The observability matrix [C; CA; …; CAⁿ⁻¹]. */
export const obsv = (a: ReadonlyMat, c: ReadonlyMat): Mat => transpose(ctrb(transpose(a), transpose(c)));

/** p(A) for a polynomial p with coefficients lowest power first, by Horner's rule. */
export function polyOfMatrix(p: readonly number[], a: ReadonlyMat): Mat {
  const n = rows(a);
  let out = scale(eye(n), p[p.length - 1] ?? 0);
  for (let k = p.length - 2; k >= 0; k -= 1) out = add(mul(out, a), scale(eye(n), p[k]));
  return out;
}

export interface Analysis {
  readonly ctrb: Mat;
  readonly obsv: Mat;
  readonly ctrbRank: number;
  readonly obsvRank: number;
  readonly poles: Complex[];
  readonly steps: Step[];
}

export function analyzeSS(ss: SS): Analysis {
  const n = rows(ss.a);
  const cm = ctrb(ss.a, ss.b);
  const om = obsv(ss.a, ss.c);
  const ctrbRank = rank(cm);
  const obsvRank = rank(om);
  const poles = eigenvalues(ss.a);
  const vars = (r: number) => ({ rank: String(r), n: String(n) });
  return {
    ctrb: cm,
    obsv: om,
    ctrbRank,
    obsvRank,
    poles,
    steps: [
      step('ss.ctrb', {}, `\\mathcal{C} = ${matrixTex(cm)}`),
      step(ctrbRank === n ? 'ss.ctrbFull' : 'ss.ctrbShort', vars(ctrbRank)),
      step('ss.obsv', {}, `\\mathcal{O} = ${matrixTex(om)}`),
      step(obsvRank === n ? 'ss.obsvFull' : 'ss.obsvShort', vars(obsvRank)),
      step('ss.eig', { poles: list(poles) }),
    ],
  };
}

function checkPoles(poles: readonly Complex[], n: number): void {
  if (poles.length !== n) throw new ControlError('polesCount', { n: String(n), given: String(poles.length) });
  if (!conjugateClosed(poles)) throw new ControlError('polesConjugate');
}

export interface Placement {
  readonly k: Mat;
  readonly closed: Complex[];
  readonly steps: Step[];
}

/**
 * Ackermann's formula K = [0 … 0 1] 𝒞⁻¹ α(A) for one input, where α is the desired characteristic polynomial.
 * `name` is the gain's symbol in the steps (K, or Lᵀ for an observer designed by duality).
 */
export function ackermann(a: ReadonlyMat, b: ReadonlyMat, poles: readonly Complex[], name = 'K'): Placement {
  const n = rows(a);
  if (cols(b) !== 1) throw new ControlError('singleInput');
  checkPoles(poles, n);
  const cm = ctrb(a, b);
  const r = rank(cm);
  if (r < n) throw new ControlError('uncontrollable', { rank: String(r), n: String(n) });
  const alpha = polyFromRoots(poles);
  const phi = polyOfMatrix(alpha, a);
  const en = zeros(n, 1);
  en[n - 1][0] = 1;
  const v = solve(transpose(cm), en); // 𝒞⁻ᵀ eₙ, so vᵀ = eₙᵀ 𝒞⁻¹
  const k = mul(transpose(v), phi);
  const closed = eigenvalues(add(a, mul(b, k), -1));
  return {
    k,
    closed,
    steps: [
      step('ss.ctrb', {}, `\\mathcal{C} = ${matrixTex(cm)}`),
      step('ss.desired', { poles: list(poles) }, `\\alpha(s) = ${polyTex(alpha)}`),
      step('ss.phi', {}, `\\alpha(A) = ${matrixTex(phi)}`),
      step(
        'ss.ackermann',
        {},
        `${name} = \\begin{bmatrix} 0 & \\cdots & 1 \\end{bmatrix} \\mathcal{C}^{-1} \\alpha(A) = ${matrixTex(k)}`,
      ),
    ],
  };
}

/** A full-order observer gain by duality: L = Kᵀ for the pair (Aᵀ, Cᵀ). */
export function observerGain(a: ReadonlyMat, c: ReadonlyMat, poles: readonly Complex[]): Placement {
  if (rows(c) !== 1) throw new ControlError('singleOutput');
  const n = rows(a);
  const r = rank(obsv(a, c));
  if (r < n) throw new ControlError('unobservable', { rank: String(r), n: String(n) });
  const dual = ackermann(transpose(a), transpose(c), poles, 'L^{T}');
  const l = transpose(dual.k);
  const closed = eigenvalues(add(a, mul(l, c), -1));
  return {
    k: l,
    closed,
    steps: [step('ss.duality'), ...dual.steps, step('ss.observerL', {}, `L = ${matrixTex(l)}`)],
  };
}

/** The augmented plant for integral action: the state z = ∫(r − y) dt joins x. */
export function augmentIntegral(ss: SS): { a: Mat; b: Mat } {
  if (rows(ss.c) !== 1) throw new ControlError('singleOutput');
  const n = rows(ss.a);
  const a = zeros(n + 1, n + 1);
  const b = zeros(n + 1, cols(ss.b));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) a[i][j] = ss.a[i][j];
    b[i] = [...ss.b[i]];
  }
  for (let j = 0; j < n; j += 1) a[n][j] = -ss.c[0][j];
  b[n] = ss.d[0].map((x) => -x);
  return { a, b };
}

export interface Response {
  readonly t: number[];
  readonly y: number[];
}

/** A time span that shows the slowest closed-loop pole settle. */
export function spanFor(poles: readonly Complex[]): number {
  const decay = poles.map((p) => Math.abs(p.re)).filter((x) => x > 1e-9);
  if (!decay.length) return 10;
  const t = 8 / Math.min(...decay);
  return Math.min(Math.max(t, 1e-3), 1e5);
}

/**
 * The unit step response of the loop u = −Kx + N r with N chosen for unit DC gain, or of the loop with integral
 * action u = −Kx + kᵢ ∫(r − y) dt. Returns null when the loop has no finite DC gain to scale by.
 */
export function stepResponse(
  ss: SS,
  k: ReadonlyMat,
  integral: boolean,
  span: number,
): (Response & { n: number }) | null {
  const n = rows(ss.a);
  const dk = mul(
    ss.d,
    k.map((row) => row.slice(0, n)),
  );
  if (integral) {
    const aug = augmentIntegral(ss);
    const acl = add(aug.a, mul(aug.b, k), -1);
    const br = zeros(n + 1, 1);
    br[n][0] = 1;
    const ccl = [
      [
        ...add(ss.c, dk, -1)[0],
        -mul(
          ss.d,
          k.map((row) => [row[n]]),
        )[0][0],
      ],
    ];
    const sim = simulate({ a: acl, b: br, c: ccl, d: [[0]] }, () => [1], span, 400);
    return { t: [...sim.t], y: sim.y.map((v) => v[0]), n: 1 };
  }
  const acl = add(ss.a, mul(ss.b, k), -1);
  const ccl = add(ss.c, dk, -1);
  let dcgain: number;
  try {
    dcgain = mul(mul(ccl, solve(scale(acl, -1), ss.b)), [[1]])[0][0] + ss.d[0][0];
  } catch {
    return null;
  }
  if (!Number.isFinite(dcgain) || Math.abs(dcgain) < 1e-12) return null;
  const nbar = 1 / dcgain;
  const sim = simulate({ a: acl, b: scale(ss.b, nbar), c: [ccl[0]], d: [[ss.d[0][0] * nbar]] }, () => [1], span, 400);
  return { t: [...sim.t], y: sim.y.map((v) => v[0]), n: nbar };
}

/**
 * The output from x(0) = x0 under u = −Kx, with the true state, and with the observer's estimate starting at zero.
 * In the coordinates (x, e = x − x̂) the loop is [[A − BK, BK], [0, A − LC]]: the separation principle.
 */
export function observerResponses(ss: SS, k: ReadonlyMat, l: ReadonlyMat, x0: readonly number[], span: number) {
  const n = rows(ss.a);
  const abk = add(ss.a, mul(ss.b, k), -1);
  const bk = mul(ss.b, k);
  const alc = add(ss.a, mul(l, ss.c), -1);
  const big = zeros(2 * n, 2 * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      big[i][j] = abk[i][j];
      big[i][n + j] = bk[i][j];
      big[n + i][n + j] = alc[i][j];
    }
  }
  const cBig = [[...add(ss.c, mul(ss.d, k), -1)[0], ...mul(ss.d, k)[0]]];
  const none = () => [0];
  const withObs = simulate({ a: big, b: zeros(2 * n, 1), c: cBig, d: [[0]] }, none, span, 400, [...x0, ...x0]);
  const full = simulate({ a: big, b: zeros(2 * n, 1), c: cBig, d: [[0]] }, none, span, 400, [
    ...x0,
    ...x0.map(() => 0),
  ]);
  return {
    t: [...withObs.t],
    withObserver: withObs.y.map((v) => v[0]),
    fullState: full.y.map((v) => v[0]),
    combined: big,
  };
}

/** R must be symmetric and positive definite: every leading minor positive. */
function checkWeights(q: ReadonlyMat, r: ReadonlyMat, n: number, m: number): void {
  if (rows(q) !== n || cols(q) !== n) throw new ControlError('qShape', { n: String(n) });
  if (rows(r) !== m || cols(r) !== m) throw new ControlError('rShape', { m: String(m) });
  const sym = (x: ReadonlyMat) =>
    x.every((row, i) => row.every((v, j) => Math.abs(v - x[j][i]) <= 1e-12 * (1 + Math.abs(v))));
  if (!sym(q)) throw new ControlError('qSymmetric');
  if (!sym(r)) throw new ControlError('rPositive');
  for (let k = 1; k <= m; k += 1) {
    if (!(det(r.slice(0, k).map((row) => row.slice(0, k))) > 0)) throw new ControlError('rPositive');
  }
  // Q ⪰ 0: no negative eigenvalue (the eigenvalues of a symmetric matrix are real).
  if (eigenvalues(q).some((e) => e.re < -1e-9 * Math.max(1, normMax(q)))) throw new ControlError('qNegative');
}

/** The matrix sign function by Newton's iteration with determinant scaling. */
function signOf(h: ReadonlyMat): Mat {
  const size = rows(h);
  let z: Mat = h.map((row) => [...row]);
  for (let it = 0; it < 100; it += 1) {
    let zi: Mat;
    try {
      zi = inv(z);
    } catch {
      throw new MatError('noConverge');
    }
    const dz = Math.abs(det(z));
    const c = dz > 0 && Number.isFinite(dz) ? dz ** (-1 / size) : 1;
    const next = scale(add(scale(z, c), scale(zi, 1 / c)), 0.5);
    const change = norm1(add(next, z, -1));
    z = next;
    if (!Number.isFinite(change)) break;
    if (change <= 1e-13 * norm1(z)) return z;
  }
  throw new MatError('noConverge');
}

export interface Lqr {
  readonly p: Mat;
  readonly k: Mat;
  readonly closed: Complex[];
  readonly residual: number;
  readonly steps: Step[];
}

const riccatiResidual = (a: ReadonlyMat, g: ReadonlyMat, q: ReadonlyMat, p: ReadonlyMat): number =>
  normMax(add(add(add(mul(transpose(a), p), mul(p, a)), mul(mul(p, g), p), -1), q)) /
  Math.max(1, normMax(q), normMax(p));

/** The regulator that minimizes ∫ (xᵀQx + uᵀRu) dt: K = R⁻¹BᵀP, with P the stabilizing solution of the CARE. */
export function lqr(a: ReadonlyMat, b: ReadonlyMat, q: ReadonlyMat, r: ReadonlyMat): Lqr {
  const n = rows(a);
  const m = cols(b);
  checkWeights(q, r, n, m);
  const rinv = inv(r);
  const g = mul(mul(b, rinv), transpose(b));
  const h = zeros(2 * n, 2 * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      h[i][j] = a[i][j];
      h[i][n + j] = -g[i][j];
      h[n + i][j] = -q[i][j];
      h[n + i][n + j] = -a[j][i];
    }
  }
  const w = signOf(h);
  // The stable subspace [I; P] satisfies (W + I)[I; P] = 0, so [W₁₂; W₂₂ + I] P = −[W₁₁ + I; W₂₁].
  const lhs = zeros(2 * n, n);
  const rhs = zeros(2 * n, n);
  for (let i = 0; i < 2 * n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      lhs[i][j] = w[i][n + j] + (i - n === j ? 1 : 0);
      rhs[i][j] = -(w[i][j] + (i === j ? 1 : 0));
    }
  }
  let p: Mat;
  try {
    p = lstsq(lhs, rhs);
  } catch {
    throw new MatError('noConverge');
  }
  const symmetric = (x: ReadonlyMat) => x.map((row, i) => row.map((v, j) => (v + x[j][i]) / 2));
  p = symmetric(p);
  // Newton (Kleinman) refinement: (A − GP)ᵀX + X(A − GP) + Q + PGP = 0.
  for (let it = 0; it < 2; it += 1) {
    const acl = add(a, mul(g, p), -1);
    try {
      p = symmetric(lyap(transpose(acl), add(q, mul(mul(p, g), p))));
    } catch {
      throw new MatError('noConverge');
    }
  }
  const k = mul(mul(rinv, transpose(b)), p);
  const closed = eigenvalues(add(a, mul(b, k), -1));
  const residual = riccatiResidual(a, g, q, p);
  if (!p.flat().every(Number.isFinite) || residual > 1e-6 || closed.some((z) => z.re >= -1e-9)) {
    throw new MatError('noConverge');
  }
  return {
    p,
    k,
    closed,
    residual,
    steps: [
      step('ss.lqrCost', {}, 'J = \\int_0^\\infty \\left(x^T Q x + u^T R u\\right) dt'),
      step('ss.riccati', {}, 'A^T P + P A - P B R^{-1} B^T P + Q = 0'),
      step(
        'ss.hamiltonian',
        {},
        `H = \\begin{bmatrix} A & -BR^{-1}B^T \\\\ -Q & -A^T \\end{bmatrix} = ${matrixTex(h)}`,
      ),
      step('ss.riccatiP', {}, `P = ${matrixTex(p)}`),
      step('ss.residual', { residual: residual.toExponential(1) }),
      step('ss.lqrK', {}, `K = R^{-1} B^T P = ${matrixTex(k)}`),
      step('ss.check', { poles: list(closed) }),
    ],
  };
}
