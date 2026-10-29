// Dry air as an ideal gas, for the fluids, heat-transfer, and aero kits. Density comes from p = ρRT with
// R = 287.05 J/(kg·K), the US Standard Atmosphere 1976 value. Viscosity follows Sutherland's law and thermal
// conductivity the relation of the same standard (NOAA, NASA, and USAF; public domain). cp is interpolated in the
// ideal-gas cp of the reference tables (250 to 1000 K, computed with CoolProp). Outside that range cp is
// extrapolated from the nearest points and the result says so.
import { GAS_ROWS, GAS_SOURCE, GAS_TEMPS } from '../../chem/data/gasData';
import { NumError } from '../num/errors';

export const AIR_R = 287.05;

export const AIR_SOURCE = `US Standard Atmosphere 1976 (viscosity, conductivity, R = 287.05 J/(kg·K)); ideal-gas cp from ${GAS_SOURCE}`;

const AIR_CP = GAS_ROWS.find((row) => row[0] === 'Air')![4];

/** Sutherland's law: μ = βT^(3/2)/(T + S), β = 1.458e-6 kg/(m·s·K^½), S = 110.4 K. */
export const airViscosity = (T: number): number => (1.458e-6 * T ** 1.5) / (T + 110.4);

/** k = 2.64638e-3 T^(3/2) / (T + 245.4 · 10^(-12/T)) W/(m·K). */
export const airConductivity = (T: number): number => (2.64638e-3 * T ** 1.5) / (T + 245.4 * 10 ** (-12 / T));

/** cp in J/(kg·K), by quadratic interpolation through the 3 nearest table points. */
export function airCp(T: number): { cp: number; outOfRange: boolean } {
  const temps = GAS_TEMPS;
  const outOfRange = T < temps[0] || T > temps[temps.length - 1];
  let i = temps.findIndex((t) => t >= T);
  if (i === -1) i = temps.length - 1;
  const start = Math.min(Math.max(i - 1, 0), temps.length - 3);
  let cp = 0;
  for (let a = start; a < start + 3; a += 1) {
    let weight = 1;
    for (let b = start; b < start + 3; b += 1) if (b !== a) weight *= (T - temps[b]) / (temps[a] - temps[b]);
    cp += weight * AIR_CP[a];
  }
  return { cp: cp * 1000, outOfRange };
}

export interface Air {
  /** K */
  T: number;
  /** Pa */
  p: number;
  /** kg/m³ */
  rho: number;
  /** Pa·s */
  mu: number;
  /** W/(m·K) */
  k: number;
  /** J/(kg·K) */
  cp: number;
  /** cp/cv with cv = cp - R */
  gamma: number;
  Pr: number;
  /** m²/s */
  nu: number;
  /** m²/s */
  alpha: number;
  /** The speed of sound √(γRT), m/s. */
  a: number;
  /** Whether cp came from outside the table's 250 to 1000 K. */
  cpOutOfRange: boolean;
  source: string;
}

/** Dry air at T (K) and p (Pa). Throws 'domain' for T or p not above zero. */
export function air(T: number, p: number): Air {
  if (!Number.isFinite(T) || !Number.isFinite(p)) throw new NumError('notFinite');
  if (!(T > 0)) throw new NumError('domain', 'the temperature must be above 0 K');
  if (!(p > 0)) throw new NumError('domain', 'the pressure must be above 0 Pa');
  const rho = p / (AIR_R * T);
  const mu = airViscosity(T);
  const k = airConductivity(T);
  const { cp, outOfRange } = airCp(T);
  const gamma = cp / (cp - AIR_R);
  return {
    T,
    p,
    rho,
    mu,
    k,
    cp,
    gamma,
    Pr: (cp * mu) / k,
    nu: mu / rho,
    alpha: k / (rho * cp),
    a: Math.sqrt(gamma * AIR_R * T),
    cpOutOfRange: outOfRange,
    source: AIR_SOURCE,
  };
}
