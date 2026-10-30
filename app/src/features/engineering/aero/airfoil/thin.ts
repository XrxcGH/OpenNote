// Thin airfoil theory: the camber line's slope, written in θ with x/c = (1 - cos θ)/2, gives the zero-lift angle and
// the Fourier coefficients A₀, A₁, A₂, and from them the lift and quarter-chord moment coefficients. The integrals
// are split where the slope has a kink and taken by Gauss-Legendre quadrature on each smooth piece.
import type { Section } from './geometry';

export interface ThinResult {
  /** Angles in radians. */
  readonly alphaL0: number;
  readonly alphaIdeal: number;
  readonly A0: number;
  readonly A1: number;
  readonly A2: number;
  readonly cl: number;
  readonly cmQuarter: number;
  readonly cmLE: number;
  /** Center of pressure over chord; undefined when there is no lift. */
  readonly xcp?: number;
  /** Where the kink sits in θ, for the steps. */
  readonly thetaKink: number;
}

/** Gauss-Legendre nodes and weights on [-1, 1], from Newton's method on the Legendre polynomial. */
function legendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 1;
    for (let iter = 0; iter < 100; iter += 1) {
      let [p0, p1] = [1, z];
      for (let k = 2; k <= n; k += 1) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k];
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}

const RULE = legendre(24);

/** ∫ f from a to b by 24-point Gauss-Legendre on four equal pieces: exact to rounding for these smooth integrands. */
export function quadrature(f: (x: number) => number, a: number, b: number, pieces = 4): number {
  let sum = 0;
  const h = (b - a) / pieces;
  for (let k = 0; k < pieces; k += 1) {
    const mid = a + (k + 0.5) * h;
    RULE.x.forEach((z, i) => {
      sum += RULE.w[i]! * f(mid + (h / 2) * z);
    });
  }
  return (sum * h) / 2;
}

/** ∫₀^π slope(x(θ)) g(θ) dθ, split at the kink so each piece is smooth. */
export function camberIntegral(section: Section, g: (theta: number) => number, thetaKink: number): number {
  const f = (theta: number) => section.slope(0.5 * (1 - Math.cos(theta))) * g(theta);
  if (thetaKink <= 0 || thetaKink >= Math.PI) return quadrature(f, 0, Math.PI);
  return quadrature(f, 0, thetaKink) + quadrature(f, thetaKink, Math.PI);
}

export function thinAirfoil(section: Section, alpha: number): ThinResult {
  const thetaKink = section.kink > 0 ? Math.acos(1 - 2 * section.kink) : 0;
  const I = (g: (theta: number) => number) => camberIntegral(section, g, thetaKink);
  // Adding zero turns the −0 a straight camber line gives into 0, so it never shows as “−0”.
  const alphaL0 = -I((theta) => Math.cos(theta) - 1) / Math.PI + 0;
  const alphaIdeal = I(() => 1) / Math.PI;
  const A1 = (2 / Math.PI) * I(Math.cos);
  const A2 = (2 / Math.PI) * I((theta) => Math.cos(2 * theta));
  const A0 = alpha - alphaIdeal;
  const cl = 2 * Math.PI * (alpha - alphaL0);
  const cmQuarter = (Math.PI / 4) * (A2 - A1) + 0;
  return {
    alphaL0,
    alphaIdeal,
    A0,
    A1,
    A2,
    cl,
    cmQuarter,
    cmLE: cmQuarter - cl / 4,
    ...(cl === 0 ? {} : { xcp: 0.25 - cmQuarter / cl }),
    thetaKink,
  };
}
