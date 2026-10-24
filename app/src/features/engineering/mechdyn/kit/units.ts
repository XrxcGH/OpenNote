// The kinds of quantity the mechanisms and dynamics tools read and show, each with the unit it shows in SI and in
// US customary units. The engines work in base SI (m, kg, s, N, rad); these units are only for people. A typed unit
// that measures something else is refused with a message naming both units.
import { evaluate } from '../../../../core/expr';
import { parseUnit, sameDim, type Dim } from '../../../../core/units';
import { MechError } from './errors';

export type System = 'si' | 'us';

interface Shown {
  /** The unit as people read it. */
  readonly label: string;
  /** SI base units in one of this unit. */
  readonly factor: number;
  /** How the unit is typed, when its label can't be read back. */
  readonly typed?: string;
}

interface KindDef {
  readonly dim: Dim;
  readonly si: Shown;
  readonly us: Shown;
}

const D = (m = 0, kg = 0, s = 0): Dim => [m, kg, s, 0, 0, 0, 0];
const FT = 0.3048;
const IN = 0.0254;
const LB = 0.45359237;
const LBF = 4.4482216152605;
const KSI = (1000 * LBF) / IN ** 2;
const shown = (label: string, factor: number, typed?: string): Shown => ({
  label,
  factor,
  ...(typed ? { typed } : {}),
});

export const KINDS = {
  length: { dim: D(1), si: shown('m', 1), us: shown('ft', FT) },
  small: { dim: D(1), si: shown('mm', 1e-3), us: shown('in', IN) },
  area: { dim: D(2), si: shown('mm²', 1e-6, 'mm^2'), us: shown('in²', IN ** 2, 'in^2') },
  areaInertia: { dim: D(4), si: shown('mm⁴', 1e-12, 'mm^4'), us: shown('in⁴', IN ** 4, 'in^4') },
  mass: { dim: D(0, 1), si: shown('kg', 1), us: shown('lb', LB) },
  massPerLength: { dim: D(-1, 1), si: shown('kg/m', 1), us: shown('lb/ft', LB / FT) },
  density: { dim: D(-3, 1), si: shown('kg/m³', 1, 'kg/m^3'), us: shown('lb/ft³', LB / FT ** 3, 'lb/ft^3') },
  massInertia: { dim: D(2, 1), si: shown('kg·m²', 1, 'kg*m^2'), us: shown('lb·ft²', LB * FT ** 2, 'lb*ft^2') },
  unbalance: { dim: D(1, 1), si: shown('kg·m', 1, 'kg*m'), us: shown('lb·in', LB * IN, 'lb*in') },
  force: { dim: D(1, 1, -2), si: shown('N', 1), us: shown('lbf', LBF) },
  moment: { dim: D(2, 1, -2), si: shown('N·m', 1, 'N*m'), us: shown('lbf·ft', LBF * FT, 'lbf*ft') },
  smallMoment: { dim: D(2, 1, -2), si: shown('N·mm', 1e-3, 'N*mm'), us: shown('lbf·in', LBF * IN, 'lbf*in') },
  energy: { dim: D(2, 1, -2), si: shown('J', 1), us: shown('ft·lbf', LBF * FT, 'ft*lbf') },
  power: { dim: D(2, 1, -3), si: shown('kW', 1e3), us: shown('hp', 745.69987158227) },
  impulse: { dim: D(1, 1, -1), si: shown('N·s', 1, 'N*s'), us: shown('lbf·s', LBF, 'lbf*s') },
  stiffness: { dim: D(0, 1, -2), si: shown('N/m', 1), us: shown('lbf/in', LBF / IN) },
  damping: { dim: D(0, 1, -1), si: shown('N·s/m', 1, 'N*s/m'), us: shown('lbf·s/in', LBF / IN, 'lbf*s/in') },
  modulus: { dim: D(-1, 1, -2), si: shown('GPa', 1e9), us: shown('ksi', KSI) },
  stress: { dim: D(-1, 1, -2), si: shown('MPa', 1e6), us: shown('ksi', KSI) },
  flexuralRigidity: {
    dim: D(3, 1, -2),
    si: shown('N·m²', 1, 'N*m^2'),
    us: shown('lbf·in²', LBF * IN ** 2, 'lbf*in^2'),
  },
  torsionStiffness: {
    dim: D(2, 1, -2),
    si: shown('N·m/rad', 1, 'N*m/rad'),
    us: shown('lbf·in/rad', LBF * IN, 'lbf*in/rad'),
  },
  velocity: { dim: D(1, 0, -1), si: shown('m/s', 1), us: shown('ft/s', FT) },
  acceleration: { dim: D(1, 0, -2), si: shown('m/s²', 1, 'm/s^2'), us: shown('ft/s²', FT, 'ft/s^2') },
  jerk: { dim: D(1, 0, -3), si: shown('m/s³', 1, 'm/s^3'), us: shown('ft/s³', FT, 'ft/s^3') },
  time: { dim: D(0, 0, 1), si: shown('s', 1), us: shown('s', 1) },
  frequency: { dim: D(0, 0, -1), si: shown('Hz', 1), us: shown('Hz', 1) },
  angularSpeed: { dim: D(0, 0, -1), si: shown('rad/s', 1), us: shown('rad/s', 1) },
  rpm: { dim: D(0, 0, -1), si: shown('rpm', (2 * Math.PI) / 60), us: shown('rpm', (2 * Math.PI) / 60) },
  angularAcc: { dim: D(0, 0, -2), si: shown('rad/s²', 1, 'rad/s^2'), us: shown('rad/s²', 1, 'rad/s^2') },
  angle: { dim: D(), si: shown('°', Math.PI / 180, 'deg'), us: shown('°', Math.PI / 180, 'deg') },
  ratio: { dim: D(), si: shown('', 1), us: shown('', 1) },
  count: { dim: D(), si: shown('', 1), us: shown('', 1) },
  percent: { dim: D(), si: shown('%', 0.01), us: shown('%', 0.01) },
} as const satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;

/** Kinds measured per second, where a typed Hz or rpm means turns, not radians. */
const ROTATION_RATES = new Set<Kind>(['angularSpeed', 'rpm']);

/** The unit a kind shows in. */
export const unitOf = (kind: Kind, system: System): string => KINDS[kind][system].label;

/** The unit as it is typed after a number, so a bare number keeps its meaning when the system changes. */
export const typedUnit = (kind: Kind, system: System): string => {
  const one: Shown = KINDS[kind][system];
  return one.typed ?? one.label;
};

/** A value in base SI, in the units a kind shows in. */
export const toShown = (value: number, kind: Kind, system: System): number => value / KINDS[kind][system].factor;

/** A value in the units a kind shows in, in base SI. */
export const fromShown = (value: number, kind: Kind, system: System): number => value * KINDS[kind][system].factor;

/** What a person typed, as a number and the unit after it ('' when none). */
function splitTyped(text: string): { number: number; unit: string } | null {
  const whole = evaluate(text);
  if (whole.ok) return { number: whole.value, unit: '' };
  for (let i = 1; i < text.length; i += 1) {
    if (!/[A-Za-zµμ°%]/.test(text[i]) || !/[\s\d).]/.test(text[i - 1])) continue;
    const unit = text.slice(i).trim();
    if (!parseUnit(unit) && unit !== '%') continue;
    const number = evaluate(text.slice(0, i).trim());
    if (number.ok) return { number: number.value, unit };
  }
  return null;
}

/**
 * Reads a typed quantity, such as "25", "25 mm", "1500 rpm", or "2*pi rad/s", into base SI. A bare number is in the
 * unit the kind shows in for the chosen system. Hz and rpm typed for an angular speed count turns (2π rad each).
 */
export function readQuantity(text: string, kind: Kind, system: System): number {
  const trimmed = text.trim();
  if (trimmed === '') throw new MechError('fieldEmpty');
  const typed = splitTyped(trimmed);
  if (!typed || !Number.isFinite(typed.number)) throw new MechError('fieldUnreadable', { text: trimmed });
  if (typed.unit === '') return fromShown(typed.number, kind, system);
  if (typed.unit === '%') {
    if (kind !== 'percent' && kind !== 'ratio') throw mismatch(typed.unit, kind, system);
    return typed.number * 0.01;
  }
  const unit = parseUnit(typed.unit);
  if (!unit) throw new MechError('fieldUnreadable', { text: trimmed });
  const def: KindDef = KINDS[kind];
  if (!sameDim(unit, { factor: 1, dim: def.dim })) throw mismatch(typed.unit, kind, system);
  const turns = /^(Hz|rpm|kHz)$/.test(typed.unit);
  if (ROTATION_RATES.has(kind) && turns) return typed.number * unit.factor * 2 * Math.PI;
  if (kind === 'frequency' && /rad/.test(typed.unit)) return (typed.number * unit.factor) / (2 * Math.PI);
  return typed.number * unit.factor;
}

const mismatch = (unit: string, kind: Kind, system: System) =>
  new MechError('fieldUnit', { unit, wanted: unitOf(kind, system) || '1' });
