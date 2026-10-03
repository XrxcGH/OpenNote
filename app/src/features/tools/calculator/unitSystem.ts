// The calculator's units as a UnitSystem for the shared expression engine (core/expr), so that `5 mi in km` and
// `5 km + 300 m` work in the calculator and in note lines. The names, plurals, and factors are the ones the unit
// converter already uses (unitData.ts). This file adds what the engine needs on top: each category's dimension, and
// the offsets of the temperature scales.

import type { Dimension, UnitDef, UnitSystem } from '../../../core/expr';
import type { UnitCategory } from './unitData';
import { findUnit, findUnitAsWritten, type UnitDef as ConverterUnit } from './units';

/**
 * The unit for a name in an expression. A one-letter name must be written in the unit's own case, so K is kelvin but
 * k is free for a variable, and f is not Fahrenheit. Longer names match in any case, as in the converter.
 */
function unitNamed(name: string): ConverterUnit | null {
  return name.length === 1 ? findUnitAsWritten(name) : findUnit(name);
}

/** The dimension of each category, and how many SI base units its base unit is (a liter is 0.001 cubic meters). */
const CATEGORIES: Readonly<Record<UnitCategory, { dim: Dimension; si: number }>> = {
  length: { dim: [1, 0, 0, 0, 0], si: 1 },
  mass: { dim: [0, 1, 0, 0, 0], si: 1 },
  time: { dim: [0, 0, 1, 0, 0], si: 1 },
  temperature: { dim: [0, 0, 0, 1, 0], si: 1 },
  area: { dim: [2, 0, 0, 0, 0], si: 1 },
  volume: { dim: [3, 0, 0, 0, 0], si: 0.001 },
  speed: { dim: [1, 0, -1, 0, 0], si: 1 },
  pressure: { dim: [-1, 1, -2, 0, 0], si: 1 },
  energy: { dim: [2, 1, -2, 0, 0], si: 1 },
  data: { dim: [0, 0, 0, 0, 1], si: 1 },
};

/** Kelvin from each scale is `value * factor + offset`. */
const TEMPERATURE: Readonly<Record<string, { factor: number; offset: number }>> = {
  K: { factor: 1, offset: 0 },
  C: { factor: 1, offset: 273.15 },
  F: { factor: 5 / 9, offset: (459.67 * 5) / 9 },
  R: { factor: 5 / 9, offset: 0 },
};

export const calculatorUnits: UnitSystem = {
  find(name: string): UnitDef | undefined {
    const unit = unitNamed(name);
    if (unit === null) return undefined;
    const { dim, si } = CATEGORIES[unit.category];
    if (unit.category === 'temperature') return { id: unit.id, dim, ...TEMPERATURE[unit.id] };
    return { id: unit.id, dim, factor: unit.factor * si };
  },
};

/** True when the text names a unit the calculator knows. */
export function isUnitName(name: string): boolean {
  return unitNamed(name) !== null;
}
