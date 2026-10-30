// Nuclear science: radioactive decay and the Bateman equations; binding energy and Q-values from atomic masses;
// attenuation and the inverse-square law; and one-group criticality of a bare reactor. Times are in seconds, decay
// constants in 1/s, lengths in meters for the window (the reactor works in any length unit, kept consistent).
import { fail } from '../kit/read';
import type { Particle } from './data';

const LN2 = Math.LN2;

/** The decay constant of a half-life. */
export const decayConstant = (halfLife: number): number => LN2 / halfLife;

/** The fraction left after time t: 2^(-t / T). */
export const remaining = (halfLife: number, t: number): number => 2 ** (-t / halfLife);

/** The time for the fraction left to fall to `fraction`: T log2(1 / fraction). */
export function timeToFraction(halfLife: number, fraction: number): number {
  if (!(fraction > 0 && fraction <= 1)) fail('kitPhysics.nuclear.errors.fraction');
  return -halfLife * Math.log2(fraction);
}

/**
 * The Bateman solution for a chain 1 -> 2 -> ... -> n with decay constants `lambdas` (0 for a stable last member) and
 * initial amounts `initial`: each member's amount at time t. Member n gets, from each member i at or before it,
 * N_i(0) (prod_{j=i}^{n-1} lambda_j) sum_{k=i}^{n} e^(-lambda_k t) / prod_{l != k} (lambda_l - lambda_k).
 */
export function bateman(lambdas: readonly number[], initial: readonly number[], t: number): number[] {
  if (lambdas.length !== initial.length || lambdas.length === 0) throw new Error('Mismatched chain');
  for (let i = 0; i < lambdas.length; i++)
    for (let j = i + 1; j < lambdas.length; j++)
      if (Math.abs(lambdas[i] - lambdas[j]) <= 1e-9 * Math.max(lambdas[i], lambdas[j]))
        fail('kitPhysics.nuclear.errors.sameConstant', { first: String(i + 1), second: String(j + 1) });
  return lambdas.map((_, n) => {
    let total = 0;
    for (let i = 0; i <= n; i++) {
      if (initial[i] === 0) continue;
      let feed = 1;
      for (let j = i; j < n; j++) feed *= lambdas[j];
      let sum = 0;
      for (let k = i; k <= n; k++) {
        let den = 1;
        for (let l = i; l <= n; l++) if (l !== k) den *= lambdas[l] - lambdas[k];
        sum += Math.exp(-lambdas[k] * t) / den;
      }
      total += initial[i] * feed * sum;
    }
    return total;
  });
}

/** When the daughter of a two-member chain peaks, starting from parent only. */
export function daughterPeak(lambdaA: number, lambdaB: number): number | null {
  if (!(lambdaA > 0 && lambdaB > 0) || lambdaA === lambdaB) return null;
  return Math.log(lambdaB / lambdaA) / (lambdaB - lambdaA);
}

export interface Binding {
  /** The mass defect, u. */
  defect: number;
  /** The binding energy, MeV. */
  energy: number;
  perNucleon: number;
  /** The mass of Z hydrogen atoms and N neutrons, u. */
  parts: number;
}

/** Binding energy from the atomic mass: B = (Z m(H-1) + N m_n - M) c². */
export function binding(Z: number, A: number, mass: number, mH: number, mN: number, uMeV: number): Binding {
  if (!Number.isInteger(Z) || !Number.isInteger(A) || Z < 0 || A < 1 || Z > A)
    fail('kitPhysics.nuclear.errors.nucleus');
  const parts = Z * mH + (A - Z) * mN;
  const defect = parts - mass;
  return { defect, energy: defect * uMeV, perNucleon: (defect * uMeV) / A, parts };
}

export interface QValue {
  /** Mass in minus mass out, u. */
  defect: number;
  /** MeV; positive releases energy. */
  q: number;
  massIn: number;
  massOut: number;
  zIn: number;
  zOut: number;
  aIn: number;
  aOut: number;
}

/** The Q-value of a reaction or decay from atomic masses: Q = (sum m_in - sum m_out) c². */
export function qValue(reactants: readonly Particle[], products: readonly Particle[], uMeV: number): QValue {
  const sum = (list: readonly Particle[], key: keyof Particle) => list.reduce((total, one) => total + one[key], 0);
  const out = {
    massIn: sum(reactants, 'mass'),
    massOut: sum(products, 'mass'),
    zIn: sum(reactants, 'Z'),
    zOut: sum(products, 'Z'),
    aIn: sum(reactants, 'A'),
    aOut: sum(products, 'A'),
  };
  if (out.zIn !== out.zOut) fail('kitPhysics.nuclear.errors.charge', { zIn: String(out.zIn), zOut: String(out.zOut) });
  if (out.aIn !== out.aOut)
    fail('kitPhysics.nuclear.errors.nucleons', { aIn: String(out.aIn), aOut: String(out.aOut) });
  const defect = out.massIn - out.massOut;
  return { ...out, defect, q: defect * uMeV };
}

export interface Attenuation {
  transmitted: number;
  hvl: number;
  tvl: number;
  mfp: number;
}

/** Narrow-beam attenuation through thickness x with linear coefficient mu: I / I0 = e^(-mu x). */
export function attenuate(mu: number, x: number): Attenuation {
  return { transmitted: Math.exp(-mu * x), hvl: LN2 / mu, tvl: Math.LN10 / mu, mfp: 1 / mu };
}

/** The macroscopic cross section Sigma = N sigma, with N = rho N_A / M atoms per volume. */
export const macroscopic = (sigma: number, density: number, molarMass: number, avogadro: number) =>
  ((density * avogadro) / molarMass) * sigma;

/** A point source's dose rate at r2 from the rate at r1: D2 = D1 (r1 / r2)². */
export const inverseSquare = (rate1: number, r1: number, r2: number): number => rate1 * (r1 / r2) ** 2;

export interface Factors {
  eta: number;
  epsilon: number;
  p: number;
  f: number;
  /** Fast and thermal non-leakage probabilities, for the six-factor formula. */
  fast?: number;
  thermal?: number;
}

/** k_inf = eta epsilon p f, and k_eff = k_inf P_FNL P_TNL when the non-leakage probabilities are given. */
export function multiplication(factors: Factors) {
  const kInf = factors.eta * factors.epsilon * factors.p * factors.f;
  const leak = (factors.fast ?? 1) * (factors.thermal ?? 1);
  return { kInf, kEff: kInf * leak, nonLeakage: leak };
}

export type Shape = 'sphere' | 'cube' | 'slab' | 'cylinder';

/** The first zero of J0, for a cylinder's radial buckling. */
export const J0_ZERO = 2.404825557695773;

/** Geometric buckling of a bare core of size `size` (radius, side, thickness, or radius with H = 2 ratio R). */
export function geometricBuckling(shape: Shape, size: number, ratio = 1): number {
  if (shape === 'sphere') return (Math.PI / size) ** 2;
  if (shape === 'cube') return 3 * (Math.PI / size) ** 2;
  if (shape === 'slab') return (Math.PI / size) ** 2;
  return (J0_ZERO / size) ** 2 + (Math.PI / (2 * ratio * size)) ** 2;
}

/** The critical size of a bare core: the size whose geometric buckling equals (k_inf - 1) / M². */
export function criticalSize(shape: Shape, kInf: number, m2: number, ratio = 1) {
  if (!(kInf > 1)) fail('kitPhysics.nuclear.errors.subcritical');
  const b2 = (kInf - 1) / m2;
  const B = Math.sqrt(b2);
  const size =
    shape === 'sphere'
      ? Math.PI / B
      : shape === 'cube'
        ? (Math.sqrt(3) * Math.PI) / B
        : shape === 'slab'
          ? Math.PI / B
          : Math.sqrt(J0_ZERO ** 2 + (Math.PI / (2 * ratio)) ** 2) / B;
  return { b2, size, volume: volume(shape, size, ratio) };
}

/** The volume of a core of that size; a slab has none (it is per unit area). */
export function volume(shape: Shape, size: number, ratio = 1): number | null {
  if (shape === 'sphere') return (4 / 3) * Math.PI * size ** 3;
  if (shape === 'cube') return size ** 3;
  if (shape === 'cylinder') return Math.PI * size * size * 2 * ratio * size;
  return null;
}

/** One-group k_eff of a bare core: k_inf / (1 + M² B_g²). */
export function kEffective(kInf: number, m2: number, b2: number) {
  const nonLeakage = 1 / (1 + m2 * b2);
  return { nonLeakage, kEff: kInf * nonLeakage };
}
