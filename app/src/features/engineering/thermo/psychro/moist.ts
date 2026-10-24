// Moist air as an ideal-gas mixture of dry air and water vapor, with the ASHRAE formulas. The saturation pressure
// of water comes from IAPWS-IF97 region 4 at and above 0 °C, and over ice from the IAPWS R14-08 sublimation
// equation. Temperatures are in °C and pressures in kPa, and h and v are per kg of dry air.
import { brent } from '../common/num';
import { ThermoError } from '../common/types';
import { psat } from '../steam/if97';

export const PSYCHRO_SOURCE = 'IAPWS-IF97 region 4, IAPWS R14-08 sublimation, and ASHRAE moist-air formulas';

/** Molar mass ratio of water to dry air. */
export const EPS = 0.621945;
const T_TRIPLE = 273.16;
const P_TRIPLE = 0.611657;
const SUB_A = [-0.212144006e2, 0.273203819e2, -0.61059813e1];
const SUB_B = [0.333333333e-2, 0.120666667e1, 0.170333333e1];

/** Lowest and highest dry-bulb temperatures the tool works with, °C. */
export const T_LOW = -60;
export const T_HIGH = 200;

/** Saturation pressure of water over liquid (t ≥ 0 °C) or ice (t < 0 °C), kPa. */
export function pws(t: number): number {
  if (!(t >= T_LOW && t <= T_HIGH)) throw new ThermoError('psychroRange');
  const T = t + 273.15;
  if (t >= 0) return psat(T);
  const theta = T / T_TRIPLE;
  const sum = SUB_A.reduce((acc, a, i) => acc + a * theta ** SUB_B[i], 0);
  return P_TRIPLE * Math.exp(sum / theta);
}

/** The formula pws used at t: IF97 over water or R14-08 over ice. */
export const pwsSource = (t: number): 'water' | 'ice' => (t >= 0 ? 'water' : 'ice');

/** Humidity ratio from the vapor pressure, kg water per kg dry air. */
export function omegaOf(pv: number, p: number): number {
  if (!(pv < p)) throw new ThermoError('psychroVapor');
  return (EPS * pv) / (p - pv);
}

/** Vapor pressure from the humidity ratio. */
export const pvOf = (omega: number, p: number): number => (p * omega) / (EPS + omega);

/** Enthalpy of moist air, kJ/kg dry air. */
export const enthalpy = (t: number, omega: number): number => 1.006 * t + omega * (2501 + 1.86 * t);

/** Dry-bulb temperature from h and ω. */
export const tFromH = (h: number, omega: number): number => (h - 2501 * omega) / (1.006 + 1.86 * omega);

/** Specific volume of moist air, m³/kg dry air. */
export const volume = (t: number, omega: number, p: number): number =>
  (0.287042 * (t + 273.15) * (1 + 1.607858 * omega)) / p;

/** The humidity ratio leaving an adiabatic saturator at wet-bulb t* for air at t: the ASHRAE balance. */
export function omegaFromWetBulb(t: number, twb: number, p: number): number {
  const ws = omegaOf(pws(twb), p);
  if (twb >= 0) return ((2501 - 2.326 * twb) * ws - 1.006 * (t - twb)) / (2501 + 1.86 * t - 4.186 * twb);
  return ((2830 - 0.24 * twb) * ws - 1.006 * (t - twb)) / (2830 + 1.86 * t - 2.1 * twb);
}

/** Wet-bulb temperature by Brent's method on the adiabatic-saturation balance. */
export function wetBulb(t: number, omega: number, p: number): number {
  const f = (twb: number) => omegaFromWetBulb(t, twb, p) - omega;
  const lo = Math.max(T_LOW, t - 80);
  if (f(lo) > 0 || f(t) < 0) throw new ThermoError('noRoot');
  return brent(f, lo, t, 1e-10);
}

/** Dew point (or frost point below 0 °C): where pws equals the vapor pressure. */
export function dewPoint(pv: number): number {
  if (!(pv > 0)) return Number.NEGATIVE_INFINITY;
  const f = (t: number) => pws(t) - pv;
  if (f(T_LOW) > 0) throw new ThermoError('psychroRange');
  if (f(T_HIGH) < 0) throw new ThermoError('psychroRange');
  return brent(f, T_LOW, T_HIGH, 1e-11);
}

/** Pressure of the US Standard Atmosphere at an altitude in m (ASHRAE), kPa. */
export const pressureAt = (z: number): number => 101.325 * (1 - 2.25577e-5 * z) ** 5.2559;

/** A moist-air state with every property. */
export interface MoistState {
  t: number;
  p: number;
  omega: number;
  phi: number;
  pv: number;
  pws: number;
  h: number;
  v: number;
  twb: number;
  tdp: number;
}

/** The state from dry bulb and humidity ratio. */
export function moist(t: number, omega: number, p: number): MoistState {
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (!(omega >= 0)) throw new ThermoError('psychroOmega');
  const ps = pws(t);
  const pv = pvOf(omega, p);
  const phi = pv / ps;
  if (phi > 1 + 1e-9) throw new ThermoError('psychroSupersaturated');
  return {
    t,
    p,
    omega,
    phi: Math.min(phi, 1),
    pv,
    pws: ps,
    h: enthalpy(t, omega),
    v: volume(t, omega, p),
    twb: wetBulb(t, omega, p),
    tdp: dewPoint(pv),
  };
}

/** The state from dry bulb and relative humidity (0 to 1). */
export function moistFromPhi(t: number, phi: number, p: number): MoistState {
  if (!(phi >= 0 && phi <= 1)) throw new ThermoError('psychroPhi');
  return moist(t, omegaOf(phi * pws(t), p), p);
}

/** Dry bulb where a function of t crosses a target, searched from the lowest temperature to the highest. */
export function solveDryBulb(f: (t: number) => number, lo = T_LOW, hi = T_HIGH - 1): number {
  if (!(f(lo) * f(hi) <= 0)) throw new ThermoError('noRoot');
  return brent(f, lo, hi, 1e-10);
}
