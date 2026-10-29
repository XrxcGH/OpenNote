// Liquid water for the fluids, heat-transfer, and aero kits, from public IAPWS formulations. Density, cp, and
// enthalpy come from IAPWS-IF97 region 1 (the industrial formulation, 273.15 to 623.15 K, up to 100 MPa). The
// saturation pressure comes from IAPWS-IF97 region 4. Viscosity follows IAPWS R12-08 without its critical term,
// which matters only within a few kelvins of 647 K. Thermal conductivity follows IAPWS R15-11 with its critical
// enhancement λ₂, which is broad: it adds about 1% to saturated liquid at 300 °C. λ₂ takes cp, cv, and the
// compressibility from IF97 region 1, and the reference compressibility from the IF97 option of R15-11.
//
// Each formulation reproduces the check values its release publishes (see props.test.ts).
import { NumError } from '../num/errors';

export const WATER_SOURCE =
  'IAPWS-IF97 region 1 and 4 (density, cp, saturation pressure); ' +
  'IAPWS R12-08 (viscosity, without the critical term) and R15-11 (thermal conductivity, with it)';

const R = 461.526; // J/(kg·K), IF97
const T_CRIT = 647.096;
const RHO_CRIT = 322;

const I1 = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 8, 8, 21, 23, 29, 30, 31, 32];
const J1 = [
  -2, -1, 0, 1, 2, 3, 4, 5, -9, -7, -1, 0, 1, 3, -3, 0, 1, 3, 17, -4, 0, 6, -5, -2, 10, -8, -11, -6, -29, -31, -38, -39,
  -40, -41,
];
const N1 = [
  0.14632971213167, -0.84548187169114, -3.756360367204, 3.3855169168385, -0.95791963387872, 0.15772038513228,
  -0.016616417199501, 8.1214629983568e-4, 2.8319080123804e-4, -6.0706301565874e-4, -0.018990068218419,
  -0.032529748770505, -0.021841717175414, -5.283835796993e-5, -4.7184321073267e-4, -3.0001780793026e-4,
  4.7661393906987e-5, -4.4141845330846e-6, -7.2694996297594e-16, -3.1679644845054e-5, -2.8270797985312e-6,
  -8.5205128120103e-10, -2.2425281908e-6, -6.5171222895601e-7, -1.4341729937924e-13, -4.0516996860117e-7,
  -1.2734301741641e-9, -1.7424871230634e-10, -6.8762131295531e-19, 1.4478307828521e-20, 2.6335781662795e-23,
  -1.1947622640071e-23, 1.8228094581404e-24, -9.3537087292458e-26,
];
const N4 = [
  0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.1202082470247e5, -0.32325550322333e7,
  0.1491510861353e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3,
];

/** The saturation pressure of water in Pa, for 273.15 K ≤ T ≤ 647.096 K (IF97 region 4). */
export function waterSaturationPressure(T: number): number {
  if (!(T >= 273.15 && T <= T_CRIT)) throw new NumError('domain', 'saturation needs 273.15 K ≤ T ≤ 647.096 K');
  const theta = T + N4[8] / (T - N4[9]);
  const a = theta * theta + N4[0] * theta + N4[1];
  const b = N4[2] * theta * theta + N4[3] * theta + N4[4];
  const c = N4[5] * theta * theta + N4[6] * theta + N4[7];
  return ((2 * c) / (-b + Math.sqrt(b * b - 4 * a * c))) ** 4 * 1e6;
}

interface Region1 {
  /** m³/kg */
  v: number;
  /** J/kg */
  h: number;
  /** J/(kg·K) */
  cp: number;
  /** J/(kg·K) */
  cv: number;
  /** (∂ρ/∂p) at constant T, s²/m² */
  drhodp: number;
}

/** IF97 region 1 at T (K) and p (Pa), from the Gibbs energy γ(π, τ) and its derivatives. */
function region1(T: number, p: number): Region1 {
  const pi = p / 16.53e6;
  const tau = 1386 / T;
  let gp = 0;
  let gpp = 0;
  let gpt = 0;
  let gt = 0;
  let gtt = 0;
  for (let i = 0; i < 34; i += 1) {
    const a = (7.1 - pi) ** I1[i];
    const b = (tau - 1.222) ** J1[i];
    gp -= (N1[i] * I1[i] * a * b) / (7.1 - pi);
    gpp += (N1[i] * I1[i] * (I1[i] - 1) * a * b) / (7.1 - pi) ** 2;
    gpt -= (N1[i] * I1[i] * J1[i] * a * b) / ((7.1 - pi) * (tau - 1.222));
    gt += (N1[i] * a * J1[i] * b) / (tau - 1.222);
    gtt += (N1[i] * a * J1[i] * (J1[i] - 1) * b) / (tau - 1.222) ** 2;
  }
  const v = (R * T * pi * gp) / p;
  // κ_T = -(1/v)(∂v/∂p)_T = -π γ_ππ / (p γ_π), and (∂ρ/∂p)_T = ρ κ_T.
  const kappaT = (-pi * gpp) / (p * gp);
  return {
    v,
    h: R * T * tau * gt,
    cp: -R * tau * tau * gtt,
    cv: R * (-tau * tau * gtt + (gp - tau * gpt) ** 2 / gpp),
    drhodp: kappaT / v,
  };
}

const H0 = [1.67752, 2.20462, 0.6366564, -0.241605];
const H1: readonly (readonly number[])[] = [
  [5.20094e-1, 2.22531e-1, -2.81378e-1, 1.61913e-1, -3.25372e-2, 0, 0],
  [8.50895e-2, 9.99115e-1, -9.06851e-1, 2.57399e-1, 0, 0, 0],
  [-1.08374, 1.88797, -7.72479e-1, 0, 0, 0, 0],
  [-2.89555e-1, 1.26613, -4.89837e-1, 0, 6.98452e-2, 0, -4.35673e-3],
  [0, 0, -2.5704e-1, 0, 0, 8.72102e-3, 0],
  [0, 1.20573e-1, 0, 0, 0, 0, -5.93264e-4],
];
const L0 = [2.443221e-3, 1.323095e-2, 6.770357e-3, -3.454586e-3, 4.096266e-4];
const L1: readonly (readonly number[])[] = [
  [1.60397357, -0.646013523, 0.111443906, 0.102997357, -0.0504123634, 0.00609859258],
  [2.33771842, -2.78843778, 1.53616167, -0.463045512, 0.0832827019, -0.00719201245],
  [2.19650529, -4.54580785, 3.55777244, -1.40944978, 0.275418278, -0.0205938816],
  [-1.21051378, 1.60812989, -0.621178141, 0.0716373224, 0, 0],
  [-2.720337, 4.57586331, -3.18369245, 1.1168348, -0.19268305, 0.012913842],
];

/** Σᵢ (1/T̄ - 1)^i Σⱼ c_ij (ρ̄ - 1)^j, the residual sum both transport releases share. */
function residualSum(c: readonly (readonly number[])[], tBar: number, rhoBar: number): number {
  let sum = 0;
  c.forEach((row, i) => {
    const inner = row.reduce((s, cij, j) => s + cij * (rhoBar - 1) ** j, 0);
    sum += (1 / tBar - 1) ** i * inner;
  });
  return sum;
}

/** Viscosity in Pa·s from T (K) and density (kg/m³), IAPWS R12-08 without the critical term. */
export function waterViscosity(T: number, rho: number): number {
  const tBar = T / T_CRIT;
  const rhoBar = rho / RHO_CRIT;
  const mu0 = (100 * Math.sqrt(tBar)) / H0.reduce((s, h, i) => s + h / tBar ** i, 0);
  return mu0 * Math.exp(rhoBar * residualSum(H1, tBar, rhoBar)) * 1e-6;
}

/**
 * The background thermal conductivity λ₀·λ₁ in W/(m·K) from T (K) and density (kg/m³), IAPWS R15-11 without the
 * critical enhancement; the release's check values (its Table 4) are for this part.
 */
export function waterConductivity(T: number, rho: number): number {
  const tBar = T / T_CRIT;
  const rhoBar = rho / RHO_CRIT;
  const k0 = Math.sqrt(tBar) / L0.reduce((s, l, i) => s + l / tBar ** i, 0);
  return k0 * Math.exp(rhoBar * residualSum(L1, tBar, rhoBar)) * 1e-3;
}

/** R15-11 Table 6: 1/ζ(T̄_R, ρ̄) = Σ aᵢ ρ̄ⁱ on five density ranges, for use with IF97 instead of IAPWS-95. */
const ZETA_REF_BOUNDS = [0.310559006, 0.776397516, 1.242236025, 1.863354037, Infinity];
const ZETA_REF: readonly (readonly number[])[] = [
  [6.53786807199516, -5.61149954923348, 3.39624167361325, -2.27492629730878, 10.2631854662709, 1.97815050331519],
  [6.52717759281799, -6.30816983387575, 8.08379285492595, -9.82240510197603, 12.1358413791395, -5.54349664571295],
  [5.35500529896124, -3.96415689925446, 8.91990208918795, -12.033872950579, 9.19494865194302, -2.16866274479712],
  [1.55225959906681, 0.464621290821181, 8.93237374861479, -11.0321960061126, 6.1678099993336, -0.965458722086812],
  [1.11999926419994, 0.595748562571649, 9.8895256507892, -10.325505114704, 4.66861294457414, -0.503243546373828],
];

/** What the critical enhancement needs besides T and ρ, all in SI units. */
export interface ConductivityState {
  cp: number;
  cv: number;
  /** (∂ρ/∂p) at constant T, s²/m² */
  drhodp: number;
  /** viscosity, Pa·s */
  mu: number;
}

/** The critical enhancement λ₂ of IAPWS R15-11 (its eqs. 15 to 20) in W/(m·K). */
export function waterConductivityEnhancement(T: number, rho: number, state: ConductivityState): number {
  const tBar = T / T_CRIT;
  const rhoBar = rho / RHO_CRIT;
  const zeta = state.drhodp * (22.064e6 / RHO_CRIT);
  const a = ZETA_REF[ZETA_REF_BOUNDS.findIndex((bound) => rhoBar <= bound)];
  const zetaRef = 1 / a.reduce((s, ai, i) => s + ai * rhoBar ** i, 0);
  const dChi = rhoBar * (zeta - (zetaRef * 1.5) / tBar);
  if (!(dChi > 0)) return 0;
  // ξ = ξ₀ (Δχ̄/Γ₀)^(ν/γ) with ξ₀ = 0.13 nm, Γ₀ = 0.06, ν = 0.630, γ = 1.239; y = q̄_D ξ with 1/q̄_D = 0.40 nm.
  const y = (0.13 / 0.4) * (dChi / 0.06) ** (0.63 / 1.239);
  if (y < 1.2e-7) return 0;
  const kappa = state.cp / state.cv;
  const z =
    (2 / (Math.PI * y)) *
    ((1 - 1 / kappa) * Math.atan(y) + y / kappa - (1 - Math.exp(-1 / (1 / y + (y * y) / (3 * rhoBar * rhoBar)))));
  const cpBar = state.cp / 461.51805;
  const muBar = state.mu / 1e-6;
  return ((177.8514 * rhoBar * cpBar * tBar) / muBar) * z * 1e-3;
}

export interface LiquidWater {
  /** K */
  T: number;
  /** Pa */
  p: number;
  /** kg/m³ */
  rho: number;
  /** J/(kg·K) */
  cp: number;
  /** J/kg, zero for the liquid at the triple point */
  h: number;
  /** Pa·s */
  mu: number;
  /** W/(m·K) */
  k: number;
  /** m²/s */
  nu: number;
  /** m²/s */
  alpha: number;
  Pr: number;
  /** The saturation pressure at T, Pa. */
  pSat: number;
  source: string;
}

/**
 * Liquid water at T (K) and p (Pa), for 273.15 K ≤ T ≤ 623.15 K and pSat(T) ≤ p ≤ 100 MPa. Leave p out for the
 * saturated liquid. Throws 'domain' for steam (p below the saturation pressure) or outside the range.
 */
export function liquidWater(T: number, p?: number): LiquidWater {
  if (!Number.isFinite(T) || (p !== undefined && !Number.isFinite(p))) throw new NumError('notFinite');
  if (T < 273.15 || T > 623.15) throw new NumError('domain', 'liquid water needs 273.15 K ≤ T ≤ 623.15 K');
  const pSat = waterSaturationPressure(T);
  const pressure = p ?? pSat;
  if (pressure < pSat * (1 - 1e-9)) throw new NumError('domain', 'below the saturation pressure the water is steam');
  if (pressure > 100e6) throw new NumError('domain', 'the formulation stops at 100 MPa');
  const { v, h, cp, cv, drhodp } = region1(T, pressure);
  const rho = 1 / v;
  const mu = waterViscosity(T, rho);
  const k = waterConductivity(T, rho) + waterConductivityEnhancement(T, rho, { cp, cv, drhodp, mu });
  return {
    T,
    p: pressure,
    rho,
    cp,
    h,
    mu,
    k,
    nu: mu / rho,
    alpha: k / (rho * cp),
    Pr: (cp * mu) / k,
    pSat,
    source: WATER_SOURCE,
  };
}
