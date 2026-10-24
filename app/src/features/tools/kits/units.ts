// Units for the kit tools. Each kind of quantity (pressure, energy per mass, conductivity) lists the units a student
// picks from in SI and in US customary units, built on core/units so a symbol means the same thing everywhere.
// Engines work in SI base units; toSI and fromSI convert at the edges, and formatQuantity writes a value with the
// tool's significant digits.
import { formatNumber } from '../../../core/expr';
import { parseUnit, superscriptPower } from '../../../core/units';
import { NumError } from './num/errors';

export type UnitSystem = 'SI' | 'US';

export interface UnitChoice {
  /** What the picker and the result show, such as "Btu/(lbm·°R)". */
  label: string;
  /** SI value = value · factor + offset. */
  factor: number;
  offset: number;
}

export type QuantityKind =
  | 'dimensionless'
  | 'length'
  | 'area'
  | 'volume'
  | 'mass'
  | 'amount'
  | 'time'
  | 'temperature'
  | 'temperatureDifference'
  | 'pressure'
  | 'stress'
  | 'modulus'
  | 'force'
  | 'energy'
  | 'power'
  | 'energyPerMass'
  | 'specificEntropy'
  | 'specificVolume'
  | 'density'
  | 'velocity'
  | 'acceleration'
  | 'massFlow'
  | 'volumeFlow'
  | 'torque'
  | 'angle'
  | 'frequency'
  | 'angularVelocity'
  | 'dynamicViscosity'
  | 'kinematicViscosity'
  | 'conductivity'
  | 'heatTransferCoefficient'
  | 'heatFlux'
  | 'areaMoment'
  | 'voltage'
  | 'current'
  | 'resistance'
  | 'capacitance'
  | 'inductance';

/**
 * Each kind's SI base unit, then its SI and US lists. An entry is a core/units symbol, or [label, symbol] where the
 * label differs from what core/units reads (core/units reads °F, not °R, inside a compound unit).
 */
type Entry = string | readonly [string, string];
const KINDS: Readonly<Record<QuantityKind, readonly [string, readonly Entry[], readonly Entry[]]>> = {
  dimensionless: ['', [''], ['']],
  length: ['m', ['m', 'mm', 'cm', 'km', 'µm'], ['ft', 'in', 'yd', 'mi']],
  area: ['m^2', ['m^2', 'mm^2', 'cm^2'], ['ft^2', 'in^2']],
  volume: ['m^3', ['m^3', 'L', 'mL', 'cm^3'], ['ft^3', 'in^3', 'gal']],
  mass: ['kg', ['kg', 'g', 't'], ['lbm', 'slug', 'oz']],
  amount: ['mol', ['mol', 'kmol'], [['lbmol', 'mol*453.59237']]],
  time: ['s', ['s', 'ms', 'min', 'h'], ['s', 'min', 'h']],
  temperature: ['K', ['K', '°C'], ['°R', '°F']],
  temperatureDifference: [
    'K',
    ['K', ['°C (difference)', 'K']],
    [
      ['°R', 'K*5/9'],
      ['°F (difference)', 'K*5/9'],
    ],
  ],
  pressure: ['Pa', ['kPa', 'Pa', 'MPa', 'bar', 'atm'], ['psi', 'psf', 'atm', ['inHg', 'Pa*3386.389']]],
  stress: ['Pa', ['MPa', 'kPa', 'GPa', 'Pa'], ['ksi', 'psi']],
  modulus: ['Pa', ['GPa', 'MPa'], ['ksi', ['Msi', 'ksi*1000']]],
  force: ['N', ['N', 'kN', 'MN'], ['lbf', 'kip']],
  energy: ['J', ['J', 'kJ', 'MJ', 'kWh'], ['Btu', ['ft·lbf', 'ft*lbf'], ['in·lbf', 'in*lbf']]],
  power: ['W', ['W', 'kW', 'MW'], ['hp', ['Btu/h', 'Btu/h'], ['ft·lbf/s', 'ft*lbf/s']]],
  energyPerMass: ['J/kg', ['kJ/kg', 'J/kg', 'MJ/kg'], ['Btu/lbm']],
  specificEntropy: ['J/(kg*K)', ['kJ/(kg·K)', 'J/(kg·K)'], [['Btu/(lbm·°R)', 'Btu/(lbm*°F)']]],
  specificVolume: ['m^3/kg', ['m^3/kg', 'L/kg'], ['ft^3/lbm']],
  density: ['kg/m^3', ['kg/m^3', 'g/cm^3'], ['lbm/ft^3', 'slug/ft^3', 'lbm/in^3']],
  velocity: ['m/s', ['m/s', 'km/h'], ['ft/s', ['mi/h', 'mi/h'], ['kn', 'm/s*0.5144444444444444']]],
  acceleration: ['m/s^2', ['m/s^2'], ['ft/s^2']],
  massFlow: ['kg/s', ['kg/s', 'kg/min', 'kg/h'], ['lbm/s', 'lbm/min', 'lbm/h']],
  volumeFlow: [
    'm^3/s',
    ['m^3/s', 'L/s', 'L/min', 'm^3/h'],
    [
      ['ft³/s', 'ft^3/s'],
      ['ft³/min', 'ft^3/min'],
      ['gal/min', 'gal/min'],
    ],
  ],
  torque: ['N*m', ['N·m', 'kN·m'], ['lbf·ft', 'lbf·in', 'kip·ft']],
  angle: ['rad', ['rad', 'deg'], ['deg', 'rad']],
  frequency: ['Hz', ['Hz', 'kHz', 'MHz'], ['Hz', 'kHz']],
  angularVelocity: [
    '1/s',
    [
      ['rad/s', 'rad/s'],
      ['rpm', 'rad/s*0.10471975511965977'],
    ],
    [
      ['rad/s', 'rad/s'],
      ['rpm', 'rad/s*0.10471975511965977'],
    ],
  ],
  dynamicViscosity: ['Pa*s', ['Pa·s', 'mPa·s', ['cP', 'mPa*s']], ['lbf·s/ft^2', 'lbm/(ft·s)']],
  kinematicViscosity: ['m^2/s', ['m^2/s', 'mm^2/s', ['cSt', 'mm^2/s']], ['ft^2/s']],
  conductivity: ['W/(m*K)', ['W/(m·K)'], [['Btu/(h·ft·°F)', 'Btu/(h*ft*°F)']]],
  heatTransferCoefficient: ['W/(m^2*K)', ['W/(m²·K)'], [['Btu/(h·ft²·°F)', 'Btu/(h*ft^2*°F)']]],
  heatFlux: ['W/m^2', ['W/m²', 'kW/m²'], [['Btu/(h·ft²)', 'Btu/(h*ft^2)']]],
  areaMoment: ['m^4', ['m^4', 'mm^4', 'cm^4'], ['in^4', 'ft^4']],
  voltage: ['V', ['V', 'mV', 'kV'], ['V', 'mV', 'kV']],
  current: ['A', ['A', 'mA', 'kA'], ['A', 'mA', 'kA']],
  resistance: ['ohm', ['Ω', 'kΩ', 'MΩ'], ['Ω', 'kΩ', 'MΩ']],
  capacitance: ['F', ['µF', 'nF', 'pF', 'F'], ['µF', 'nF', 'pF', 'F']],
  inductance: ['H', ['mH', 'H', 'µH'], ['mH', 'H', 'µH']],
};

/** A unit's factor and offset to SI. Accepts a product with one number factor, such as "K*5/9". */
function choiceOf(label: string, symbol: string): UnitChoice {
  if (symbol === '') return { label, factor: 1, offset: 0 };
  const match = /^(.*?)\*(\d+(?:\.\d+)?)(?:\/(\d+))?$/.exec(symbol);
  const unitText = match ? match[1] : symbol;
  const scale = match ? Number(match[2]) / (match[3] ? Number(match[3]) : 1) : 1;
  const unit = parseUnit(unitText.replace(/·/g, '*').replace(/²/g, '^2').replace(/³/g, '^3'));
  if (!unit) throw new Error(`Unknown unit ${symbol}`);
  return { label, factor: unit.factor * scale, offset: unit.offset ?? 0 };
}

/** A label as it reads on screen: m^2 as m², N*m as N·m. */
const pretty = (label: string): string =>
  label.replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\^4/g, '⁴').replace(/\*/g, '·');

const cache = new Map<string, readonly UnitChoice[]>();

/** The units a picker offers for a kind in a system, SI base unit first among the SI ones. */
export function unitChoices(kind: QuantityKind, system: UnitSystem): readonly UnitChoice[] {
  const key = `${kind}.${system}`;
  const known = cache.get(key);
  if (known) return known;
  const entries = KINDS[kind][system === 'SI' ? 1 : 2];
  const list = entries.map((entry) =>
    typeof entry === 'string' ? choiceOf(pretty(entry), entry) : choiceOf(pretty(entry[0]), entry[1]),
  );
  cache.set(key, list);
  return list;
}

/** Every unit of a kind in either system, for reading a unit typed or saved in the other system. */
export function findUnit(kind: QuantityKind, label: string): UnitChoice | null {
  return [...unitChoices(kind, 'SI'), ...unitChoices(kind, 'US')].find((u) => u.label === label) ?? null;
}

/** The value in SI base units. */
export const toSI = (value: number, unit: UnitChoice): number => value * unit.factor + unit.offset;

/** The value in `unit`, from SI base units. */
export const fromSI = (si: number, unit: UnitChoice): number => (si - unit.offset) / unit.factor;

/** Converts between two labels of one kind; throws when either is not a unit of the kind. */
export function convertKind(value: number, kind: QuantityKind, from: string, to: string): number {
  const a = findUnit(kind, from);
  const b = findUnit(kind, to);
  if (!a || !b) throw new NumError('domain', `not a unit of ${kind}`);
  return fromSI(toSI(value, a), b);
}

/** The SI base unit's label, such as "J/(kg*K)". */
export const siUnitOf = (kind: QuantityKind): string => KINDS[kind][0];

/** Plain digits from 0.001 to a million, powers of ten outside: 101300, 0.001235, 1.235e-5. */
function numberText(value: number, digits: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e-3 && abs < 1e6) return String(Number(value.toPrecision(digits)));
  return formatNumber(value, { notation: 'scientific', digits });
}

/** A number with `digits` significant digits, such as "1.235×10⁻⁵" or "101.3". */
export function formatValue(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '−∞';
  return superscriptPower(numberText(value, digits)).replace(/^-/, '−');
}

/** The same number in LaTeX: 1.235 \times 10^{-5}. */
export function latexValue(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '\\text{—}' : value > 0 ? '\\infty' : '-\\infty';
  const text = numberText(value, digits);
  const match = /^(-?[\d.]+)e([-+]?\d+)$/.exec(text);
  return match ? `${match[1]} \\times 10^{${Number(match[2])}}` : text;
}

/** A value and its unit label, such as "101.3 kPa". */
export const formatQuantity = (value: number, unit: UnitChoice, digits = 4): string =>
  unit.label === '' ? formatValue(value, digits) : `${formatValue(value, digits)} ${unit.label}`;

/** A unit label in LaTeX upright text. */
export const latexUnit = (label: string): string =>
  label === '' ? '' : `\\,\\mathrm{${label.replace(/([%#&_{}])/g, '\\$1')}}`;
