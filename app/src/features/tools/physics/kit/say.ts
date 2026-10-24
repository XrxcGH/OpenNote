// Turns the engines' message keys into text. Steps, labels, and problems name a key and its values; values in
// `labels` are keys too (a field's name), said first. Results are written in the unit system the window shows.
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { fmt } from './format';
import type { KitStep, ResultRow, UnitSystem } from './types';
import { defaultUnit, fromSI } from './units';

const translate = t as unknown as (key: string, values?: Record<string, unknown>) => string;

/** A message key with values that come from data, not from code that names the key. */
export function sayKey(key: MessageKey, values?: Record<string, string>): string {
  return translate(key, values);
}

export function say(step: KitStep): string {
  const labels = Object.fromEntries(Object.entries(step.labels ?? {}).map(([name, key]) => [name, translate(key)]));
  return translate(step.key, { ...step.vars, ...labels });
}

export interface ShownRow {
  name: string;
  symbol: string;
  value: string;
  unit: string;
}

/** A result as the window shows it: in the unit system's unit, to 5 significant figures. */
export function showRow(row: ResultRow, system: UnitSystem): ShownRow {
  const name = translate(row.key);
  const symbol = row.symbol ?? '';
  if (typeof row.value === 'string') return { name, symbol, value: row.value, unit: row.unit ?? '' };
  if (!row.dim) return { name, symbol, value: fmt(row.value, row.digits), unit: row.unit ?? '' };
  const unit = defaultUnit(row.dim, system, row.unit, row.usUnit);
  return { name, symbol, value: fmt(fromSI(row.value, row.dim, unit), row.digits), unit };
}

/** A result as one line of text: "Wave speed v = 374.17 m/s". */
export function rowText(row: ShownRow): string {
  const value = row.unit ? `${row.value} ${row.unit}` : row.value;
  return row.symbol ? `${row.name} ${row.symbol} = ${value}` : `${row.name}: ${value}`;
}
