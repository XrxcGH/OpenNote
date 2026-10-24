// The kinds of quantity the fluid mechanics and heat transfer tools read and show, each with the unit it shows in SI
// and in US customary units. The engines work in base SI (m, kg, s, Pa, K); these units are only for people. The SI
// set is m, mm, kPa, and degrees Celsius, and the US set is ft, in, psi, and degrees Fahrenheit.
import { evaluate } from '../../../../core/expr';
import { parseUnit, sameDim, type Dim } from '../../../../core/units';
import { FluidHeatError } from './types';

export type System = 'si' | 'us';

interface Shown {
  /** The unit as people read it. */
  readonly label: string;
  /** SI base units in one of this unit. */
  readonly factor: number;
  /** How the unit is typed, when its label cannot be read back. */
  readonly typed?: string;
  /** Kelvin at zero of this unit, for a temperature scale that starts elsewhere. */
  readonly offset?: number;
}

interface KindDef {
  readonly dim: Dim;
  readonly si: Shown;
  readonly us: Shown;
}

const D = (m = 0, kg = 0, s = 0, K = 0): Dim => [m, kg, s, K, 0, 0, 0];
const IN = 0.0254;
const FT = 0.3048;
const LB = 0.45359237;
const LBF = 4.4482216152605;
const BTU = 1055.05585262;
const shown = (label: string, factor: number, typed?: string, offset?: number): Shown => ({
  label,
  factor,
  ...(typed ? { typed } : {}),
  ...(offset === undefined ? {} : { offset }),
});

export const KINDS = {
  length: { dim: D(1), si: shown('mm', 1e-3), us: shown('in', IN) },
  span: { dim: D(1), si: shown('m', 1), us: shown('ft', FT) },
  area: { dim: D(2), si: shown('m²', 1), us: shown('ft²', FT ** 2) },
  smallArea: { dim: D(2), si: shown('cm²', 1e-4), us: shown('in²', IN ** 2) },
  volume: { dim: D(3), si: shown('m³', 1), us: shown('ft³', FT ** 3) },
  density: { dim: D(-3, 1), si: shown('kg/m³', 1), us: shown('lb/ft³', LB / FT ** 3) },
  mass: { dim: D(0, 1), si: shown('kg', 1), us: shown('lb', LB) },
  force: { dim: D(1, 1, -2), si: shown('N', 1), us: shown('lbf', LBF) },
  pressure: { dim: D(-1, 1, -2), si: shown('kPa', 1e3), us: shown('psi', LBF / IN ** 2) },
  smallPressure: { dim: D(-1, 1, -2), si: shown('Pa', 1), us: shown('psf', LBF / FT ** 2) },
  speed: { dim: D(1, 0, -1), si: shown('m/s', 1), us: shown('ft/s', FT) },
  flow: { dim: D(3, 0, -1), si: shown('L/s', 1e-3), us: shown('gpm', 0.003785411784 / 60, 'gal/min') },
  massFlow: { dim: D(0, 1, -1), si: shown('kg/s', 1), us: shown('lb/s', LB) },
  viscosity: { dim: D(-1, 1, -1), si: shown('mPa·s', 1e-3), us: shown('lb/(ft·s)', LB / FT) },
  kinematic: { dim: D(2, 0, -1), si: shown('mm²/s', 1e-6), us: shown('ft²/s', FT ** 2) },
  diffusivity: { dim: D(2, 0, -1), si: shown('cm²/s', 1e-4), us: shown('ft²/h', FT ** 2 / 3600) },
  power: { dim: D(2, 1, -3), si: shown('kW', 1e3), us: shown('hp', 745.69987158227) },
  heat: { dim: D(2, 1, -3), si: shown('W', 1), us: shown('Btu/h', BTU / 3600) },
  massFlux: { dim: D(-2, 1, -1), si: shown('kg/(m²·s)', 1), us: shown('lb/(h·ft²)', LB / 3600 / FT ** 2) },
  heatFlux: { dim: D(0, 1, -3), si: shown('W/m²', 1), us: shown('Btu/(h·ft²)', BTU / 3600 / FT ** 2) },
  conductivity: {
    dim: D(1, 1, -3, -1),
    si: shown('W/(m·K)', 1),
    us: shown('Btu/(h·ft·°F)', BTU / 3600 / FT / (5 / 9)),
  },
  htc: { dim: D(0, 1, -3, -1), si: shown('W/(m²·K)', 1), us: shown('Btu/(h·ft²·°F)', BTU / 3600 / FT ** 2 / (5 / 9)) },
  specificHeat: { dim: D(2, 0, -2, -1), si: shown('kJ/(kg·K)', 1e3), us: shown('Btu/(lb·°F)', BTU / LB / (5 / 9)) },
  resistance: { dim: D(-2, -1, 3, 1), si: shown('K/W', 1), us: shown('°F·h/Btu', ((5 / 9) * 3600) / BTU) },
  temperature: {
    dim: D(0, 0, 0, 1),
    si: shown('°C', 1, '°C', 273.15),
    us: shown('°F', 5 / 9, '°F', 255.3722222222222),
  },
  tempChange: { dim: D(0, 0, 0, 1), si: shown('K', 1), us: shown('°F', 5 / 9) },
  rate: { dim: D(0, 0, -1), si: shown('1/s', 1, 's^-1'), us: shown('1/s', 1, 's^-1') },
  frequency: { dim: D(0, 0, -1), si: shown('Hz', 1), us: shown('Hz', 1) },
  pressureGradient: { dim: D(-2, 1, -2), si: shown('Pa/m', 1), us: shown('psi/ft', LBF / IN ** 2 / FT) },
  wavenumber: { dim: D(-1), si: shown('1/m', 1, 'm^-1'), us: shown('1/ft', 1 / FT, 'ft^-1') },
  expansion: { dim: D(0, 0, 0, -1), si: shown('1/K', 1, 'K^-1'), us: shown('1/°F', 9 / 5, 'degF^-1') },
  contact: {
    dim: D(0, -1, 3, 1),
    si: shown('m²·K/W', 1, 'm^2*K/W'),
    us: shown('h·ft²·°F/Btu', (3600 * FT ** 2 * (5 / 9)) / BTU, 'h*ft^2*degF/Btu'),
  },
  powerDensity: { dim: D(-1, 1, -3), si: shown('W/m³', 1, 'W/m^3'), us: shown('Btu/(h·ft³)', BTU / 3600 / FT ** 3) },
  wavelength: { dim: D(1), si: shown('µm', 1e-6), us: shown('µm', 1e-6) },
  spectral: {
    dim: D(-1, 1, -3),
    si: shown('W/(m²·µm)', 1e6, 'W/(m^2*um)'),
    us: shown('Btu/(h·ft²·µm)', (BTU / 3600 / FT ** 2) * 1e6, 'Btu/(h*ft^2*um)'),
  },
  conductance: { dim: D(2, 1, -3, -1), si: shown('W/K', 1), us: shown('Btu/(h·°F)', BTU / 3600 / (5 / 9)) },
  time: { dim: D(0, 0, 1), si: shown('s', 1), us: shown('s', 1) },
  angle: { dim: D(), si: shown('°', Math.PI / 180), us: shown('°', Math.PI / 180) },
  percent: { dim: D(), si: shown('%', 0.01), us: shown('%', 0.01) },
  count: { dim: D(), si: shown('', 1), us: shown('', 1) },
  ratio: { dim: D(), si: shown('', 1), us: shown('', 1) },
} as const satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;

/** The unit a kind shows in. */
export const unitOf = (kind: Kind, system: System): string => KINDS[kind][system].label;

/** The unit as it is typed after a number, so a bare number can keep its meaning when the system changes. */
export const typedUnit = (kind: Kind, system: System): string => {
  const one: Shown = KINDS[kind][system];
  // The expression reader takes "90 °" and "5 %" as numbers already, so these are typed another way or not at all.
  if (one.label === '°' && kind === 'angle') return 'deg';
  if (one.label === '%') return '';
  return one.typed ?? one.label;
};

/** A value in base SI, in the units a kind shows in. */
export const toShown = (value: number, kind: Kind, system: System): number =>
  (value - ((KINDS[kind][system] as Shown).offset ?? 0)) / KINDS[kind][system].factor;

/** A value in the units a kind shows in, in base SI. */
export const fromShown = (value: number, kind: Kind, system: System): number =>
  value * KINDS[kind][system].factor + ((KINDS[kind][system] as Shown).offset ?? 0);

/** What a person typed, as a number and the unit after it ('' when none). */
function splitTyped(text: string): { number: number; unit: string } | null {
  const whole = evaluate(text);
  if (whole.ok) return { number: whole.value, unit: '' };
  for (let i = 1; i < text.length; i += 1) {
    if (!/[A-Za-zµμΩ°%]/.test(text[i]) || !/[\s\d).]/.test(text[i - 1])) continue;
    const unit = text.slice(i).trim();
    if (!parseUnit(unit)) continue;
    const number = evaluate(text.slice(0, i).trim());
    if (number.ok) return { number: number.value, unit };
  }
  return null;
}

/**
 * Reads a typed quantity, such as "25", "25 mm", "1 kN·m", or "2*pi rad/s", into base SI. A bare number is in the
 * unit the kind shows in for the chosen system. A unit that measures something else is an error that names both.
 */
export function readQuantity(text: string, kind: Kind, system: System): number {
  const trimmed = text.trim();
  if (trimmed === '') throw new FluidHeatError('empty');
  const typed = splitTyped(trimmed);
  if (!typed || !Number.isFinite(typed.number)) throw new FluidHeatError('unreadable', trimmed);
  if (typed.unit === '') return fromShown(typed.number, kind, system);
  if (kind === 'tempChange' && /^(°F|degF)$/.test(typed.unit)) return (typed.number * 5) / 9;
  const unit = parseUnit(typed.unit);
  if (!unit) throw new FluidHeatError('unreadable', trimmed);
  const def: KindDef = KINDS[kind];
  if (!sameDim(unit, { factor: 1, dim: def.dim })) {
    throw new FluidHeatError('unitMismatch', `${typed.unit}|${def[system].label || '1'}`);
  }
  return typed.number * unit.factor + (kind === 'tempChange' ? 0 : (unit.offset ?? 0));
}
