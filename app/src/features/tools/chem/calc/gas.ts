// Gas laws: the ideal gas law solved for any one unknown, the combined gas law, Dalton's law, Graham's law, and gas
// density. Pressures, volumes, and temperatures take the units students meet, and convert to atm, L, and K inside.
import { sig } from './stoich';

/** The gas constant in L·atm/(mol·K). */
export const R_ATM = 0.082057366;

export type PressureUnit = 'atm' | 'kPa' | 'Pa' | 'bar' | 'mmHg' | 'torr' | 'psi';
export type VolumeUnit = 'L' | 'mL' | 'm³';
export type TemperatureUnit = 'K' | '°C' | '°F';

const PRESSURE: Record<PressureUnit, number> = {
  atm: 1,
  kPa: 1 / 101.325,
  Pa: 1 / 101325,
  bar: 1 / 1.01325,
  mmHg: 1 / 760,
  torr: 1 / 760,
  psi: 1 / 14.6959488,
};
const VOLUME: Record<VolumeUnit, number> = { L: 1, mL: 0.001, 'm³': 1000 };

export const PRESSURE_UNITS = Object.keys(PRESSURE) as PressureUnit[];
export const VOLUME_UNITS = Object.keys(VOLUME) as VolumeUnit[];
export const TEMPERATURE_UNITS: TemperatureUnit[] = ['K', '°C', '°F'];

export const toAtm = (value: number, unit: PressureUnit) => value * PRESSURE[unit];
export const fromAtm = (value: number, unit: PressureUnit) => value / PRESSURE[unit];
export const toLiters = (value: number, unit: VolumeUnit) => value * VOLUME[unit];
export const fromLiters = (value: number, unit: VolumeUnit) => value / VOLUME[unit];
export const toKelvin = (value: number, unit: TemperatureUnit) =>
  unit === 'K' ? value : unit === '°C' ? value + 273.15 : ((value - 32) * 5) / 9 + 273.15;
export const fromKelvin = (value: number, unit: TemperatureUnit) =>
  unit === 'K' ? value : unit === '°C' ? value - 273.15 : ((value - 273.15) * 9) / 5 + 32;

export interface Quantity<U extends string> {
  value: number | null;
  unit: U;
}

export interface IdealInput {
  p: Quantity<PressureUnit>;
  v: Quantity<VolumeUnit>;
  n: number | null;
  t: Quantity<TemperatureUnit>;
}

export type GasResult =
  | { ok: true; unknown: 'p' | 'v' | 'n' | 't'; value: number; unit: string; steps: string[] }
  | { ok: false; reason: 'count' | 'range' };

/** PV = nRT, with exactly one of the four left empty. */
export function idealGas(input: IdealInput): GasResult {
  const empty = (['p', 'v', 'n', 't'] as const).filter((key) => (key === 'n' ? input.n : input[key].value) === null);
  if (empty.length !== 1) return { ok: false, reason: 'count' };
  const P = input.p.value === null ? null : toAtm(input.p.value, input.p.unit);
  const V = input.v.value === null ? null : toLiters(input.v.value, input.v.unit);
  const T = input.t.value === null ? null : toKelvin(input.t.value, input.t.unit);
  const N = input.n;
  if ([P, V, N, T].some((x) => x !== null && !(x > 0))) return { ok: false, reason: 'range' };
  const R = R_ATM;
  const head = `PV = nRT with R = ${R_ATM.toFixed(5)} L·atm/(mol·K)`;
  switch (empty[0]) {
    case 'p': {
      const p = (N! * R * T!) / V!;
      return {
        ok: true,
        unknown: 'p',
        value: fromAtm(p, input.p.unit),
        unit: input.p.unit,
        steps: [
          head,
          `P = nRT/V = (${sig(N!)} × ${R.toFixed(5)} × ${sig(T!)}) ÷ ${sig(V!)} = ${sig(p)} atm`,
          `= ${sig(fromAtm(p, input.p.unit))} ${input.p.unit}`,
        ],
      };
    }
    case 'v': {
      const v = (N! * R * T!) / P!;
      return {
        ok: true,
        unknown: 'v',
        value: fromLiters(v, input.v.unit),
        unit: input.v.unit,
        steps: [
          head,
          `V = nRT/P = (${sig(N!)} × ${R.toFixed(5)} × ${sig(T!)}) ÷ ${sig(P!)} = ${sig(v)} L`,
          `= ${sig(fromLiters(v, input.v.unit))} ${input.v.unit}`,
        ],
      };
    }
    case 'n': {
      const n = (P! * V!) / (R * T!);
      return {
        ok: true,
        unknown: 'n',
        value: n,
        unit: 'mol',
        steps: [head, `n = PV/RT = (${sig(P!)} × ${sig(V!)}) ÷ (${R.toFixed(5)} × ${sig(T!)}) = ${sig(n)} mol`],
      };
    }
    default: {
      const k = (P! * V!) / (N! * R);
      return {
        ok: true,
        unknown: 't',
        value: fromKelvin(k, input.t.unit),
        unit: input.t.unit,
        steps: [
          head,
          `T = PV/nR = (${sig(P!)} × ${sig(V!)}) ÷ (${sig(N!)} × ${R.toFixed(5)}) = ${sig(k)} K`,
          `= ${sig(fromKelvin(k, input.t.unit))} ${input.t.unit}`,
        ],
      };
    }
  }
}

export interface CombinedInput {
  p1: number | null;
  v1: number | null;
  t1: number | null;
  p2: number | null;
  v2: number | null;
  t2: number | null;
}

/** P1V1/T1 = P2V2/T2 with one value empty. Temperatures must be in kelvins; the others in matching units. */
export function combinedGas(
  input: CombinedInput,
): { ok: true; key: keyof CombinedInput; value: number; steps: string[] } | { ok: false } {
  const keys = Object.keys(input) as (keyof CombinedInput)[];
  const empty = keys.filter((k) => input[k] === null);
  if (empty.length !== 1) return { ok: false };
  const key = empty[0];
  const v = input as Record<keyof CombinedInput, number>;
  if (keys.some((k) => k !== key && !(v[k] > 0))) return { ok: false };
  let value: number;
  switch (key) {
    case 'p1':
      value = (v.p2 * v.v2 * v.t1) / (v.t2 * v.v1);
      break;
    case 'v1':
      value = (v.p2 * v.v2 * v.t1) / (v.t2 * v.p1);
      break;
    case 't1':
      value = (v.p1 * v.v1 * v.t2) / (v.p2 * v.v2);
      break;
    case 'p2':
      value = (v.p1 * v.v1 * v.t2) / (v.t1 * v.v2);
      break;
    case 'v2':
      value = (v.p1 * v.v1 * v.t2) / (v.t1 * v.p2);
      break;
    default:
      value = (v.p2 * v.v2 * v.t1) / (v.p1 * v.v1);
  }
  return { ok: true, key, value, steps: ['P₁V₁/T₁ = P₂V₂/T₂ (T in kelvins)', `${key} = ${sig(value)}`] };
}

/** Dalton: total pressure from partial pressures, or each partial pressure from mole fractions. */
export function daltonPartials(moles: number[], total: number): number[] {
  const sum = moles.reduce((a, b) => a + b, 0);
  return moles.map((n) => (total * n) / sum);
}

/** Graham: rate1/rate2 = sqrt(M2/M1). */
export function grahamRatio(m1: number, m2: number): number {
  return Math.sqrt(m2 / m1);
}

/** Density of an ideal gas in g/L from molar mass (g/mol), pressure (atm), and temperature (K). */
export function gasDensity(molar: number, pAtm: number, tK: number): number {
  return (pAtm * molar) / (R_ATM * tK);
}
