// Standard atmosphere: the US Standard Atmosphere 1976 from -5 km to 86 km geometric altitude (84.852 km
// geopotential), its seven lapse-rate layers integrated hydrostatically, viscosity by Sutherland's law, and the
// inverses (pressure altitude, density altitude, temperature in the troposphere) by Brent's method.
import { AeroError, brent, eq, finite, num, sample, step, tex, type AeroStep, type XY } from '../common';

export const SOURCES = ['U.S. Standard Atmosphere, 1976 (NOAA, NASA and USAF; public domain).'] as const;

export const R0 = 6356766; // effective Earth radius, m
export const G0 = 9.80665; // m/s^2
export const R_STAR = 8314.32; // J/(kmol K), the 1976 value
export const M0 = 28.9644; // kg/kmol
export const R_AIR = R_STAR / M0; // 287.053 J/(kg K)
export const GAMMA_AIR = 1.4;
export const SUTHERLAND_BETA = 1.458e-6; // kg/(m s K^0.5)
export const SUTHERLAND_S = 110.4; // K
export const P_SL = 101325;
export const T_SL = 288.15;
export const RHO_SL = P_SL / (R_AIR * T_SL);

export type LayerName =
  'troposphere' | 'tropopause' | 'stratosphere' | 'stratosphere2' | 'stratopause' | 'mesosphere' | 'mesosphere2';

interface Layer {
  readonly name: LayerName;
  readonly base: number; // geopotential, m
  readonly lapse: number; // K/m
  readonly T: number; // base temperature, K
  readonly p: number; // base pressure, Pa
}

const DEFS: readonly [LayerName, number, number][] = [
  ['troposphere', 0, -6.5e-3],
  ['tropopause', 11000, 0],
  ['stratosphere', 20000, 1.0e-3],
  ['stratosphere2', 32000, 2.8e-3],
  ['stratopause', 47000, 0],
  ['mesosphere', 51000, -2.8e-3],
  ['mesosphere2', 71000, -2.0e-3],
];

/** The top of the model: 86 km geometric. */
export const H_TOP = 84852;
export const H_BOTTOM = (-5000 * R0) / (R0 - 5000); // -5 km geometric

function layerPressure(p: number, T: number, lapse: number, dH: number): number {
  if (lapse === 0) return p * Math.exp((-G0 * dH) / (R_AIR * T));
  return p * Math.pow(T / (T + lapse * dH), G0 / (R_AIR * lapse));
}

/** The seven layers with base temperature and pressure, built from sea level by integrating each layer in turn. */
export const LAYERS: readonly Layer[] = (() => {
  const out: Layer[] = [];
  let T = T_SL;
  let p = P_SL;
  DEFS.forEach(([name, base, lapse], i) => {
    out.push({ name, base, lapse, T, p });
    const next = DEFS[i + 1]?.[1] ?? H_TOP;
    p = layerPressure(p, T, lapse, next - base);
    T += lapse * (next - base);
  });
  return out;
})();

export const geopotentialOf = (z: number) => (R0 * z) / (R0 + z);
export const geometricOf = (H: number) => (R0 * H) / (R0 - H);

function layerAt(H: number): Layer {
  let found = LAYERS[0]!;
  for (const layer of LAYERS) if (H >= layer.base) found = layer;
  return found;
}

/** Standard T and p at geopotential altitude H in m (no offset). */
export function standard(H: number): { T: number; p: number; layer: Layer } {
  const layer = layerAt(H);
  const dH = H - layer.base;
  return { T: layer.T + layer.lapse * dH, p: layerPressure(layer.p, layer.T, layer.lapse, dH), layer };
}

export const sutherland = (T: number) => (SUTHERLAND_BETA * Math.pow(T, 1.5)) / (T + SUTHERLAND_S);

export type AltitudeKind = 'geometric' | 'geopotential';
export type AtmosphereMode = 'altitude' | 'pressure' | 'density' | 'temperature';

export interface AtmosphereInput {
  readonly mode: AtmosphereMode;
  /** Altitude in m (mode altitude). */
  readonly altitude?: number;
  readonly kind?: AltitudeKind;
  /** Pa, kg/m^3 or K for the inverse modes. */
  readonly value?: number;
  /** ISA + dT, in K. Pressure stays standard; temperature and density shift. */
  readonly dT?: number;
}

export interface AtmosphereResult {
  readonly z: number;
  readonly H: number;
  readonly T: number;
  readonly p: number;
  readonly rho: number;
  readonly a: number;
  readonly mu: number;
  readonly nu: number;
  readonly g: number;
  readonly theta: number;
  readonly delta: number;
  readonly sigma: number;
  readonly layer: LayerName;
  readonly steps: readonly AeroStep[];
  readonly plot: { readonly T: readonly XY[]; readonly p: readonly XY[]; readonly rho: readonly XY[] };
}

function checkH(H: number): void {
  if (H < H_BOTTOM - 1e-6 || H > H_TOP + 1e-6) throw new AeroError('altitudeRange');
}

/** Solves for the geopotential altitude where g(H) = target, scanning the layers for a sign change. */
function invert(g: (H: number) => number, target: number, lo = H_BOTTOM, hi = H_TOP): number {
  const f = (H: number) => g(H) - target;
  const grid = [lo, ...LAYERS.slice(1).map((l) => l.base), hi];
  for (let i = 0; i + 1 < grid.length; i += 1) {
    const a = grid[i]!;
    const b = grid[i + 1]!;
    if (f(a) === 0) return a;
    if (f(a) * f(b) < 0) return brent(f, a, b, 1e-9).root;
  }
  if (f(hi) === 0) return hi;
  throw new AeroError('inverseRange');
}

/** The altitude asked for, given directly or found from a pressure, density or temperature. */
function resolveAltitude(input: AtmosphereInput, dT: number, steps: AeroStep[]): number {
  if (input.mode === 'altitude') {
    const alt = finite(input.altitude ?? NaN, 'h');
    if (input.kind !== 'geometric') {
      checkH(alt);
      return alt;
    }
    if (alt < -5000 - 1e-6 || alt > 86000 + 1e-6) throw new AeroError('altitudeRange');
    const H = geopotentialOf(alt);
    const zKm = tex(alt / 1000, 6);
    const math = eq(
      'H = \\frac{r_0 z}{r_0 + z}',
      `\\frac{6356.766 \\times ${zKm}}{6356.766 + ${zKm}}`,
      `${tex(H / 1000, 6)}\\ \\text{km}`,
    );
    steps.push(step('atmGeopotential', math));
    return H;
  }
  const value = finite(input.value ?? NaN, input.mode);
  if (value <= 0) throw new AeroError('notPositive', { name: input.mode });
  if (input.mode === 'pressure') {
    steps.push(step('atmInvertPressure', undefined, { value: num(value) }));
    return invert((h) => standard(h).p, value);
  }
  if (input.mode === 'density') {
    steps.push(step('atmInvertDensity', undefined, { value: num(value) }));
    return invert((h) => {
      const s = standard(h);
      return s.p / (R_AIR * (s.T + dT));
    }, value);
  }
  const lo = LAYERS[1]!.T + dT;
  const hi = standard(H_BOTTOM).T + dT;
  if (value < lo - 1e-9 || value > hi + 1e-9) throw new AeroError('temperatureRange', { lo: num(lo), hi: num(hi) });
  steps.push(step('atmInvertTemperature', undefined, { value: num(value) }));
  return invert((h) => standard(h).T + dT, value, H_BOTTOM, LAYERS[1]!.base);
}

/** The layer, temperature, and pressure steps for an altitude in a layer. */
function layerSteps(H: number, layer: Layer, Tstd: number, T: number, p: number, dT: number): AeroStep[] {
  const steps: AeroStep[] = [
    step('atmLayer', undefined, {
      layer: `@layer.${layer.name}`,
      base: num(layer.base / 1000, 5),
      Tb: num(layer.T, 6),
      pb: num(layer.p, 6),
      lapse: num(layer.lapse * 1000, 3),
    }),
  ];
  const lapse = tex(layer.lapse * 1000, 3);
  const span = `(${tex(H / 1000, 6)} - ${tex(layer.base / 1000, 4)})`;
  const Tsub = `${tex(layer.T, 6)} + (${lapse})${span}`;
  steps.push(step('atmTemperature', eq('T = T_b + L (H - H_b)', Tsub, `${tex(Tstd, 6)}\\ \\text{K}`)));
  if (dT !== 0) steps.push(step('atmOffset', eq(`T = ${tex(Tstd, 6)} + (${tex(dT, 4)})`, `${tex(T, 6)}\\ \\text{K}`)));
  const pb = tex(layer.p, 6);
  const Tb = tex(layer.T, 6);
  const pa = `${tex(p, 6)}\\ \\text{Pa}`;
  if (layer.lapse === 0) {
    const frac = `\\frac{9.80665 \\times ${tex(H - layer.base, 6)}}{${tex(R_AIR, 6)} \\times ${Tb}}`;
    const form = 'p = p_b \\exp\\left[-\\frac{g_0 (H - H_b)}{R T_b}\\right]';
    steps.push(step('atmPressureIso', eq(form, `${pb} \\exp\\left[-${frac}\\right]`, pa)));
  } else {
    const power = tex(G0 / (R_AIR * layer.lapse), 5);
    const sub = `${pb} \\left(\\frac{${Tb}}{${tex(Tstd, 6)}}\\right)^{${power}}`;
    steps.push(step('atmPressureLapse', eq('p = p_b \\left(\\frac{T_b}{T}\\right)^{g_0/(R L)}', sub, pa)));
  }
  return steps;
}

/** Density, speed of sound, and viscosity from the temperature and pressure. */
function propertySteps(T: number, p: number, rho: number, a: number, mu: number): AeroStep[] {
  const R = tex(R_AIR, 6);
  const Tt = tex(T, 6);
  return [
    step(
      'atmDensity',
      eq('\\rho = \\frac{p}{R T}', `\\frac{${tex(p, 6)}}{${R} \\times ${Tt}}`, `${tex(rho, 6)}\\ \\text{kg/m}^3`),
    ),
    step(
      'atmSound',
      eq('a = \\sqrt{\\gamma R T}', `\\sqrt{1.4 \\times ${R} \\times ${Tt}}`, `${tex(a, 6)}\\ \\text{m/s}`),
    ),
    step(
      'atmViscosity',
      eq(
        '\\mu = \\frac{\\beta T^{3/2}}{T + S}',
        `\\frac{1.458 \\times 10^{-6} \\times ${Tt}^{3/2}}{${Tt} + 110.4}`,
        `${tex(mu, 5)}\\ \\text{Pa s}`,
      ),
    ),
  ];
}

export function atmosphere(input: AtmosphereInput): AtmosphereResult {
  const dT = finite(input.dT ?? 0, 'ΔT');
  const steps: AeroStep[] = [];
  const H = resolveAltitude(input, dT, steps);
  const { T: Tstd, p, layer } = standard(H);
  const T = Tstd + dT;
  if (T <= 0) throw new AeroError('temperatureNegative');
  const z = geometricOf(H);
  const rho = p / (R_AIR * T);
  const a = Math.sqrt(GAMMA_AIR * R_AIR * T);
  const mu = sutherland(T);
  const g = G0 * Math.pow(R0 / (R0 + z), 2);
  steps.push(...layerSteps(H, layer, Tstd, T, p, dT), ...propertySteps(T, p, rho, a, mu));
  return {
    z,
    H,
    T,
    p,
    rho,
    a,
    mu,
    nu: mu / rho,
    g,
    theta: T / T_SL,
    delta: p / P_SL,
    sigma: rho / RHO_SL,
    layer: layer.name,
    steps,
    plot: plotData(dT),
  };
}

/** T (K), p (kPa) and rho (kg/m^3) against geopotential altitude in km, 0 to 86 km geometric. */
function plotData(dT: number) {
  const at = (f: (s: { T: number; p: number }) => number) =>
    sample((km) => f(standard(km * 1000)), 0, H_TOP / 1000, 170);
  return {
    T: at((s) => s.T + dT),
    p: at((s) => s.p / 1000),
    rho: at((s) => s.p / (R_AIR * (s.T + dT))),
  };
}
