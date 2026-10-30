// Finite wings by Prandtl's lifting-line theory: the Glauert monoplane equation with N odd sine terms on a symmetric
// wing, collocated at theta_i = i pi/(2N) and solved by LU. The planform is straight-tapered or elliptic, with linear
// twist from root to tip. One section lift slope and one zero-lift angle hold across the span. Incompressible, unswept.
import { AeroError, DEG, eq, finite, luSolve, num, positive, step, tex, type AeroStep, type XY } from '../common';

export type Planform = 'tapered' | 'elliptic';

export interface WingInput {
  /** Span, m. */
  readonly span: number;
  /** Planform area, m^2. */
  readonly area: number;
  readonly planform: Planform;
  /** Tip chord over root chord (tapered planform). */
  readonly taper: number;
  /** Geometric twist of the tip relative to the root, degrees (washout is negative). */
  readonly twist: number;
  /** Section lift slope, per rad. */
  readonly a0: number;
  /** Section zero-lift angle, degrees. */
  readonly alphaL0: number;
  /** Root angle of attack, degrees. */
  readonly alpha: number;
  /** Number of odd sine terms (default 40). */
  readonly terms?: number;
  /** Optional flight condition for forces: speed m/s and density kg/m^3. */
  readonly V?: number;
  readonly rho?: number;
}

export interface WingResult {
  readonly AR: number;
  readonly CL: number;
  readonly CDi: number;
  readonly e: number;
  readonly delta: number;
  /** Wing lift slope dCL/dalpha, per rad. */
  readonly a: number;
  /** Wing zero-lift angle at the root, degrees (differs from the section value when twisted). */
  readonly alphaL0Wing: number;
  readonly A: readonly number[];
  readonly terms: number;
  readonly lift?: number;
  readonly drag?: number;
  readonly steps: readonly AeroStep[];
  /** Section lift coefficient and the load cl c / (CL c_mean) against 2y/b, and the elliptic load for comparison. */
  readonly plot: { readonly cl: readonly XY[]; readonly load: readonly XY[]; readonly elliptic: readonly XY[] };
}

interface Geometry {
  readonly chord: (theta: number) => number;
  readonly AR: number;
  readonly b: number;
}

function geometry(input: WingInput): Geometry {
  const b = positive(input.span, 'b');
  const S = positive(input.area, 'S');
  const AR = (b * b) / S;
  if (input.planform === 'elliptic') {
    const c0 = (4 * S) / (Math.PI * b);
    return { chord: (t) => c0 * Math.sin(t), AR, b };
  }
  const lambda = finite(input.taper, 'λ');
  if (lambda < 0 || lambda > 1) throw new AeroError('taperRange');
  const cr = (2 * S) / (b * (1 + lambda));
  return { chord: (t) => cr * (1 - (1 - lambda) * Math.abs(Math.cos(t))), AR, b };
}

/** Solves the monoplane equation for the odd coefficients A_1, A_3, ... given alpha - alphaL0 at each station. */
function solve(geo: Geometry, a0: number, N: number, alphaEff: (theta: number) => number): number[] {
  const M: number[][] = [];
  const rhs: number[] = [];
  for (let i = 1; i <= N; i += 1) {
    const t = (i * Math.PI) / (2 * N);
    const mu = (a0 * geo.chord(t)) / (4 * geo.b);
    const st = Math.sin(t);
    const row: number[] = [];
    for (let j = 0; j < N; j += 1) {
      const n = 2 * j + 1;
      row.push(Math.sin(n * t) * (n * mu + st));
    }
    M.push(row);
    rhs.push(mu * alphaEff(t) * st);
  }
  return luSolve(M, rhs);
}

export function wing(input: WingInput): WingResult {
  const geo = geometry(input);
  const a0 = positive(input.a0, 'a₀');
  const alpha = finite(input.alpha, 'α') * DEG;
  const aL0 = finite(input.alphaL0, 'α_{L0}') * DEG;
  const twist = finite(input.twist, 'ε_t') * DEG;
  const N = Math.round(input.terms ?? 40);
  if (!(N >= 2 && N <= 200)) throw new AeroError('termsRange');
  if (geo.AR > 100) throw new AeroError('aspectRange');
  // Twist grows linearly from the root (theta = pi/2) to the tips (theta = 0, pi).
  const twistAt = (t: number) => twist * Math.abs(Math.cos(t));
  const A = solve(geo, a0, N, (t) => alpha + twistAt(t) - aL0);
  const unit = solve(geo, a0, N, () => 1);
  const { AR } = geo;
  const CL = Math.PI * AR * A[0]!;
  const slope = Math.PI * AR * unit[0]!;
  const alphaL0Wing = alpha - CL / slope;
  // delta from the solution, or from the untwisted unit solution when the lift is zero.
  const ref = Math.abs(A[0]!) > 1e-12 ? A : unit;
  let delta = 0;
  for (let j = 1; j < N; j += 1) delta += (2 * j + 1) * Math.pow(ref[j]! / ref[0]!, 2);
  let sum = 0;
  for (let j = 0; j < N; j += 1) sum += (2 * j + 1) * A[j]! * A[j]!;
  const CDi = Math.PI * AR * sum;
  const e = 1 / (1 + delta);
  const steps: AeroStep[] = [
    step(
      'wgMonoplane',
      eq(
        '\\alpha(\\theta_0) - \\alpha_{L0}',
        '\\frac{4b}{a_0 c(\\theta_0)}\\sum_{n\\ odd} A_n \\sin n\\theta_0 + \\sum_{n\\ odd} n A_n \\frac{\\sin n\\theta_0}{\\sin\\theta_0}',
      ),
      {
        N: String(N),
        AR: num(AR, 5),
      },
    ),
    step('wgA1', `A_1 = ${tex(A[0]!, 6)}, \\quad A_3 = ${tex(A[1]!, 5)}, \\quad A_5 = ${tex(A[2] ?? 0, 5)}`),
    step('wgCL', `C_L = \\pi\\,AR\\,A_1 = \\pi \\times ${tex(AR, 5)} \\times ${tex(A[0]!, 6)} = ${tex(CL, 5)}`),
    step(
      'wgDelta',
      eq(
        '\\delta',
        '\\sum_{n \\ge 3} n\\left(\\frac{A_n}{A_1}\\right)^2',
        `${tex(delta, 5)}, \\quad e`,
        '\\frac{1}{1 + \\delta}',
        `${tex(e, 5)}`,
      ),
    ),
    step(
      'wgCDi',
      eq(
        'C_{D,i}',
        '\\frac{C_L^2}{\\pi\\,AR}(1 + \\delta)',
        `\\frac{${tex(CL, 5)}^2}{\\pi \\times ${tex(AR, 5)}}(1 + ${tex(delta, 4)})`,
        `${tex(CDi, 5)}`,
      ),
    ),
    step(
      'wgSlope',
      eq(
        'a',
        '\\frac{dC_L}{d\\alpha}',
        `${tex(slope, 5)}\\ \\text{per rad}`,
        `${tex(slope * DEG, 5)}\\ \\text{per deg}; \\quad \\frac{a_0}{1 + a_0/(\\pi\\,AR)}`,
        `${tex(a0 / (1 + a0 / (Math.PI * AR)), 5)}`,
      ),
    ),
  ];
  let lift: number | undefined;
  let drag: number | undefined;
  if (input.V !== undefined && input.rho !== undefined && Number.isFinite(input.V) && Number.isFinite(input.rho)) {
    const q = 0.5 * positive(input.rho, 'ρ') * Math.pow(positive(input.V, 'V'), 2);
    lift = q * input.area * CL;
    drag = q * input.area * CDi;
    steps.push(
      step(
        'wgForces',
        `L = q S C_L = ${tex(lift, 5)}\\ \\text{N}, \\quad D_i = q S C_{D,i} = ${tex(drag, 5)}\\ \\text{N}`,
        { q: num(q, 5) },
      ),
    );
  }
  return {
    AR,
    CL,
    CDi,
    e,
    delta,
    a: slope,
    alphaL0Wing: alphaL0Wing / DEG,
    A,
    terms: N,
    ...(lift === undefined ? {} : { lift, drag }),
    steps,
    plot: distribution(geo, A, CL, input.area),
  };
}

function distribution(geo: Geometry, A: readonly number[], CL: number, S: number) {
  const cl: XY[] = [];
  const load: XY[] = [];
  const elliptic: XY[] = [];
  const cMean = S / geo.b;
  for (let i = 0; i <= 100; i += 1) {
    const t = (i * Math.PI) / 100;
    const y = -Math.cos(t);
    let sum = 0;
    A.forEach((An, j) => (sum += An * Math.sin((2 * j + 1) * t)));
    // Gamma / (b V) = 2 sum; local cl c = 2 Gamma / V.
    const clc = 4 * geo.b * sum;
    const c = geo.chord(t);
    cl.push({ x: y, y: c > 1e-12 ? clc / c : NaN });
    load.push({ x: y, y: Math.abs(CL) > 1e-12 ? clc / (CL * cMean) : 0 });
    elliptic.push({ x: y, y: (4 / Math.PI) * Math.sin(t) });
  }
  return { cl, load, elliptic };
}
