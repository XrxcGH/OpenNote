// Cubic equations of state in one general form, p = RT/(v − b) − a(T)/((v + δ₁b)(v + δ₂b)), per mole in SI units
// (Pa, m³/mol, J/mol). Van der Waals has δ₁ = δ₂ = 0, Redlich-Kwong and Soave δ₁ = 1 and δ₂ = 0, and Peng-Robinson
// δ = 1 ± √2. Departure functions and the fugacity coefficient come from the residual Helmholtz energy of that
// form, so all four equations share one derivation.
import { cubicRoots } from '../common/num';
import { ThermoError } from '../common/types';
import { RU } from '../data/nasa';

export type EosId = 'vdw' | 'rk' | 'srk' | 'pr';

export interface EosParams {
  eos: EosId;
  /** a(T), Pa m⁶/mol². */
  a: number;
  /** da/dT, Pa m⁶/(mol² K). */
  dadT: number;
  /** b, m³/mol. */
  b: number;
  d1: number;
  d2: number;
  /** The critical-point value of a(T), and the κ and α of the temperature function where the equation has one. */
  ac: number;
  kappa: number | null;
  alpha: number;
}

const SQRT2 = Math.SQRT2;
/** Redlich-Kwong's Ω constants, exact from the critical conditions. */
const RK_OMEGA_A = 1 / (9 * (2 ** (1 / 3) - 1));
const RK_OMEGA_B = (2 ** (1 / 3) - 1) / 3;
/**
 * Peng-Robinson's Ω constants to full precision (textbooks round them to 0.45724 and 0.07780). The critical point
 * is a triple root of the cubic, so the rounded values would split it, moving Z by about 0.014.
 */
const PR_OMEGA_A = 0.4572355289213822;
const PR_OMEGA_B = 0.07779607390388846;

/** a(T), b, and the form's δ for an equation, from Tc (K), pc (Pa), and the acentric factor. */
export function eosParams(eos: EosId, T: number, Tc: number, pcPa: number, omega: number): EosParams {
  const Tr = T / Tc;
  const R2Tc2 = (RU * Tc) ** 2;
  if (eos === 'vdw') {
    const a = (27 * R2Tc2) / (64 * pcPa);
    return { eos, a, dadT: 0, b: (RU * Tc) / (8 * pcPa), d1: 0, d2: 0, ac: a, kappa: null, alpha: 1 };
  }
  if (eos === 'rk') {
    const ac = (RK_OMEGA_A * R2Tc2) / pcPa;
    const a = ac / Math.sqrt(Tr);
    return {
      eos,
      a,
      dadT: -a / (2 * T),
      b: (RK_OMEGA_B * RU * Tc) / pcPa,
      d1: 1,
      d2: 0,
      ac,
      kappa: null,
      alpha: 1 / Math.sqrt(Tr),
    };
  }
  // Soave (1972) and Peng and Robinson (1976): α = [1 + κ(1 − √Tr)]², with κ from the acentric factor.
  const pr = eos === 'pr';
  const kappa = pr ? 0.37464 + 1.54226 * omega - 0.26992 * omega * omega : 0.48 + 1.574 * omega - 0.176 * omega * omega;
  const ac = ((pr ? PR_OMEGA_A : RK_OMEGA_A) * R2Tc2) / pcPa;
  const root = 1 + kappa * (1 - Math.sqrt(Tr));
  const alpha = root * root;
  const dadT = (-ac * kappa * root) / Math.sqrt(T * Tc);
  const b = ((pr ? PR_OMEGA_B : RK_OMEGA_B) * RU * Tc) / pcPa;
  return {
    eos,
    a: ac * alpha,
    dadT,
    b,
    d1: pr ? 1 + SQRT2 : 1,
    d2: pr ? 1 - SQRT2 : 0,
    ac,
    kappa,
    alpha,
  };
}

/** Pressure (Pa) at T (K) and molar volume v (m³/mol). */
export function eosPressure(e: EosParams, T: number, v: number): number {
  return (RU * T) / (v - e.b) - e.a / ((v + e.d1 * e.b) * (v + e.d2 * e.b));
}

/** The cubic in Z as [c₂, c₁, c₀] of Z³ + c₂Z² + c₁Z + c₀ = 0, with A = a p/(RT)² and B = b p/(RT). */
export function cubicInZ(e: EosParams, A: number, B: number): [number, number, number] {
  const u = e.d1 + e.d2;
  const w = e.d1 * e.d2;
  return [(u - 1) * B - 1, A + (w - u) * B * B - u * B, -(A * B + w * B * B + w * B * B * B)];
}

/** (1/(b(δ₁ − δ₂))) ln((v + δ₁b)/(v + δ₂b)), the integral every residual property shares; 1/v for van der Waals. */
function shared(e: EosParams, v: number): number {
  if (e.d1 === e.d2) return 1 / v;
  return Math.log((v + e.d1 * e.b) / (v + e.d2 * e.b)) / (e.b * (e.d1 - e.d2));
}

export interface Residual {
  /** h − h_ideal at the same T and p, J/mol. */
  h: number;
  /** s − s_ideal at the same T and p, J/(mol K). */
  s: number;
  /** ln of the fugacity coefficient. */
  lnPhi: number;
}

/** Residual enthalpy, entropy, and fugacity coefficient at T, molar volume v, and the Z = pv/(RT) it gives. */
export function residual(e: EosParams, T: number, v: number, Z: number): Residual {
  const I = shared(e, v);
  const B = (Z * e.b) / v;
  return {
    h: RU * T * (Z - 1) + (T * e.dadT - e.a) * I,
    s: RU * Math.log(Z - B) + e.dadT * I,
    lnPhi: Z - 1 - Math.log(Z - B) - (e.a / (RU * T)) * I,
  };
}

export type RootChoice = 'stable' | 'gas' | 'liquid';

export interface RootPick {
  /** Every real root above B, smallest first. */
  roots: number[];
  Z: number;
  /** Why this root: the only one, the lower fugacity, or the one asked for. */
  why: 'only' | 'stableGas' | 'stableLiquid' | 'asked';
  /** ln φ of the smallest and largest roots, when there are three. */
  lnPhiLiquid?: number;
  lnPhiGas?: number;
}

/** Z at T (K) and p (Pa): the real roots of the cubic above B, and the one to use. */
export function solveZ(e: EosParams, T: number, pPa: number, choice: RootChoice): RootPick {
  const A = (e.a * pPa) / (RU * T) ** 2;
  const B = (e.b * pPa) / (RU * T);
  const [c2, c1, c0] = cubicInZ(e, A, B);
  const roots = cubicRoots(c2, c1, c0).filter((Z) => Z > B);
  if (!roots.length) throw new ThermoError('noRoot');
  if (roots.length === 1) return { roots, Z: roots[0], why: 'only' };
  const liquid = roots[0];
  const gas = roots[roots.length - 1];
  const phi = (Z: number) => residual(e, T, (Z * RU * T) / pPa, Z).lnPhi;
  const lnPhiLiquid = phi(liquid);
  const lnPhiGas = phi(gas);
  if (choice === 'gas') return { roots, Z: gas, why: 'asked', lnPhiLiquid, lnPhiGas };
  if (choice === 'liquid') return { roots, Z: liquid, why: 'asked', lnPhiLiquid, lnPhiGas };
  return lnPhiGas <= lnPhiLiquid
    ? { roots, Z: gas, why: 'stableGas', lnPhiLiquid, lnPhiGas }
    : { roots, Z: liquid, why: 'stableLiquid', lnPhiLiquid, lnPhiGas };
}
