// Property tables for the two fluids the course problems start from: liquid water and air. Water is the saturated
// liquid from 0 to 100 degrees Celsius, with the density from the Kell formula; air is an ideal gas at the given
// pressure, with the viscosity, conductivity and specific heat of the standard table. Values between rows are
// interpolated, so they are good for homework to about a percent, not for design.
import { CalcError, fmt, need, positive, temp, type Step } from '../numeric';

/** One row of a table: temperature (K), dynamic viscosity (Pa s), conductivity (W/m K), specific heat (J/kg K), Pr. */
export type PropertyRow = readonly [t: number, mu: number, k: number, cp: number, pr: number];

/** Saturated liquid water (Incropera, Appendix A, Table A.6). */
export const WATER_TABLE: readonly PropertyRow[] = [
  [273.15, 1750e-6, 0.569, 4217, 12.99],
  [280, 1422e-6, 0.582, 4198, 10.26],
  [290, 1080e-6, 0.598, 4184, 7.56],
  [300, 855e-6, 0.613, 4179, 5.83],
  [310, 695e-6, 0.628, 4178, 4.62],
  [320, 577e-6, 0.64, 4180, 3.77],
  [330, 489e-6, 0.65, 4184, 3.15],
  [340, 420e-6, 0.66, 4188, 2.66],
  [350, 365e-6, 0.668, 4195, 2.29],
  [360, 324e-6, 0.674, 4203, 2.02],
  [370, 289e-6, 0.679, 4214, 1.8],
  [373.15, 282e-6, 0.68, 4217, 1.76],
];

/** Air at one atmosphere (Incropera, Appendix A, Table A.4). */
export const AIR_TABLE: readonly PropertyRow[] = [
  [250, 159.6e-7, 22.3e-3, 1006, 0.72],
  [300, 184.6e-7, 26.3e-3, 1007, 0.707],
  [350, 208.2e-7, 30e-3, 1009, 0.7],
  [400, 230.1e-7, 33.8e-3, 1014, 0.69],
  [450, 250.7e-7, 37.3e-3, 1021, 0.686],
  [500, 270.1e-7, 40.7e-3, 1030, 0.684],
  [600, 305.8e-7, 46.9e-3, 1051, 0.685],
];

export const AIR_GAS_CONSTANT = 287.05;

export interface FluidProperties {
  /** Density (kg/m3). */
  density: number;
  /** Dynamic viscosity (Pa s). */
  viscosity: number;
  /** Kinematic viscosity (m2/s). */
  kinematic: number;
  /** Thermal conductivity (W/m K). */
  conductivity: number;
  /** Specific heat (J/kg K). */
  specificHeat: number;
  /** Thermal diffusivity (m2/s). */
  diffusivity: number;
  /** Prandtl number. */
  prandtl: number;
  /** Volumetric expansion coefficient (1/K). */
  expansion: number;
  steps: Step[];
}

/** Density of air-free water from the Kell formula, for t in degrees Celsius from 0 to 100 (kg/m3). */
export function waterDensity(celsius: number): number {
  const t = celsius;
  const top =
    999.83952 +
    16.945176 * t -
    7.9870401e-3 * t ** 2 -
    46.170461e-6 * t ** 3 +
    105.56302e-9 * t ** 4 -
    280.54253e-12 * t ** 5;
  return top / (1 + 16.87985e-3 * t);
}

function between(table: readonly PropertyRow[], t: number): { lo: PropertyRow; hi: PropertyRow; x: number } {
  const first = table[0]![0];
  const last = table.at(-1)![0];
  if (!(t >= first && t <= last))
    throw new CalcError('range', `The table covers ${fmt(first - 273.15, 4)} to ${fmt(last - 273.15, 4)} °C.`);
  let i = table.findIndex((row, k) => row[0] <= t && (table[k + 1] === undefined || table[k + 1]![0] > t));
  i = Math.min(Math.max(i, 0), table.length - 2);
  const lo = table[i]!;
  const hi = table[i + 1]!;
  return { lo, hi, x: (t - lo[0]) / (hi[0] - lo[0]) };
}

const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** Water at a temperature (K). Viscosity is interpolated in ln(mu) against 1/T, the others linearly. */
export function water(t: number): FluidProperties {
  positive(t, 'The temperature');
  const { lo, hi, x } = between(WATER_TABLE, t);
  const xr = (1 / lo[0] - 1 / t) / (1 / lo[0] - 1 / hi[0]);
  const mu = Math.exp(lerp(Math.log(lo[1]), Math.log(hi[1]), xr));
  const k = lerp(lo[2], hi[2], x);
  const cp = lerp(lo[3], hi[3], x);
  const rho = waterDensity(t - 273.15);
  const h = 0.01;
  const beta = -(waterDensity(t - 273.15 + h) - waterDensity(t - 273.15 - h)) / (2 * h * rho);
  return finish('water', t, rho, mu, k, cp, beta);
}

/** Air at a temperature (K) and pressure (Pa): an ideal gas, so beta = 1/T. */
export function air(t: number, pressure = 101325): FluidProperties {
  positive(t, 'The temperature');
  need(Number.isFinite(pressure) && pressure > 0, 'pressure', 'The pressure must be above zero.');
  const { lo, hi, x } = between(AIR_TABLE, t);
  const mu = lerp(lo[1], hi[1], x);
  const k = lerp(lo[2], hi[2], x);
  const cp = lerp(lo[3], hi[3], x);
  return finish('air', t, pressure / (AIR_GAS_CONSTANT * t), mu, k, cp, 1 / t);
}

function finish(
  name: string,
  t: number,
  density: number,
  viscosity: number,
  conductivity: number,
  specificHeat: number,
  expansion: number,
): FluidProperties {
  const kinematic = viscosity / density;
  const diffusivity = conductivity / (density * specificHeat);
  const prandtl = kinematic / diffusivity;
  return {
    density,
    viscosity,
    kinematic,
    conductivity,
    specificHeat,
    diffusivity,
    prandtl,
    expansion,
    steps: [
      {
        key: 'fhPropsTable',
        vars: { fluid: name, T: temp(t) },
        math: `\\nu = \\frac{\\mu}{\\rho} = ${fmt(kinematic)},\\quad Pr = \\frac{c_p\\mu}{k} = ${fmt(prandtl)}`,
      },
    ],
  };
}
