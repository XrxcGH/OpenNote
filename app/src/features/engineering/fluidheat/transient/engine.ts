// Transient conduction (and the identical diffusion problem for mass): lumped capacitance, the exact series solutions for the
// plane wall, long cylinder and sphere, and the semi-infinite solid. Temperature and concentration share every formula.
import { besselJ, bracketScan, brent, CalcError, erf, erfc, erfcx, fmt, need, positive, type Step } from '../numeric';

export type SolidShape = 'wall' | 'cylinder' | 'sphere';

export interface LumpedInput {
  /** Volume over surface area, V/As (m). Wall: half thickness; long cylinder: R/2; sphere: R/3. */
  characteristicLength: number;
  k: number;
  rho: number;
  cp: number;
  h: number;
  tInitial: number;
  tFluid: number;
  /** Time (s) to evaluate at, or a target temperature to find the time for. */
  time?: number;
  target?: number;
}

export interface LumpedResult {
  biot: number;
  /** Time constant rho V cp / (h As) (s). */
  tau: number;
  temperature?: number;
  timeToTarget?: number;
  valid: boolean;
  warnings: string[];
  steps: Step[];
}

export function characteristicLength(shape: SolidShape, size: number): number {
  positive(size, 'The size');
  return shape === 'wall' ? size : shape === 'cylinder' ? size / 2 : size / 3;
}

/** Lumped capacitance: (T - Tinf)/(Ti - Tinf) = exp(-t/tau). */
export function lumped(inp: LumpedInput): LumpedResult {
  positive(inp.characteristicLength, 'The characteristic length V/As');
  positive(inp.k, 'The conductivity');
  positive(inp.rho, 'The density');
  positive(inp.cp, 'The specific heat');
  positive(inp.h, 'The heat transfer coefficient');
  need(inp.tInitial !== inp.tFluid, 'same', 'The solid starts at the fluid temperature, so nothing changes.');
  const bi = (inp.h * inp.characteristicLength) / inp.k;
  const tau = (inp.rho * inp.cp * inp.characteristicLength) / inp.h;
  const warnings: string[] = [];
  if (bi > 0.1) warnings.push('fhTransWarnBiot');
  const steps: Step[] = [
    { key: 'fhTransBiot', vars: { Bi: fmt(bi, 4) }, math: `Bi = \\frac{h L_c}{k} = ${fmt(bi, 4)}` },
    {
      key: 'fhTransTau',
      vars: { tau: fmt(tau, 5) },
      math: `\\tau = \\frac{\\rho c_p L_c}{h} = ${fmt(tau, 5)}\\ \\mathrm{s}`,
    },
  ];
  const out: LumpedResult = { biot: bi, tau, valid: bi <= 0.1, warnings, steps };
  if (inp.time !== undefined) {
    need(Number.isFinite(inp.time) && inp.time >= 0, 'time', 'The time must be zero or more.');
    out.temperature = inp.tFluid + (inp.tInitial - inp.tFluid) * Math.exp(-inp.time / tau);
    steps.push({
      key: 'fhTransLumpedT',
      vars: { T: fmt(out.temperature) },
      math: `T = T_\\infty + (T_i - T_\\infty)e^{-t/\\tau} = ${fmt(out.temperature)}`,
    });
  }
  if (inp.target !== undefined) {
    const ratio = (inp.target - inp.tFluid) / (inp.tInitial - inp.tFluid);
    need(
      ratio > 0 && ratio < 1,
      'target',
      'The target temperature must lie between the initial and the fluid temperatures (and not equal the fluid temperature).',
    );
    out.timeToTarget = -tau * Math.log(ratio);
    steps.push({
      key: 'fhTransLumpedTime',
      vars: { t: fmt(out.timeToTarget, 5) },
      math: `t = -\\tau\\ln\\frac{T - T_\\infty}{T_i - T_\\infty} = ${fmt(out.timeToTarget, 5)}\\ \\mathrm{s}`,
    });
  }
  return out;
}

// --- exact series ------------------------------------------------------------------------------------------------

const eigenFunction =
  (shape: SolidShape, bi: number) =>
  (z: number): number =>
    shape === 'wall'
      ? z * Math.sin(z) - bi * Math.cos(z)
      : shape === 'cylinder'
        ? z * besselJ(1, z) - bi * besselJ(0, z)
        : (1 - bi) * Math.sin(z) - z * Math.cos(z);

/** Positive roots of the eigencondition: zeta tan zeta = Bi (wall), zeta J1/J0 = Bi (cylinder), 1 - zeta cot zeta = Bi (sphere). */
export function eigenvalues(shape: SolidShape, bi: number, zetaMax: number): number[] {
  need(Number.isFinite(bi) && bi > 0, 'biot', 'The Biot number must be above zero.');
  const f = eigenFunction(shape, bi);
  const lo = 1e-7;
  const n = Math.max(200, Math.ceil(zetaMax / 0.02));
  // the sphere function has a trivial zero at zeta = 0, so start just above it
  return bracketScan(f, lo, zetaMax, n);
}

function coefficient(shape: SolidShape, z: number): number {
  switch (shape) {
    case 'wall':
      return (4 * Math.sin(z)) / (2 * z + Math.sin(2 * z));
    case 'cylinder': {
      const j0 = besselJ(0, z);
      const j1 = besselJ(1, z);
      return (2 * j1) / (z * (j0 * j0 + j1 * j1));
    }
    case 'sphere':
      return (4 * (Math.sin(z) - z * Math.cos(z))) / (2 * z - Math.sin(2 * z));
  }
}

function shapeFunction(shape: SolidShape, z: number, xStar: number): number {
  switch (shape) {
    case 'wall':
      return Math.cos(z * xStar);
    case 'cylinder':
      return besselJ(0, z * xStar);
    case 'sphere':
      return xStar === 0 ? 1 : Math.sin(z * xStar) / (z * xStar);
  }
}

function heatFactor(shape: SolidShape, z: number): number {
  switch (shape) {
    case 'wall':
      return Math.sin(z) / z;
    case 'cylinder':
      return (2 * besselJ(1, z)) / z;
    case 'sphere':
      return (3 * (Math.sin(z) - z * Math.cos(z))) / z ** 3;
  }
}

export interface SeriesResult {
  biot: number;
  fourier: number;
  /** Dimensionless temperature (T - Tinf)/(Ti - Tinf) at the requested position. */
  theta: number;
  center: number;
  surface: number;
  /** Fraction of the maximum possible energy transferred, Q/Q0. */
  heatFraction: number;
  zeta1: number;
  c1: number;
  /** The one-term approximation of the center value, valid for Fo > 0.2. */
  oneTermCenter: number;
  terms: number;
  warnings: string[];
  steps: Step[];
}

/** theta(x*, Fo) = sum C_n exp(-zeta_n^2 Fo) f(zeta_n x*), x* = x/L (wall, half thickness) or r/R. */
export function series(shape: SolidShape, bi: number, fo: number, xStar = 0): SeriesResult {
  need(Number.isFinite(bi) && bi > 0, 'biot', 'The Biot number must be above zero.');
  need(Number.isFinite(fo) && fo >= 0, 'fourier', 'The Fourier number must be zero or more.');
  need(xStar >= 0 && xStar <= 1, 'position', 'The position must lie between the center (0) and the surface (1).');
  const warnings: string[] = [];
  if (fo < 0.005) {
    warnings.push('fhTransWarnEarly');
  }
  const zMax = fo === 0 ? 400 : Math.min(400, Math.sqrt(38 / fo) + 1);
  if (bi > 1e6)
    throw new CalcError(
      'biot',
      'The Biot number is effectively infinite: use a fixed surface temperature (Bi = 1000 is a good stand-in).',
    );
  const zs = eigenvalues(shape, bi, zMax);
  need(zs.length > 0, 'eigen', 'No eigenvalues were found for these inputs.');
  let theta = 0;
  let center = 0;
  let surface = 0;
  let q = 0;
  for (const z of zs) {
    const c = coefficient(shape, z);
    const e = Math.exp(-z * z * fo);
    theta += c * e * shapeFunction(shape, z, xStar);
    center += c * e;
    surface += c * e * shapeFunction(shape, z, 1);
    q += c * e * heatFactor(shape, z);
  }
  const z1 = zs[0]!;
  const c1 = coefficient(shape, z1);
  if (fo > 0 && fo < 0.2) warnings.push('fhTransWarnOneTerm');
  const steps: Step[] = [
    {
      key: 'fhTransEigen',
      vars: { z1: fmt(z1, 6), c1: fmt(c1, 6) },
      math: `\\zeta_1 = ${fmt(z1, 6)},\\ C_1 = ${fmt(c1, 6)}`,
    },
    {
      key: 'fhTransSeries',
      vars: { n: String(zs.length), th: fmt(theta, 5) },
      math: `\\theta = \\sum_{n} C_n e^{-\\zeta_n^2 Fo} f(\\zeta_n x^*) = ${fmt(theta, 5)}`,
    },
    {
      key: 'fhTransHeat',
      vars: { q: fmt(1 - q, 5) },
      math: `\\frac{Q}{Q_0} = 1 - \\sum_n C_n e^{-\\zeta_n^2 Fo}\\,g(\\zeta_n) = ${fmt(1 - q, 5)}`,
    },
  ];
  return {
    biot: bi,
    fourier: fo,
    theta,
    center,
    surface,
    heatFraction: 1 - q,
    zeta1: z1,
    c1,
    oneTermCenter: c1 * Math.exp(-z1 * z1 * fo),
    terms: zs.length,
    warnings,
    steps,
  };
}

export interface SolidInput {
  shape: SolidShape;
  /** Half thickness (wall) or radius (cylinder, sphere), m. */
  size: number;
  /** Thermal diffusivity (m2/s) or mass diffusivity. */
  alpha: number;
  /** Conductivity k (W/m K) with h in W/m2 K, or any pair with the same ratio h/k (1/m): the Biot number is h L / k. */
  k: number;
  h: number;
  tInitial: number;
  tFluid: number;
  /** Position as a fraction of the half thickness or radius. */
  xStar?: number;
  time?: number;
  /** Target temperature at xStar; the tool finds the time. */
  target?: number;
}

export interface SolidResult {
  biot: number;
  fourier: number;
  temperature: number;
  center: number;
  surface: number;
  heatFraction: number;
  /** Energy transferred (J per unit of rho cp V (T_i - T_inf) is the fraction) when rho cp is known: not computed here. */
  timeToTarget?: number;
  series: SeriesResult;
  steps: Step[];
}

const T_OF = (inp: SolidInput, theta: number) => inp.tFluid + theta * (inp.tInitial - inp.tFluid);

/** Full problem in dimensional form. */
export function solid(inp: SolidInput): SolidResult {
  positive(inp.size, 'The size');
  positive(inp.alpha, 'The diffusivity');
  positive(inp.k, 'The conductivity');
  positive(inp.h, 'The heat transfer coefficient');
  need(inp.tInitial !== inp.tFluid, 'same', 'The solid starts at the fluid temperature, so nothing changes.');
  const bi = (inp.h * inp.size) / inp.k;
  const x = inp.xStar ?? 0;
  let time = inp.time;
  let timeToTarget: number | undefined;
  if (inp.target !== undefined) {
    const goal = (inp.target - inp.tFluid) / (inp.tInitial - inp.tFluid);
    need(
      goal > 0 && goal < 1,
      'target',
      'The target temperature must lie between the initial and the fluid temperatures, and cannot equal the fluid temperature.',
    );
    const g = (fo: number) => series('wall' === inp.shape ? 'wall' : inp.shape, bi, fo, x).theta - goal;
    let hi = 0.05;
    let guard = 0;
    while (g(hi) > 0) {
      hi *= 2;
      if (++guard > 40) throw new CalcError('range', 'The target is not reached in any reasonable time.');
    }
    const fo = brent(g, 1e-9, hi, 1e-13);
    timeToTarget = (fo * inp.size ** 2) / inp.alpha;
    time = timeToTarget;
  }
  need(
    time !== undefined && Number.isFinite(time) && time >= 0,
    'time',
    'Give a time, or a target temperature to find the time for.',
  );
  const fo = (inp.alpha * time!) / inp.size ** 2;
  const s = series(inp.shape, bi, fo, x);
  return {
    biot: bi,
    fourier: fo,
    temperature: T_OF(inp, s.theta),
    center: T_OF(inp, s.center),
    surface: T_OF(inp, s.surface),
    heatFraction: s.heatFraction,
    timeToTarget,
    series: s,
    steps: [
      {
        key: 'fhTransDimensionless',
        vars: { Bi: fmt(bi, 4), Fo: fmt(fo, 4) },
        math: `Bi = \\frac{hL}{k} = ${fmt(bi, 4)},\\ Fo = \\frac{\\alpha t}{L^2} = ${fmt(fo, 4)}`,
      },
      ...s.steps,
    ],
  };
}

/** Temperature profile samples at one time. */
export function profile(inp: SolidInput, time: number, points = 21): { x: number[]; temperature: number[] } {
  const bi = (inp.h * inp.size) / inp.k;
  const fo = (inp.alpha * time) / inp.size ** 2;
  const x = Array.from({ length: points }, (_, i) => i / (points - 1));
  return { x, temperature: x.map((xs) => T_OF(inp, series(inp.shape, bi, fo, xs).theta)) };
}

// --- semi-infinite solid -----------------------------------------------------------------------------------------

export type SemiSurface = 'temperature' | 'flux' | 'convection';

export interface SemiInput {
  surface: SemiSurface;
  alpha: number;
  k: number;
  tInitial: number;
  /** Depth (m) and time (s). */
  depth: number;
  time: number;
  /** Surface temperature (temperature), heat flux into the solid W/m2 (flux), or fluid temperature (convection). */
  value: number;
  h?: number;
}

export interface SemiResult {
  temperature: number;
  eta: number;
  steps: Step[];
}

/** Semi-infinite solid with a fixed surface temperature, a constant surface heat flux, or surface convection. */
export function semiInfinite(inp: SemiInput): SemiResult {
  positive(inp.alpha, 'The diffusivity');
  positive(inp.k, 'The conductivity');
  need(Number.isFinite(inp.depth) && inp.depth >= 0, 'depth', 'The depth must be zero or more.');
  positive(inp.time, 'The time');
  const root = Math.sqrt(inp.alpha * inp.time);
  const eta = inp.depth / (2 * root);
  let t: number;
  const steps: Step[] = [
    { key: 'fhTransEta', vars: { eta: fmt(eta, 5) }, math: `\\eta = \\frac{x}{2\\sqrt{\\alpha t}} = ${fmt(eta, 5)}` },
  ];
  switch (inp.surface) {
    case 'temperature':
      t = inp.value + (inp.tInitial - inp.value) * erf(eta);
      steps.push({
        key: 'fhTransSemiT',
        vars: { T: fmt(t) },
        math: `\\frac{T - T_s}{T_i - T_s} = \\operatorname{erf}(\\eta) \\Rightarrow T = ${fmt(t)}`,
      });
      break;
    case 'flux':
      t =
        inp.tInitial +
        ((2 * inp.value * root) / (inp.k * Math.sqrt(Math.PI))) * Math.exp(-eta * eta) -
        ((inp.value * inp.depth) / inp.k) * erfc(eta);
      steps.push({
        key: 'fhTransSemiQ',
        vars: { T: fmt(t) },
        math: `T - T_i = \\frac{2q''\\sqrt{\\alpha t/\\pi}}{k}e^{-\\eta^2} - \\frac{q'' x}{k}\\operatorname{erfc}(\\eta) = ${fmt(t - inp.tInitial)}`,
      });
      break;
    case 'convection': {
      positive(inp.h ?? NaN, 'The heat transfer coefficient');
      const h = inp.h!;
      const b = (h * root) / inp.k;
      // exp(h x/k + h^2 alpha t/k^2) erfc(eta + b) = exp(-eta^2) erfcx(eta + b) because (eta + b)^2 = eta^2 + h x/k + b^2
      const second = Math.exp(-eta * eta) * erfcx(eta + b);
      const theta = erfc(eta) - second;
      t = inp.tInitial + theta * (inp.value - inp.tInitial);
      steps.push({
        key: 'fhTransSemiH',
        vars: { T: fmt(t) },
        math: `\\frac{T - T_i}{T_\\infty - T_i} = \\operatorname{erfc}\\eta - e^{hx/k + h^2\\alpha t/k^2}\\operatorname{erfc}\\left(\\eta + \\frac{h\\sqrt{\\alpha t}}{k}\\right) = ${fmt(theta, 5)}`,
      });
      break;
    }
  }
  return { temperature: t, eta, steps };
}
