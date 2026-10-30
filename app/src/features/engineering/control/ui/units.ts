// The kinds of quantity the control tools read and show, each with the unit it uses in SI and in US customary
// units. The engines work in SI; these units are only for people. A field takes a plain number in the shown unit, or
// a number with any unit of the same kind ("3 slug", "250 mH"), which is converted.
import { convertUnit, parseUnit, sameDim, splitQuantity } from '../../../../core/units';
import { fmt } from '../lib/tf';
import { FieldProblem } from './spec';

export type System = 'si' | 'us';

const KINDS = {
  time: { si: 's', us: 's' },
  rate: { si: 'rad/s', us: 'rad/s' },
  hertz: { si: 'Hz', us: 'Hz' },
  mass: { si: 'kg', us: 'slug' },
  damping: { si: 'N*s/m', us: 'lbf*s/ft' },
  stiffness: { si: 'N/m', us: 'lbf/ft' },
  resistance: { si: 'ohm', us: 'ohm' },
  inductance: { si: 'H', us: 'H' },
  capacitance: { si: 'F', us: 'F' },
  inertia: { si: 'kg*m^2', us: 'slug*ft^2' },
  rotaryDamping: { si: 'N*m*s', us: 'lbf*ft*s' },
  torqueConstant: { si: 'N*m/A', us: 'lbf*ft/A' },
  area: { si: 'm^2', us: 'ft^2' },
  flowResistance: { si: 's/m^2', us: 's/ft^2' },
  thermalResistance: { si: 'K/W', us: 'degF*h/Btu' },
  thermalCapacitance: { si: 'J/K', us: 'Btu/degF' },
} as const;

export type UnitKind = keyof typeof KINDS;

export const isUnitKind = (text: string): text is UnitKind => text in KINDS;

/** True when the kind is shown in different units in SI and US customary. */
export const differsBySystem = (kind: UnitKind): boolean => KINDS[kind].si !== KINDS[kind].us;

/** The unit a kind is typed in, in core/units syntax. */
export const typedUnit = (kind: UnitKind, system: System): string => KINDS[kind][system];

/** The SI unit of a kind, in core/units syntax. */
export const siUnit = (kind: UnitKind): string => KINDS[kind].si;

/** A unit as people read it: "N·s/m", "kg·m²", "Ω", "°F·h/Btu". */
export const unitLabel = (unit: string): string =>
  unit
    .replace(/\*/g, '·')
    .replace(/\^2/g, '²')
    .replace(/\bohm\b/g, 'Ω')
    .replace(/degF/g, '°F');

export const unitOf = (kind: UnitKind, system: System): string => unitLabel(typedUnit(kind, system));

/** A value in SI shown in the system's unit. */
export function toShown(si: number, kind: UnitKind, system: System): number {
  return convertUnit(si, siUnit(kind), typedUnit(kind, system)) ?? si;
}

/** A value in SI as text in the system's unit: "2.5 slug". */
export function quantityText(si: number, kind: UnitKind, system: System, digits = 6): string {
  const unit = unitOf(kind, system);
  return `${fmt(toShown(si, kind, system), digits)}${unit ? ` ${unit}` : ''}`;
}

/** Reads a plain number. A typographic minus is fine; separators between thousands are not. */
export function readPlainNumber(text: string, field: string): number {
  const cleaned = text.trim().replace(/−/g, '-');
  if (cleaned === '') throw new FieldProblem(field, 'required');
  const v = Number(cleaned);
  if (!Number.isFinite(v)) throw new FieldProblem(field, 'number');
  return v;
}

/** Reads "2", "2 slug", or "250 mH" as a value in SI for a field of this kind. */
export function readQuantity(text: string, kind: UnitKind, system: System, field: string): number {
  const { number, unit } = splitQuantity(text.replace(/−/g, '-'));
  const value = readPlainNumber(number, field);
  const typed = unit.trim() || typedUnit(kind, system);
  const given = parseUnit(typed.replace(/·/g, '*').replace(/Ω/g, 'ohm').replace(/°F/g, 'degF'));
  const target = parseUnit(siUnit(kind));
  if (!given || !target || !sameDim(given, target)) {
    throw new FieldProblem(field, 'unit', { unit: unit.trim(), expected: unitOf(kind, 'si') });
  }
  return value * given.factor;
}
