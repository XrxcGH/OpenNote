// Radiation heat transfer: blackbody emission (Stefan-Boltzmann, Wien, Planck, band fractions), view factors from
// published closed forms, exchange between two gray surfaces, radiation shields, and an N-surface gray enclosure
// solved by the radiosity method. Temperatures in kelvin, SI throughout.
import { fmt, need, nonNegative, positive, SIGMA, sq, type Step } from '../numeric';

/** Planck's second radiation constant h c / k (m K), from the exact SI constants. */
export const C2 = (6.62607015e-34 * 299792458) / 1.380649e-23;
/** Planck's first constant 2 pi h c^2 (W m^2). */
export const C1 = 2 * Math.PI * 6.62607015e-34 * 299792458 ** 2;
/** Wien's displacement constant (m K). */
export const WIEN = 2.897771955e-3;

/** Spectral emissive power of a blackbody (W/m2 per m of wavelength). */
export function planck(lambda: number, t: number): number {
  positive(lambda, 'The wavelength');
  positive(t, 'The temperature');
  const x = C2 / (lambda * t);
  return C1 / (lambda ** 5 * Math.expm1(x));
}

/** Fraction of blackbody emission between wavelength 0 and lambda at temperature t. */
export function bandFractionTo(lambda: number, t: number): number {
  const z = C2 / (lambda * t);
  if (z < 2) {
    // Series about lambda T = infinity (complement form).
    const s = 1 / 3 - z / 8 + z ** 2 / 60 - z ** 4 / 5040 + z ** 6 / 272160 - z ** 8 / 13305600;
    return 1 - (15 / Math.PI ** 4) * z ** 3 * s;
  }
  let sum = 0;
  for (let n = 1; n <= 400; n++) {
    const term = (Math.exp(-n * z) / n) * (z ** 3 + (3 * z ** 2) / n + (6 * z) / n ** 2 + 6 / n ** 3);
    sum += term;
    if (term < 1e-18 * sum) break;
  }
  return (15 / Math.PI ** 4) * sum;
}

export interface BlackbodyResult {
  emissive: number;
  peak: number;
  /** Fraction of the emission between lambda1 and lambda2, when both were given. */
  fraction?: number;
  /** Spectral emissive power at lambda1, when only that was given. */
  spectral?: number;
  steps: Step[];
}

export function blackbody(t: number, lambda1?: number, lambda2?: number): BlackbodyResult {
  positive(t, 'The temperature');
  const eb = SIGMA * t ** 4;
  const peak = WIEN / t;
  const steps: Step[] = [
    {
      key: 'fhRadEb',
      vars: { e: fmt(eb) },
      math: `E_b = \\sigma T^4 = ${fmt(SIGMA)}\\cdot${fmt(t)}^4 = ${fmt(eb)}\\ \\mathrm{W/m^2}`,
    },
    {
      key: 'fhRadWien',
      vars: { l: fmt(peak * 1e6) },
      math: `\\lambda_{max} = \\frac{2897.77\\ \\mu\\mathrm{m\\,K}}{T} = ${fmt(peak * 1e6)}\\ \\mu\\mathrm{m}`,
    },
  ];
  const out: BlackbodyResult = { emissive: eb, peak, steps };
  const has1 = lambda1 !== undefined && Number.isFinite(lambda1);
  const has2 = lambda2 !== undefined && Number.isFinite(lambda2);
  if (has1) positive(lambda1!, 'The first wavelength');
  if (has2) positive(lambda2!, 'The second wavelength');
  if (has1 && has2) {
    need(lambda2! > lambda1!, 'band', 'The second wavelength must be longer than the first.');
    const f = bandFractionTo(lambda2!, t) - bandFractionTo(lambda1!, t);
    out.fraction = f;
    steps.push({
      key: 'fhRadBand',
      vars: { f: fmt(f) },
      math: `F_{\\lambda_1-\\lambda_2} = F_{0-\\lambda_2T} - F_{0-\\lambda_1T} = ${fmt(bandFractionTo(lambda2!, t))} - ${fmt(bandFractionTo(lambda1!, t))} = ${fmt(f)}`,
    });
  } else if (has1) {
    out.spectral = planck(lambda1!, t);
    steps.push({
      key: 'fhRadPlanck',
      vars: { e: fmt(out.spectral) },
      math: `E_{\\lambda,b} = \\frac{C_1}{\\lambda^5\\,(e^{C_2/\\lambda T}-1)} = ${fmt(out.spectral)}\\ \\mathrm{W/m^2\\,m}`,
    });
  }
  return out;
}

/** The Planck curve for plotting: wavelengths (m) and spectral power. */
export function planckCurve(t: number, points = 120): [number, number][] {
  positive(t, 'The temperature');
  const peak = WIEN / t;
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const lambda = peak * (0.2 + (i / (points - 1)) * 5.8);
    out.push([lambda, planck(lambda, t)]);
  }
  return out;
}

// View factors -------------------------------------------------------------------------------------------------

export interface ViewFactorResult {
  f12: number;
  f21: number;
  steps: Step[];
}

/** Coaxial parallel disks of radii r1 and r2 a distance h apart. */
export function disks(r1: number, r2: number, h: number): ViewFactorResult {
  positive(r1, 'The first radius');
  positive(r2, 'The second radius');
  positive(h, 'The separation');
  const R1 = r1 / h;
  const R2 = r2 / h;
  const S = 1 + (1 + R2 ** 2) / R1 ** 2;
  const f12 = 0.5 * (S - Math.sqrt(S * S - 4 * (R2 / R1) ** 2));
  const f21 = (f12 * r1 ** 2) / r2 ** 2;
  return {
    f12,
    f21,
    steps: [
      {
        key: 'fhRadDisks',
        vars: { f: fmt(f12) },
        math: `S = 1 + \\frac{1+R_2^2}{R_1^2} = ${fmt(S)},\\quad F_{12} = \\frac12\\left[S - \\sqrt{S^2 - 4(R_2/R_1)^2}\\right] = ${fmt(f12)}`,
      },
      { key: 'fhRadRecip', vars: { f: fmt(f21) }, math: `F_{21} = F_{12}\\frac{A_1}{A_2} = ${fmt(f21)}` },
    ],
  };
}

/** Identical aligned parallel rectangles x by y, a distance l apart. */
export function parallelRectangles(x: number, y: number, l: number): ViewFactorResult {
  positive(x, 'The width');
  positive(y, 'The length');
  positive(l, 'The separation');
  const X = x / l;
  const Y = y / l;
  const a = Math.sqrt(1 + X * X);
  const b = Math.sqrt(1 + Y * Y);
  const f12 =
    (2 / (Math.PI * X * Y)) *
    (Math.log(Math.sqrt(((1 + X * X) * (1 + Y * Y)) / (1 + X * X + Y * Y))) +
      X * b * Math.atan(X / b) +
      Y * a * Math.atan(Y / a) -
      X * Math.atan(X) -
      Y * Math.atan(Y));
  return {
    f12,
    f21: f12,
    steps: [
      {
        key: 'fhRadRect',
        vars: { f: fmt(f12) },
        math: `\\bar X = ${fmt(X)},\\ \\bar Y = ${fmt(Y)},\\quad F_{12} = F_{21} = ${fmt(f12)}`,
      },
    ],
  };
}

/** Perpendicular rectangles with a common edge of length x: surface 1 is x by y, surface 2 is x by z. */
export function perpendicularRectangles(x: number, y: number, z: number): ViewFactorResult {
  positive(x, 'The common edge');
  positive(y, 'The width of surface 1');
  positive(z, 'The width of surface 2');
  const H = z / x;
  const W = y / x;
  const h2 = H * H;
  const w2 = W * W;
  const f12 =
    (1 / (Math.PI * W)) *
    (W * Math.atan(1 / W) +
      H * Math.atan(1 / H) -
      Math.sqrt(h2 + w2) * Math.atan(1 / Math.sqrt(h2 + w2)) +
      0.25 *
        Math.log(
          (((1 + w2) * (1 + h2)) / (1 + w2 + h2)) *
            ((w2 * (1 + w2 + h2)) / ((1 + w2) * (w2 + h2))) ** w2 *
            ((h2 * (1 + h2 + w2)) / ((1 + h2) * (h2 + w2))) ** h2,
        ));
  const f21 = (f12 * y) / z;
  return {
    f12,
    f21,
    steps: [
      {
        key: 'fhRadPerp',
        vars: { f: fmt(f12) },
        math: `H = z/x = ${fmt(H)},\\ W = y/x = ${fmt(W)},\\quad F_{12} = ${fmt(f12)}`,
      },
      { key: 'fhRadRecip', vars: { f: fmt(f21) }, math: `F_{21} = F_{12}\\frac{A_1}{A_2} = ${fmt(f21)}` },
    ],
  };
}

/** Long concentric cylinders or concentric spheres, inner radius r1 and outer r2. */
export function concentric(shape: 'cylinder' | 'sphere', r1: number, r2: number): ViewFactorResult {
  positive(r1, 'The inner radius');
  positive(r2, 'The outer radius');
  need(r2 > r1, 'radius', 'The outer radius must be larger than the inner radius.');
  const f21 = shape === 'cylinder' ? r1 / r2 : (r1 / r2) ** 2;
  return {
    f12: 1,
    f21,
    steps: [
      {
        key: 'fhRadConcentric',
        vars: { f: fmt(f21) },
        math: `F_{12} = 1,\\quad F_{21} = \\frac{A_1}{A_2} = ${fmt(f21)}`,
      },
    ],
  };
}

// Exchange between surfaces ----------------------------------------------------------------------------------------

export interface TwoSurfaceInput {
  t1: number;
  t2: number;
  e1: number;
  e2: number;
  a1: number;
  /** View factor F12. For an enclosure of a convex surface 1 inside surface 2 this is 1. */
  f12: number;
  a2: number;
}

export interface TwoSurfaceResult {
  q12: number;
  flux1: number;
  rs: { surface1: number; space: number; surface2: number };
  steps: Step[];
}

/** Net radiation from surface 1 to surface 2 (W), when they exchange only with each other. */
export function twoSurfaces(inp: TwoSurfaceInput): TwoSurfaceResult {
  positive(inp.t1, 'The first temperature');
  positive(inp.t2, 'The second temperature');
  need(
    inp.e1 > 0 && inp.e1 <= 1 && inp.e2 > 0 && inp.e2 <= 1,
    'emissivity',
    'Each emissivity must be above 0 and at most 1.',
  );
  positive(inp.a1, 'The first area');
  positive(inp.a2, 'The second area');
  need(inp.f12 > 0 && inp.f12 <= 1, 'viewFactor', 'The view factor F12 must be above 0 and at most 1.');
  const r1 = (1 - inp.e1) / (inp.a1 * inp.e1);
  const rs = 1 / (inp.a1 * inp.f12);
  const r2 = (1 - inp.e2) / (inp.a2 * inp.e2);
  const eb1 = SIGMA * inp.t1 ** 4;
  const eb2 = SIGMA * inp.t2 ** 4;
  const q = (eb1 - eb2) / (r1 + rs + r2);
  return {
    q12: q,
    flux1: q / inp.a1,
    rs: { surface1: r1, space: rs, surface2: r2 },
    steps: [
      {
        key: 'fhRadEbs',
        vars: { e1: fmt(eb1), e2: fmt(eb2) },
        math: `E_{b1} = \\sigma T_1^4 = ${fmt(eb1)},\\quad E_{b2} = \\sigma T_2^4 = ${fmt(eb2)}\\ \\mathrm{W/m^2}`,
      },
      {
        key: 'fhRadResistances',
        vars: { r1: fmt(r1), rs: fmt(rs), r2: fmt(r2) },
        math: `R_1 = \\frac{1-\\varepsilon_1}{A_1\\varepsilon_1} = ${fmt(r1)},\\ R_{12} = \\frac{1}{A_1F_{12}} = ${fmt(rs)},\\ R_2 = \\frac{1-\\varepsilon_2}{A_2\\varepsilon_2} = ${fmt(r2)}\\ \\mathrm{m^{-2}}`,
      },
      {
        key: 'fhRadQ',
        vars: { q: fmt(q) },
        math: `q_{12} = \\frac{E_{b1} - E_{b2}}{R_1 + R_{12} + R_2} = ${fmt(q)}\\ \\mathrm{W}`,
      },
    ],
  };
}

export interface ShieldInput {
  t1: number;
  t2: number;
  e1: number;
  e2: number;
  /** Emissivity of both faces of each shield. */
  eShield: number;
  count: number;
}

export interface ShieldResult {
  flux: number;
  withoutShields: number;
  reduction: number;
  /** Shield temperatures from surface 1 towards surface 2 (K). */
  shieldTemperatures: number[];
  steps: Step[];
}

/** Large parallel plates with n thin shields between them (heat flux per unit area, W/m2). */
export function shields(inp: ShieldInput): ShieldResult {
  positive(inp.t1, 'The first temperature');
  positive(inp.t2, 'The second temperature');
  need(
    inp.e1 > 0 && inp.e1 <= 1 && inp.e2 > 0 && inp.e2 <= 1 && inp.eShield > 0 && inp.eShield <= 1,
    'emissivity',
    'Each emissivity must be above 0 and at most 1.',
  );
  need(
    Number.isInteger(inp.count) && inp.count >= 0 && inp.count <= 50,
    'count',
    'The number of shields must be a whole number from 0 to 50.',
  );
  const gapFirst = 1 / inp.e1 + 1 / inp.eShield - 1;
  const gapMid = 2 / inp.eShield - 1;
  const gapLast = 1 / inp.eShield + 1 / inp.e2 - 1;
  const without = (SIGMA * (inp.t1 ** 4 - inp.t2 ** 4)) / (1 / inp.e1 + 1 / inp.e2 - 1);
  const gaps =
    inp.count === 0 ? [1 / inp.e1 + 1 / inp.e2 - 1] : [gapFirst, ...Array<number>(inp.count - 1).fill(gapMid), gapLast];
  const total = gaps.reduce((a, b) => a + b, 0);
  const flux = (SIGMA * (inp.t1 ** 4 - inp.t2 ** 4)) / total;
  const temps: number[] = [];
  let t4 = inp.t1 ** 4;
  for (let i = 0; i < inp.count; i++) {
    t4 -= (flux * gaps[i]) / SIGMA;
    temps.push(Math.sqrt(Math.sqrt(Math.max(t4, 0))));
  }
  return {
    flux,
    withoutShields: without,
    reduction: without === 0 ? 0 : flux / without,
    shieldTemperatures: temps,
    steps: [
      {
        key: 'fhRadShieldNo',
        vars: { q: fmt(without) },
        math: `q_0 = \\frac{\\sigma(T_1^4 - T_2^4)}{1/\\varepsilon_1 + 1/\\varepsilon_2 - 1} = ${fmt(without)}\\ \\mathrm{W/m^2}`,
      },
      {
        key: 'fhRadShield',
        vars: { q: fmt(flux), n: String(inp.count) },
        math: `q = \\frac{\\sigma(T_1^4 - T_2^4)}{\\sum_k (1/\\varepsilon_a + 1/\\varepsilon_b - 1)} = \\frac{${fmt(SIGMA * (inp.t1 ** 4 - inp.t2 ** 4))}}{${fmt(total)}} = ${fmt(flux)}\\ \\mathrm{W/m^2}`,
      },
      ...temps.map((t, i) => ({
        key: 'fhRadShieldT',
        vars: { i: String(i + 1), t: fmt(t) },
        math: `T_{s${i + 1}} = ${fmt(t)}\\ \\mathrm{K}`,
      })),
    ],
  };
}

export interface EnclosureSurface {
  area: number;
  emissivity: number;
  /** Temperature (K). */
  t: number;
}

export interface EnclosureResult {
  /** Net heat leaving each surface (W); positive when the surface loses heat. */
  q: number[];
  radiosity: number[];
  emissive: number[];
  /** Largest violation of the summation rule (sum_j F_ij = 1) and of reciprocity (A_i F_ij = A_j F_ji). */
  summationError: number;
  reciprocityError: number;
  steps: Step[];
}

/** Gray diffuse enclosure of N isothermal surfaces with a given view-factor matrix F[i][j]. */
export function enclosure(surfaces: EnclosureSurface[], f: number[][]): EnclosureResult {
  const n = surfaces.length;
  need(n >= 2, 'surfaces', 'An enclosure needs at least two surfaces.');
  need(f.length === n && f.every((r) => r.length === n), 'matrix', `The view-factor matrix must be ${n} by ${n}.`);
  surfaces.forEach((s, i) => {
    positive(s.area, `The area of surface ${i + 1}`);
    positive(s.t, `The temperature of surface ${i + 1}`);
    need(
      s.emissivity > 0 && s.emissivity <= 1,
      'emissivity',
      `The emissivity of surface ${i + 1} must be above 0 and at most 1.`,
    );
  });
  let summation = 0;
  let reciprocity = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      need(
        f[i][j] >= 0 && f[i][j] <= 1 && Number.isFinite(f[i][j]),
        'viewFactor',
        `The view factor F${i + 1}${j + 1} must be between 0 and 1.`,
      );
      sum += f[i][j];
      reciprocity = Math.max(
        reciprocity,
        Math.abs(surfaces[i].area * f[i][j] - surfaces[j].area * f[j][i]) /
          Math.max(surfaces[i].area, surfaces[j].area),
      );
    }
    summation = Math.max(summation, Math.abs(sum - 1));
  }
  need(summation < 1e-3, 'summation', 'Each row of view factors must add to 1 for a closed enclosure.');
  const eb = surfaces.map((s) => SIGMA * s.t ** 4);
  // J_i - (1 - e_i) sum_j F_ij J_j = e_i Eb_i
  const A = surfaces.map((s, i) => f[i].map((fij, j) => (i === j ? 1 : 0) - (1 - s.emissivity) * fij));
  const b = surfaces.map((s, i) => s.emissivity * eb[i]);
  const j = solveLinear(A, b);
  const q = surfaces.map((s, i) => s.area * (j[i] - f[i].reduce((acc, fij, k) => acc + fij * j[k], 0)));
  const total = q.reduce((a, c) => a + c, 0);
  return {
    q,
    radiosity: j,
    emissive: eb,
    summationError: summation,
    reciprocityError: reciprocity,
    steps: [
      {
        key: 'fhRadRadiosity',
        vars: { n: String(n) },
        math: `J_i - (1-\\varepsilon_i)\\sum_j F_{ij}J_j = \\varepsilon_i E_{b,i}`,
      },
      {
        key: 'fhRadNet',
        vars: { sum: fmt(total) },
        math: `q_i = A_i\\left(J_i - \\sum_j F_{ij}J_j\\right),\\quad \\sum q_i = ${fmt(total)}\\ \\mathrm{W}`,
      },
    ],
  };
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    need(Math.abs(m[p][c]) > 1e-14, 'singular', 'The enclosure equations are singular. Check the view factors.');
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Surface exchange with a linearised radiation coefficient is in the conduction engine; this is the large-plate flux. */
export function parallelPlates(t1: number, t2: number, e1: number, e2: number): number {
  nonNegative(t1, 'The first temperature');
  nonNegative(t2, 'The second temperature');
  need(e1 > 0 && e1 <= 1 && e2 > 0 && e2 <= 1, 'emissivity', 'Each emissivity must be above 0 and at most 1.');
  return (SIGMA * (sq(sq(t1)) - sq(sq(t2)))) / (1 / e1 + 1 / e2 - 1);
}
