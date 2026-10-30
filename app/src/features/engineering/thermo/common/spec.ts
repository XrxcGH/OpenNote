// What a tool tells the kit window: its modes, the fields of each mode, and how to solve. Pure data and functions,
// so the window renders every tool the same way and the forms can be tested without a DOM.
import type { kitThermo } from '../../../../strings/en/kitThermo';
import { ThermoError, type ThermoResult } from './types';
import type { Qty, System } from './units';

export type ThermoFieldKey = keyof (typeof kitThermo)['field'];
export type ThermoChoiceKey = keyof (typeof kitThermo)['choice'];
export type ThermoModeKey = keyof (typeof kitThermo)['mode'];

/** Field values in the engine's units: a number, the text of a list or choice, or null when left empty. */
export type Values = Readonly<Record<string, number | string | null>>;

export interface FieldSpec {
  id: string;
  label: ThermoFieldKey;
  /** qty: a number with a unit (the default); choice: one of options; list: numbers separated by commas. */
  kind?: 'qty' | 'choice' | 'list';
  qty?: Qty;
  /** The first value, in the engine's unit for a quantity. */
  initial: number | string | null;
  options?: readonly { value: string; label: ThermoChoiceKey }[];
  /** A field the engine can do without; left empty, it is null. */
  optional?: boolean;
  /** The unit a field starts in, when not the system's first, such as °C for steam. */
  unit?: Partial<Record<System, string>>;
}

export interface ModeSpec {
  id: string;
  label: ThermoModeKey;
  fields: (values: Values) => readonly FieldSpec[];
}

export interface ToolSpec {
  modes: readonly ModeSpec[];
  solve(mode: string, values: Values): ThermoResult;
}

/** A number field's value; throws a missing-value error when it is empty. */
export function num(values: Values, id: string): number {
  const value = values[id];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ThermoError('missing', { name: id });
  return value;
}

/** A number field's value, or null when it was left empty. */
export function optionalNum(values: Values, id: string): number | null {
  const value = values[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A choice field's value. */
export function choice<T extends string>(values: Values, id: string, fallback: T): T {
  const value = values[id];
  return (typeof value === 'string' && value !== '' ? value : fallback) as T;
}

/** The numbers of a list field, such as "1388, 667.4, 2349". */
export function list(values: Values, id: string): number[] {
  const value = values[id];
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number);
}

/** Shorthand for a quantity field. */
export const q = (
  id: string,
  label: ThermoFieldKey,
  qty: Qty,
  initial: number | null,
  optional = false,
): FieldSpec => ({
  id,
  label,
  qty,
  initial,
  optional,
});

/** Shorthand for a choice field. */
export const pick = (
  id: string,
  label: ThermoFieldKey,
  options: readonly (readonly [string, ThermoChoiceKey])[],
  initial?: string,
): FieldSpec => ({
  id,
  label,
  kind: 'choice',
  initial: initial ?? options[0][0],
  options: options.map(([value, key]) => ({ value, label: key })),
});
