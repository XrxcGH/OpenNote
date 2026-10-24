// Small builders for calculation definitions, so each tool's list of calculations reads as a list of fields.
import type { KitStep, NumberField, Row, SelectField, TableField, Vars } from './types';
import type { Quantity } from './units';

export const num = (
  id: string,
  label: string,
  initial: string,
  quantity?: Quantity,
  more: Partial<Pick<NumberField, 'optional' | 'help' | 'unit'>> = {},
): NumberField => ({ id, label, initial, ...(quantity ? { quantity } : {}), ...more });

export const opt = (id: string, label: string, initial: string, quantity?: Quantity): NumberField =>
  num(id, label, initial, quantity, { optional: true });

export const pick = (
  id: string,
  label: string,
  options: readonly (readonly [string, string])[],
  initial?: string,
): SelectField => ({
  id,
  label,
  kind: 'select',
  options: options.map(([value, key]) => ({ value, label: key })),
  initial: initial ?? options[0]![0],
});

export const grid = (
  id: string,
  label: string,
  columns: readonly (readonly [string, Quantity?])[],
  initial: string,
  minRows = 1,
): TableField => ({
  id,
  label,
  kind: 'table',
  columns: columns.map(([key, quantity]) => ({ label: key, ...(quantity ? { quantity } : {}) })),
  initial,
  minRows,
});

export const row = (label: string, value: number | string, unit?: string): Row => ({
  label,
  value,
  ...(unit ? { unit } : {}),
});

export const step = (key: string, vars?: Vars, math?: string): KitStep => ({
  key,
  ...(vars ? { vars } : {}),
  ...(math ? { math } : {}),
});
