// Quantities: a number with a unit, such as 5 km or 9.8 m/s^2. A quantity keeps its value in SI base units and its
// dimension, so 5 km + 300 m is allowed, 5 km + 3 s is not, and 5 km / 2 h has the dimension of a speed. It also
// remembers the unit to show it in, so the answer to 5 km + 300 m is 5.3 km and not 5300 m.
//
// A UnitSystem is the host's table of units. The engine does not carry one: the calculator has its own (length, mass,
// time, temperature, area, volume, speed, pressure, energy, and data), and a note page may add more.

import type { UnitExpr, UnitFactor } from './ast';
import { ExprError } from './errors';
import { formatNumber, type FormatOptions } from './numfmt';
import { snap } from './numeric';
import { formatUnit } from './unitsyntax';

/** Exponents of length, mass, time, temperature, and data. Speed is [1, 0, -1, 0, 0]. */
export type Dimension = readonly [length: number, mass: number, time: number, temperature: number, data: number];

export const NO_DIMENSION: Dimension = [0, 0, 0, 0, 0];

/** The names of the base units, in the order of a Dimension. */
export const BASE_UNIT_NAMES: readonly string[] = ['m', 'kg', 's', 'K', 'byte'];

export interface UnitDef {
  /** The unit's symbol, such as "km". */
  id: string;
  dim: Dimension;
  /** The value in SI base units is `value * factor + offset`. */
  factor: number;
  /** Only temperature scales that do not start at zero have an offset: Celsius and Fahrenheit. */
  offset?: number;
}

export interface UnitSystem {
  /** The unit for a symbol or name, or undefined. */
  find(name: string): UnitDef | undefined;
}

/** One unit in the way a quantity is shown, with its factor into SI base units. */
export interface DisplayPart {
  name: string;
  power: number;
  factor: number;
}

/** The unit a quantity is shown in. `factor` and `offset` turn the shown number into SI base units. */
export interface Display {
  parts: readonly DisplayPart[];
  factor: number;
  offset: number;
  label: string;
}

export interface Quantity {
  /** The value in SI base units. */
  si: number;
  dim: Dimension;
  /** The unit to show it in, or null to show a plain number or the base units of its dimension. */
  display: Display | null;
}

export const addDims = (a: Dimension, b: Dimension, sign = 1): Dimension =>
  a.map((x, i) => x + sign * b[i]) as unknown as Dimension;

export const scaleDim = (a: Dimension, by: number): Dimension => a.map((x) => x * by) as unknown as Dimension;

export const sameDim = (a: Dimension, b: Dimension): boolean => a.every((x, i) => x === b[i]);

export const isPlain = (dim: Dimension): boolean => dim.every((x) => x === 0);

/** A display for these parts, with the label written the way a person would type it. */
export function displayOf(parts: readonly DisplayPart[], offset = 0): Display | null {
  const kept = parts.filter((p) => p.power !== 0);
  if (kept.length === 0) return null;
  const factor = kept.reduce((total, p) => total * Math.pow(p.factor, p.power), 1);
  const factors: UnitFactor[] = kept.map((p) => ({ name: p.name, power: p.power, pos: 0 }));
  return { parts: kept, factor, offset, label: formatUnit({ start: 0, end: 0, factors }) };
}

/** Combines two lists of parts, adding the powers of a unit that appears in both. */
export function mergeParts(a: readonly DisplayPart[], b: readonly DisplayPart[], sign: 1 | -1): DisplayPart[] {
  const merged = a.map((p) => ({ ...p }));
  for (const part of b) {
    const found = merged.find((m) => m.name === part.name);
    if (found) found.power += sign * part.power;
    else merged.push({ ...part, power: sign * part.power });
  }
  return merged;
}

/** The unit expression of a typed unit, found in the host's table. Throws 'unknown-unit' at the first name it lacks. */
export function resolveUnit(expr: UnitExpr, units: UnitSystem): { dim: Dimension; display: Display } {
  let dim = NO_DIMENSION;
  const parts: DisplayPart[] = [];
  let offset = 0;
  for (const factor of expr.factors) {
    const def = units.find(factor.name);
    if (def === undefined) throw new ExprError('unknown-unit', factor.pos, factor.name, { length: factor.name.length });
    dim = addDims(dim, scaleDim(def.dim, factor.power));
    parts.push({ name: factor.name, power: factor.power, factor: def.factor });
    // A reading such as 20 C only keeps its offset when it stands alone. In a ratio or a power it is a difference.
    if (expr.factors.length === 1 && factor.power === 1) offset = def.offset ?? 0;
  }
  const display = displayOf(parts, offset) as Display;
  return { dim, display };
}

/** A quantity from a number written in a unit: 5 km. */
export function fromAmount(value: number, dim: Dimension, display: Display | null): Quantity {
  if (display === null) return { si: value, dim, display };
  return { si: value * display.factor + display.offset, dim, display };
}

/** The number to show: the quantity in its own unit, rounded to 15 digits to remove the noise of the conversion. */
export function amount(q: Quantity): number {
  if (q.display === null) return q.si;
  const shown = (q.si - q.display.offset) / q.display.factor;
  // An offset leaves noise of about 1e-14, so a reading that small next to the offsets is zero.
  if (q.display.offset !== 0 && Math.abs(shown) < 1e-11 * (Math.abs(q.si) + 300)) return 0;
  return snap(shown);
}

/** The label to show after the number: the unit, or the base units of the dimension for a result like m^2/kg. */
export function unitLabel(q: Quantity): string {
  if (q.display !== null) return q.display.label;
  if (isPlain(q.dim)) return '';
  const factors: UnitFactor[] = q.dim.flatMap((power, i) =>
    power === 0 ? [] : [{ name: BASE_UNIT_NAMES[i], power, pos: 0 }],
  );
  return formatUnit({ start: 0, end: 0, factors });
}

/** The quantity as text: the number as shown, a space, and the unit. A plain number has no unit. */
export function formatQuantity(q: Quantity, options: FormatOptions = {}): string {
  const label = unitLabel(q);
  const number = formatNumber(amount(q), options);
  return label === '' ? number : `${number} ${label}`;
}
