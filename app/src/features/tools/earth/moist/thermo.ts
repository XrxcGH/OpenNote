// Atmospheric thermodynamics in SI units: K, Pa, and kg/kg. Saturation vapor pressure is by Bolton (1980) or the
// WMO Magnus form over water, and Magnus over ice. From it come humidities, dew points, frost points, wet bulbs,
// potential temperatures, and θe. The LCL is by Bolton or by Romps (2017). Lapse rates, pseudo-adiabats, thickness,
// and saturated salt humidities follow.
import { check } from '../core/problem';

export const RD = 287.05;
export const RV = 461.5;
export const EPS = 0.622;
export const CPD = 1005.7;
export const KAPPA = 0.2857;
export const LV = 2.501e6;
export const G = 9.80665;
export const T0 = 273.15;

export type Formula = 'bolton' | 'magnus';

/** Saturation vapor pressure over liquid water (Pa). Bolton: 6.112 exp(17.67 T/(T + 243.5)) hPa; WMO Magnus: 17.62, 243.12. */
export function esWater(t: number, formula: Formula = 'bolton'): number {
  check(t > 150 && t < 400, 'temperature');
  const c = t - T0;
  const [a, b] = formula === 'bolton' ? [17.67, 243.5] : [17.62, 243.12];
  return 611.2 * Math.exp((a * c) / (c + b));
}

/** Saturation vapor pressure over ice (Pa), WMO Magnus form 6.112 exp(22.46 T/(T + 272.62)) hPa. */
export function esIce(t: number): number {
  check(t > 150 && t < 400, 'temperature');
  const c = t - T0;
  return 611.2 * Math.exp((22.46 * c) / (c + 272.62));
}

/** The temperature at which the vapor pressure e saturates over water (dew point) or ice (frost point). */
export function dewPoint(e: number, formula: Formula = 'bolton'): number {
  check(e > 0, 'vapor');
  const [a, b] = formula === 'bolton' ? [17.67, 243.5] : [17.62, 243.12];
  const l = Math.log(e / 611.2);
  return T0 + (b * l) / (a - l);
}

export function frostPoint(e: number): number {
  check(e > 0, 'vapor');
  const l = Math.log(e / 611.2);
  return T0 + (272.62 * l) / (22.46 - l);
}

export const mixingRatio = (e: number, p: number): number => {
  check(p > e, 'pressure');
  return (EPS * e) / (p - e);
};
export const vaporFromMixing = (w: number, p: number): number => (w * p) / (EPS + w);
export const specificHumidity = (w: number): number => w / (1 + w);
export const virtualTemperature = (t: number, w: number): number => (t * (w + EPS)) / (EPS * (1 + w));
export const potentialTemperature = (t: number, p: number): number => t * (1e5 / p) ** KAPPA;

/** Bolton (1980) eq. 15: the LCL temperature from T and the dew point Td. */
export function lclTemperatureBolton(t: number, td: number): number {
  check(td <= t + 1e-9, 'dewAbove');
  return 1 / (1 / (td - 56) + Math.log(t / td) / 800) + 56;
}

/** Bolton (1980) eq. 43: θe = T (1000/p)^(0.2854(1 − 0.28e-3 r)) exp((3.376/T_L − 0.00254) r (1 + 0.81e-3 r)), r in g/kg. */
export function thetaE(t: number, td: number, p: number, formula: Formula = 'bolton'): number {
  const r = 1000 * mixingRatio(esWater(td, formula), p);
  const tl = lclTemperatureBolton(t, td);
  return t * (1e5 / p) ** (0.2854 * (1 - 0.28e-3 * r)) * Math.exp((3.376 / tl - 0.00254) * r * (1 + 0.81e-3 * r));
}

/** The principal (k = 0) or lower (k = −1) branch of the Lambert W function, by Halley's method. */
export function lambertW(x: number, branch: 0 | -1 = 0): number {
  check(x >= -1 / Math.E, 'lambert');
  if (branch === -1) check(x < 0, 'lambert');
  let w = branch === 0 ? (x < 1 ? x : Math.log(x)) : x > -0.25 ? Math.log(-x) - Math.log(-Math.log(-x)) : -2;
  if (x === -1 / Math.E) return -1;
  for (let i = 0; i < 100; i++) {
    const ew = Math.exp(w);
    const f = w * ew - x;
    const next = w - f / (ew * (w + 1) - ((w + 2) * f) / (2 * w + 2));
    if (Math.abs(next - w) <= 1e-14 * Math.max(1, Math.abs(next))) return next;
    w = next;
  }
  return w;
}

/**
 * Romps (2017), "Exact expression for the lifting condensation level", J. Atmos. Sci. 74, 3891: the LCL temperature,
 * pressure, and height above the parcel from p, T, and relative humidity over liquid (0 to 1), with his constants.
 */
export function lclRomps(p: number, t: number, rh: number): { t: number; p: number; z: number } {
  check(rh > 0 && rh <= 1, 'humidity');
  const ttrip = 273.16;
  const ptrip = 611.65;
  const e0v = 2.374e6;
  const ggr = 9.81;
  const rgasa = 287.04;
  const rgasv = 461;
  const cva = 719;
  const cvv = 1418;
  const cvl = 4119;
  const cpa = cva + rgasa;
  const cpv = cvv + rgasv;
  const pvstar =
    ptrip *
    (t / ttrip) ** ((cpv - cvl) / rgasv) *
    Math.exp(((e0v - (cvv - cvl) * ttrip) / rgasv) * (1 / ttrip - 1 / t));
  const pv = rh * pvstar;
  const qv = (rgasa * pv) / (rgasv * p + pv * (rgasa - rgasv));
  const rgasm = (1 - qv) * rgasa + qv * rgasv;
  const cpm = (1 - qv) * cpa + qv * cpv;
  const a = cpm / rgasm + (cvl - cpv) / rgasv;
  const b = -(e0v - (cvv - cvl) * ttrip) / (rgasv * t);
  const c = b / a;
  const tl = (c * t) / lambertW(rh ** (1 / a) * c * Math.exp(c), -1);
  return { t: tl, p: p * (tl / t) ** (cpm / rgasm), z: (cpm * (t - tl)) / ggr };
}

/** The pressure of the LCL for a parcel whose temperature falls dry-adiabatically from (T, p) to T_L. */
export const lclPressure = (t: number, p: number, tl: number): number => p * (tl / t) ** (1 / KAPPA);

export const DRY_LAPSE = G / CPD;

/** The saturated (pseudo-adiabatic) lapse rate in K/m: g (1 + Lv rs/(Rd T)) / (cp + Lv² rs ε/(Rd T²)). */
export function moistLapse(t: number, p: number): number {
  const rs = mixingRatio(esWater(t), p);
  return (G * (1 + (LV * rs) / (RD * t))) / (CPD + (LV * LV * rs * EPS) / (RD * t * t));
}

/** dT/dp along a pseudo-adiabat: (Rd T + Lv rs) / (p (cp + Lv² rs ε/(Rd T²))). */
function moistSlope(t: number, p: number): number {
  const rs = mixingRatio(esWater(Math.max(t, 160)), p);
  return (RD * t + LV * rs) / (p * (CPD + (LV * LV * rs * EPS) / (RD * t * t)));
}

/** Follows a pseudo-adiabat from (T, p) to p2 by fourth-order Runge-Kutta steps of at most 5 hPa. */
export function moistAdiabat(t: number, p: number, p2: number): number {
  check(p > 0 && p2 > 0, 'pressure');
  const n = Math.max(1, Math.ceil(Math.abs(p2 - p) / 500));
  const h = (p2 - p) / n;
  let tt = t;
  let pp = p;
  for (let i = 0; i < n; i++) {
    const k1 = moistSlope(tt, pp);
    const k2 = moistSlope(tt + (h * k1) / 2, pp + h / 2);
    const k3 = moistSlope(tt + (h * k2) / 2, pp + h / 2);
    const k4 = moistSlope(tt + h * k3, pp + h);
    tt += (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
    pp += h;
  }
  return tt;
}

/** The wet-bulb temperature by bisection on (cp + w cpv)(T − Tw) = Lv (ws(Tw) − w). */
export function wetBulb(t: number, td: number, p: number, formula: Formula = 'bolton'): number {
  check(td <= t + 1e-9, 'dewAbove');
  const w = mixingRatio(esWater(td, formula), p);
  const f = (tw: number) => (CPD + w * 1860) * (t - tw) - LV * (mixingRatio(esWater(tw, formula), p) - w);
  let lo = td - 1;
  let hi = t + 1e-9;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Hypsometric thickness (m) between p1 and p2 for a mean virtual temperature Tv: (Rd Tv/g) ln(p1/p2). */
export function thickness(p1: number, p2: number, tv: number): number {
  check(p1 > 0 && p2 > 0, 'pressure');
  check(tv > 0, 'temperature');
  return ((RD * tv) / G) * Math.log(p1 / p2);
}

/** CAPE (J/kg) by trapezoids in ln p from pressures (any order) and parcel-minus-environment Tv differences. */
export function capeTrapezoids(p: readonly number[], dtv: readonly number[]): { cape: number; cin: number } {
  check(p.length === dtv.length && p.length >= 2, 'levels');
  let cape = 0;
  let cin = 0;
  for (let i = 1; i < p.length; i++) {
    check(p[i] > 0 && p[i - 1] > 0, 'pressure');
    const area = (RD * (dtv[i] + dtv[i - 1]) * Math.log(p[i - 1] / p[i])) / 2;
    const signed = p[i] < p[i - 1] ? area : -area;
    if (signed >= 0) cape += signed;
    else cin += signed;
  }
  return { cape, cin };
}

/**
 * Relative humidities over saturated salt solutions (percent) at 20, 25, and 30 °C: Greenspan (1977), "Humidity
 * fixed points of binary saturated aqueous solutions", J. Res. NBS 81A, 89 (US government, public domain).
 */
export const SALTS = {
  licl: [11.31, 11.3, 11.28],
  ch3cook: [23.11, 22.51, 21.61],
  mgcl2: [33.07, 32.78, 32.44],
  k2co3: [43.16, 43.16, 43.17],
  mgno3: [54.38, 52.89, 51.4],
  nabr: [59.14, 57.57, 56.03],
  ki: [69.9, 68.86, 67.89],
  nacl: [75.47, 75.29, 75.09],
  kcl: [85.11, 84.34, 83.62],
  k2so4: [97.59, 97.3, 97.0],
} as const;

export type Salt = keyof typeof SALTS;

/** A salt's relative humidity at a temperature from 20 to 30 °C, interpolated linearly in the table. */
export function saltHumidity(salt: Salt, celsius: number): number {
  check(celsius >= 20 - 1e-9 && celsius <= 30 + 1e-9, 'saltRange');
  const row = SALTS[salt];
  const i = celsius < 25 ? 0 : 1;
  const s = (celsius - (20 + 5 * i)) / 5;
  return row[i] + s * (row[i + 1] - row[i]);
}
