// Planetary energy balance in SI units. The effective temperature and layered greenhouse models come first, then
// radiative forcing by the published simplified expressions and the warming of box models over time. Last are a
// zero-dimensional ice-albedo model with its two stable states and a diffusive energy-balance model by latitude.
import { check } from '../core/problem';

/** Stefan-Boltzmann constant, W/(m²·K⁴) (CODATA 2018, exact in the 2019 SI). */
export const SIGMA = 5.670374419e-8;

/** T_e = (S0 (1 − A)/(4σ))^(1/4). */
export function effectiveTemperature(s0: number, albedo: number): number {
  check(s0 > 0, 'solar');
  check(albedo >= 0 && albedo < 1, 'albedo');
  return ((s0 * (1 - albedo)) / (4 * SIGMA)) ** 0.25;
}

/** N fully absorbing layers: the surface at (N + 1)^(1/4) T_e and layer k from the top at k^(1/4) T_e. */
export function layerTemperatures(te: number, layers: number): { surface: number; layers: number[] } {
  check(Number.isInteger(layers) && layers >= 0 && layers <= 100, 'layers');
  return {
    surface: (layers + 1) ** 0.25 * te,
    layers: Array.from({ length: layers }, (_, i) => (i + 1) ** 0.25 * te),
  };
}

/** One layer absorbing a fraction ε of the surface's infrared: T_s = T_e (2/(2 − ε))^(1/4), T_a = T_e/(2 − ε)^(1/4). */
export function leakyLayer(te: number, emissivity: number): { surface: number; air: number } {
  check(emissivity >= 0 && emissivity <= 1, 'emissivity');
  return { surface: te * (2 / (2 - emissivity)) ** 0.25, air: te * (1 / (2 - emissivity)) ** 0.25 };
}

export type Gas = 'co2' | 'ch4' | 'n2o';

/** The CH4–N2O overlap term of the IPCC TAR simplified expressions, with both in ppb. */
export function overlap(m: number, n: number): number {
  const mn = m * n;
  return 0.47 * Math.log(1 + 2.01e-5 * mn ** 0.75 + 5.31e-15 * m * mn ** 1.52);
}

/**
 * Radiative forcing, W/m². CO2 in ppm: 5.35 ln(C/C0) (Myhre et al. 1998). CH4 and N2O in ppb with `other` the
 * other gas's reference concentration: the IPCC TAR (2001, table 6.2) expressions with the overlap term.
 */
export function forcing(gas: Gas, now: number, before: number, other = 0): number {
  check(now > 0 && before > 0, 'concentration');
  if (gas === 'co2') return 5.35 * Math.log(now / before);
  check(other > 0, 'concentration');
  if (gas === 'ch4')
    return 0.036 * (Math.sqrt(now) - Math.sqrt(before)) - (overlap(now, other) - overlap(before, other));
  return 0.12 * (Math.sqrt(now) - Math.sqrt(before)) - (overlap(other, now) - overlap(other, before));
}

export interface BoxModel {
  /** Climate sensitivity λ, K per W/m². */
  sensitivity: number;
  /** Upper (mixed-layer) heat capacity, J/(m²·K). */
  upper: number;
  /** Deep-ocean heat capacity, J/(m²·K); 0 for a one-box model. */
  deep: number;
  /** Heat exchange to the deep ocean, W/(m²·K). */
  exchange: number;
}

export interface Path {
  /** Years. */
  t: number[];
  upper: number[];
  deep: number[];
  forcing: number[];
}

/** Volumetric heat capacity of seawater, J/(m³·K) (about 1025 kg/m³ × 3990 J/(kg·K)). */
export const SEAWATER_HEAT = 4.09e6;
const YEAR = 365.25 * 86400;

/** Forcing that rises linearly to `peak` over `ramp` years, then holds; a ramp of 0 is a step. */
export const rampForcing =
  (peak: number, ramp: number) =>
  (years: number): number =>
    ramp > 0 ? peak * Math.min(years / ramp, 1) : peak;

/**
 * C dT/dt = F − T/λ − γ (T − T_D) and C_D dT_D/dt = γ (T − T_D), integrated by fourth-order Runge-Kutta in steps of
 * a twentieth of a year. With no deep box the second equation drops out.
 */
export function boxPath(model: BoxModel, force: (years: number) => number, years: number): Path {
  check(model.sensitivity > 0, 'sensitivity');
  check(model.upper > 0 && model.deep >= 0 && model.exchange >= 0, 'heat');
  check(years > 0 && years <= 5000, 'years');
  const two = model.deep > 0 && model.exchange > 0;
  const rate = (time: number, [u, d]: readonly [number, number]): [number, number] => {
    const toDeep = two ? model.exchange * (u - d) : 0;
    return [
      ((force(time) - u / model.sensitivity - toDeep) * YEAR) / model.upper,
      two ? (toDeep * YEAR) / model.deep : 0,
    ];
  };
  const dt = 0.05;
  const steps = Math.ceil(years / dt);
  const h = years / steps;
  let state: [number, number] = [0, 0];
  const path: Path = { t: [0], upper: [0], deep: [0], forcing: [force(0)] };
  const every = Math.max(1, Math.round(steps / 400));
  for (let i = 0; i < steps; i++) {
    const time = i * h;
    const k1 = rate(time, state);
    const k2 = rate(time + h / 2, [state[0] + (h / 2) * k1[0], state[1] + (h / 2) * k1[1]]);
    const k3 = rate(time + h / 2, [state[0] + (h / 2) * k2[0], state[1] + (h / 2) * k2[1]]);
    const k4 = rate(time + h, [state[0] + h * k3[0], state[1] + h * k3[1]]);
    state = [
      state[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      state[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    ];
    if ((i + 1) % every === 0 || i === steps - 1) {
      path.t.push(time + h);
      path.upper.push(state[0]);
      path.deep.push(state[1]);
      path.forcing.push(force(time + h));
    }
  }
  return path;
}

/** The two-box model's response times in years: the eigenvalues of its linear system. */
export function boxTimes(model: BoxModel): number[] {
  const a = 1 / model.sensitivity + model.exchange;
  if (!(model.deep > 0 && model.exchange > 0)) return [(model.upper * model.sensitivity) / YEAR];
  const m11 = -a / model.upper;
  const m12 = model.exchange / model.upper;
  const m21 = model.exchange / model.deep;
  const m22 = -model.exchange / model.deep;
  const tr = m11 + m22;
  const det = m11 * m22 - m12 * m21;
  const root = Math.sqrt(tr * tr - 4 * det);
  return [-2 / (tr - root) / YEAR, -2 / (tr + root) / YEAR].sort((x, y) => x - y);
}

export interface IceAlbedo {
  /** Present solar constant, W/m². */
  s0: number;
  /** Effective emissivity of the planet. */
  emissivity: number;
  iceAlbedo: number;
  warmAlbedo: number;
  /** Fully ice-covered at or below this temperature, K. */
  iceT: number;
  /** Free of ice at or above this temperature, K. */
  warmT: number;
}

/** The albedo, ramping linearly from ice to open ground between the two temperatures. */
export function rampAlbedo(model: IceAlbedo, temp: number): number {
  if (temp <= model.iceT) return model.iceAlbedo;
  if (temp >= model.warmT) return model.warmAlbedo;
  const f = (temp - model.iceT) / (model.warmT - model.iceT);
  return model.iceAlbedo + f * (model.warmAlbedo - model.iceAlbedo);
}

/** Net heating, W/m², at temperature `temp` for a solar constant `s0` times `q`. */
export const netHeating = (model: IceAlbedo, q: number, temp: number): number =>
  (q * model.s0 * (1 - rampAlbedo(model, temp))) / 4 - model.emissivity * SIGMA * temp ** 4;

export interface Equilibrium {
  t: number;
  stable: boolean;
}

function checkIce(model: IceAlbedo): void {
  check(model.s0 > 0, 'solar');
  check(model.emissivity > 0 && model.emissivity <= 1, 'emissivity');
  check(model.iceAlbedo >= 0 && model.iceAlbedo < 1 && model.warmAlbedo >= 0 && model.warmAlbedo < 1, 'albedo');
  check(model.warmT > model.iceT && model.iceT > 0, 'iceRange');
}

/** Every temperature from 100 to 500 K where heating balances, found by scanning then bisection. */
export function equilibria(model: IceAlbedo, q: number): Equilibrium[] {
  checkIce(model);
  const found: Equilibrium[] = [];
  const f = (temp: number) => netHeating(model, q, temp);
  let a = 100;
  let fa = f(a);
  for (let b = 100.25; b <= 500; b += 0.25) {
    const fb = f(b);
    if (fa === 0 || fa * fb < 0) {
      let lo = a;
      let hi = b;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (f(lo) * f(mid) <= 0) hi = mid;
        else lo = mid;
      }
      const t = (lo + hi) / 2;
      found.push({ t, stable: f(t - 0.01) > f(t + 0.01) });
    }
    a = b;
    fa = fb;
  }
  return found;
}

/** Equilibria over a range of solar multipliers, for the hysteresis picture. */
export function hysteresis(
  model: IceAlbedo,
  from: number,
  to: number,
  count = 161,
): { q: number; eq: Equilibrium[] }[] {
  return Array.from({ length: count }, (_, i) => {
    const q = from + ((to - from) * i) / (count - 1);
    return { q, eq: equilibria(model, q) };
  });
}

/** The solar multipliers where the warm state is lost going down and the frozen state is lost going up. */
export function tippingPoints(model: IceAlbedo, from = 0.5, to = 2): { freeze: number | null; thaw: number | null } {
  const scan = hysteresis(model, from, to, 1501);
  const warm = (eq: Equilibrium[]) => eq.some((e) => e.stable && e.t >= model.warmT);
  const cold = (eq: Equilibrium[]) => eq.some((e) => e.stable && e.t <= model.iceT);
  const firstWarm = scan.find((s) => warm(s.eq));
  const lastCold = [...scan].reverse().find((s) => cold(s.eq));
  return {
    freeze: firstWarm && firstWarm !== scan[0] ? firstWarm.q : null,
    thaw: lastCold && lastCold !== scan[scan.length - 1] ? lastCold.q : null,
  };
}

export interface Ebm {
  /** Solar constant, W/m²; the mean insolation is a quarter of it. */
  s0: number;
  /** Outgoing longwave A + B T with T in °C. */
  a: number;
  b: number;
  /** Diffusion, W/(m²·K). */
  d: number;
  warmAlbedo: number;
  /** Open ground grows brighter toward the poles: its albedo is warmAlbedo + albedoP2 (3x² − 1)/2. */
  albedoP2: number;
  iceAlbedo: number;
  /** Ice where T is below this, °C. */
  iceT: number;
  /** Second Legendre coefficient of the annual insolation (North 1975: −0.482). */
  s2: number;
}

export interface EbmResult {
  /** sin(latitude) at the cell centers, 0 to 1. */
  x: number[];
  /** Temperature at each, °C. */
  t: number[];
  mean: number;
  /** Latitude of the ice line, degrees; 90 with no ice and 0 when ice covers everything. */
  iceLine: number;
  iterations: number;
}

/** Solves a tridiagonal system in place (Thomas algorithm): sub, main, super, right side. */
function tridiagonal(lower: number[], main: number[], upper: number[], rhs: number[]): number[] {
  const n = main.length;
  const c = [...upper];
  const d = [...rhs];
  const m = [...main];
  for (let i = 1; i < n; i++) {
    const w = lower[i] / m[i - 1];
    m[i] -= w * c[i - 1];
    d[i] -= w * d[i - 1];
  }
  const out = new Array<number>(n);
  out[n - 1] = d[n - 1] / m[n - 1];
  for (let i = n - 2; i >= 0; i--) out[i] = (d[i] - c[i] * out[i + 1]) / m[i];
  return out;
}

/**
 * The Budyko-Sellers model in x = sin(latitude) for one hemisphere: −D·d/dx[(1 − x²) dT/dx] + A + B T = Q s(x)
 * (1 − α), with s(x) = 1 + s2 (3x² − 1)/2. Implicit steps from a warm or a frozen start run to the steady state.
 */
export function budykoSellers(model: Ebm, start: 'warm' | 'cold', cells = 90): EbmResult {
  check(model.s0 > 0, 'solar');
  check(model.b > 0 && model.d >= 0, 'ebm');
  check(model.warmAlbedo >= 0 && model.warmAlbedo < 1 && model.iceAlbedo >= 0 && model.iceAlbedo < 1, 'albedo');
  const n = cells;
  const dx = 1 / n;
  const x = Array.from({ length: n }, (_, i) => (i + 0.5) * dx);
  const q = model.s0 / 4;
  const p2 = x.map((v) => (3 * v * v - 1) / 2);
  const sun = p2.map((v) => q * (1 + model.s2 * v));
  const open = p2.map((v) => model.warmAlbedo + model.albedoP2 * v);
  const face = (k: number) => (model.d * (1 - (k * dx) ** 2)) / (dx * dx);
  const relax = 5;
  const lower = x.map((_, i) => (i > 0 ? -face(i) : 0));
  const upper = x.map((_, i) => (i < n - 1 ? -face(i + 1) : 0));
  const main = x.map((_, i) => relax + model.b + (i > 0 ? face(i) : 0) + (i < n - 1 ? face(i + 1) : 0));
  let t: number[] = x.map(() => (start === 'warm' ? 20 : -40));
  let iterations = 0;
  for (; iterations < 20000; iterations++) {
    const rhs = t.map((v, i) => relax * v + sun[i] * (1 - (v < model.iceT ? model.iceAlbedo : open[i])) - model.a);
    const next = tridiagonal(lower, main, upper, rhs);
    const change = Math.max(...next.map((v, i) => Math.abs(v - t[i])));
    t = next;
    if (change < 1e-9) break;
  }
  return { x, t, mean: t.reduce((s, v) => s + v, 0) / n, iceLine: iceLine(x, t, model.iceT), iterations };
}

function iceLine(x: number[], t: number[], iceT: number): number {
  if (t.every((v) => v >= iceT)) return 90;
  if (t.every((v) => v < iceT)) return 0;
  for (let i = 1; i < x.length; i++) {
    if ((t[i - 1] - iceT) * (t[i] - iceT) <= 0 && t[i - 1] !== t[i]) {
      const xs = x[i - 1] + ((iceT - t[i - 1]) * (x[i] - x[i - 1])) / (t[i] - t[i - 1]);
      return (Math.asin(Math.min(1, xs)) * 180) / Math.PI;
    }
  }
  return t[0] < iceT ? 0 : 90;
}
