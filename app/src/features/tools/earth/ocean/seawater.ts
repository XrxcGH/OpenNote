// Seawater by EOS-80 (UNESCO 1983, Technical Papers in Marine Science 44): density from the international
// equation of state with its secant bulk modulus, adiabatic lapse rate, potential temperature, sound speed (Chen
// and Millero), and freezing point; plus Mackenzie's (1981) nine-term sound speed. Practical salinity, IPTS-68
// temperature (°C), and sea pressure in decibars, as the published check values use.
import { check } from '../core/problem';

export const SOURCES = {
  eos80: 'UNESCO (1983), Algorithms for computation of fundamental properties of seawater, Tech. Pap. Mar. Sci. 44',
  mackenzie: 'Mackenzie, K. V. (1981), Nine-term equation for sound speed in the oceans, J. Acoust. Soc. Am. 70',
};

/** ITS-90 to IPTS-68, the scale EOS-80 was fitted on. */
export const toT68 = (t90: number): number => 1.00024 * t90;

function inRange(s: number, t: number, p: number): void {
  check(s >= 0 && s <= 42, 'salinity');
  check(t >= -2 && t <= 40, 'temperature');
  check(p >= 0 && p <= 10000, 'pressure');
}

/** The density of seawater at one standard atmosphere (sea pressure 0). */
function density0(s: number, t: number): number {
  const rw =
    999.842594 + t * (6.793952e-2 + t * (-9.09529e-3 + t * (1.001685e-4 + t * (-1.120083e-6 + t * 6.536332e-9))));
  const a = 8.24493e-1 + t * (-4.0899e-3 + t * (7.6438e-5 + t * (-8.2467e-7 + t * 5.3875e-9)));
  const b = -5.72466e-3 + t * (1.0227e-4 - t * 1.6546e-6);
  return rw + s * (a + Math.sqrt(s) * b + 4.8314e-4 * s);
}

/** The secant bulk modulus K(S, T, p) in bars, with p in bars. */
function bulkModulus(s: number, t: number, p: number): number {
  const kw = 19652.21 + t * (148.4206 + t * (-2.327105 + t * (1.360477e-2 - t * 5.155288e-5)));
  const aw = 3.239908 + t * (1.43713e-3 + t * (1.16092e-4 - t * 5.77905e-7));
  const bw = 8.50935e-5 + t * (-6.12293e-6 + t * 5.2787e-8);
  const sr = Math.sqrt(s);
  const k0 =
    kw +
    s * (54.6746 + t * (-0.603459 + t * (1.09987e-2 - t * 6.167e-5))) +
    s * sr * (7.944e-2 + t * (1.6483e-2 - t * 5.3009e-4));
  const a = aw + s * (2.2838e-3 + t * (-1.0981e-5 - t * 1.6078e-6)) + 1.91075e-4 * s * sr;
  const b = bw + s * (-9.9348e-7 + t * (2.0816e-8 + t * 9.1697e-10));
  return k0 + p * (a + p * b);
}

/** In-situ density (kg/m³) at practical salinity S, temperature T (°C, IPTS-68), and sea pressure p (dbar). */
export function density(s: number, t: number, p: number): number {
  inRange(s, t, p);
  const bar = p / 10;
  return density0(s, t) / (1 - bar / bulkModulus(s, t, bar));
}

/** The adiabatic lapse rate (°C per dbar). */
export function lapseRate(s: number, t: number, p: number): number {
  const ds = s - 35;
  return (
    (((-2.1687e-16 * t + 1.8676e-14) * t - 4.6206e-13) * p +
      ((2.7759e-12 * t - 1.1351e-10) * ds + ((-5.4481e-14 * t + 8.733e-12) * t - 6.7795e-10) * t + 1.8741e-8)) *
      p +
    (-4.2393e-8 * t + 1.8932e-6) * ds +
    ((6.6228e-10 * t - 6.836e-8) * t + 8.5258e-6) * t +
    3.5803e-5
  );
}

/** Potential temperature at reference pressure pr, by Fofonoff's fourth-order Runge–Kutta step. */
export function potentialTemperature(s: number, t: number, p: number, pr = 0): number {
  inRange(s, t, p);
  const h = pr - p;
  let xk = h * lapseRate(s, t, p);
  let temp = t + 0.5 * xk;
  let q = xk;
  let pp = p + 0.5 * h;
  xk = h * lapseRate(s, temp, pp);
  temp += 0.29289322 * (xk - q);
  q = 0.58578644 * xk + 0.121320344 * q;
  xk = h * lapseRate(s, temp, pp);
  temp += 1.707106781 * (xk - q);
  q = 3.414213562 * xk - 4.121320344 * q;
  pp += 0.5 * h;
  xk = h * lapseRate(s, temp, pp);
  return temp + (xk - 2 * q) / 6;
}

/** The speed of sound (m/s) by Chen and Millero (1977), as UNESCO (1983) gives it. */
export function soundSpeed(s: number, t: number, p: number): number {
  inRange(s, t, p);
  const pb = p / 10;
  const cw =
    1402.388 +
    t * (5.03711 + t * (-5.80852e-2 + t * (3.342e-4 + t * (-1.478e-6 + t * 3.1464e-9)))) +
    pb * (0.153563 + t * (6.8982e-4 + t * (-8.1788e-6 + t * (1.3621e-7 - t * 6.1185e-10)))) +
    pb * pb * (3.126e-5 + t * (-1.7107e-6 + t * (2.5974e-8 + t * (-2.5335e-10 + t * 1.0405e-12)))) +
    pb ** 3 * (-9.7729e-9 + t * (3.8504e-10 - t * 2.3643e-12));
  const a =
    1.389 +
    t * (-1.262e-2 + t * (7.164e-5 + t * (2.006e-6 - t * 3.21e-8))) +
    pb * (9.4742e-5 + t * (-1.258e-5 + t * (-6.4885e-8 + t * (1.0507e-8 - t * 2.0122e-10)))) +
    pb * pb * (-3.9064e-7 + t * (9.1041e-9 + t * (-1.6002e-10 + t * 7.988e-12))) +
    pb ** 3 * (1.1e-10 + t * (6.649e-12 - t * 3.389e-13));
  const b = -1.922e-2 - 4.42e-5 * t + pb * (7.3637e-5 + 1.7945e-7 * t);
  const d = 1.727e-3 - 7.9836e-6 * pb;
  return cw + a * s + b * s ** 1.5 + d * s * s;
}

/** The freezing point (°C) of seawater at sea pressure p (dbar). */
export function freezingPoint(s: number, p: number): number {
  check(s >= 4 && s <= 40, 'salinity');
  check(p >= 0 && p <= 10000, 'pressure');
  return (-0.0575 + 1.710523e-3 * Math.sqrt(s) - 2.154996e-4 * s) * s - 7.53e-4 * p;
}

/** Mackenzie's sound speed at temperature T (°C), salinity S, and depth D (m). */
export function mackenzie(t: number, s: number, depth: number): number {
  check(t >= -2 && t <= 30 && s >= 25 && s <= 40 && depth >= 0 && depth <= 8000, 'mackenzie');
  return (
    1448.96 +
    4.591 * t -
    5.304e-2 * t * t +
    2.374e-4 * t ** 3 +
    1.34 * (s - 35) +
    1.63e-2 * depth +
    1.675e-7 * depth * depth -
    1.025e-2 * t * (s - 35) -
    7.139e-13 * t * depth ** 3
  );
}

/** A reference-composition estimate of absolute salinity (g/kg) from practical salinity, with no anomaly term. */
export const absoluteSalinity = (sp: number): number => (35.16504 / 35) * sp;

/**
 * The temperature at which seawater of salinity S has potential density σθ at the surface, found by bisection.
 * Null when the isopycnal does not cross the range from −2 to 40 °C.
 */
export function isopycnalTemperature(s: number, sigma: number): number | null {
  const at = (t: number) => density0(s, t) - 1000 - sigma;
  let [lo, hi] = [-2, 40];
  if (at(lo) * at(hi) > 0) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(lo) * at(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** σθ, the potential density anomaly at the surface: ρ(S, θ, 0) − 1000. */
export const sigmaTheta = (s: number, theta: number): number => density0(s, theta) - 1000;
