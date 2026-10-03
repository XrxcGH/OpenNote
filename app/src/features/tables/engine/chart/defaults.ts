// Two-click defaults: which chart to recommend for a table, and which columns it uses. The first click picks
// Chart, and the second picks a kind from a menu with the recommended one first. Kinds that can't work are disabled
// with a reason. Alt+F1 inserts the recommended chart in one step.

import type { Table } from '../model';
import { xKindOf, type ChartKind, type XKind } from './data';
import { MAX_SERIES } from './palette';
import type { ChartConfig } from './spec';

const NUMERIC = new Set(['number', 'currency', 'percent']);
const KINDS: readonly ChartKind[] = ['bar', 'line', 'area', 'pie', 'scatter'];
const PIE_SLICES = { min: 2, max: 7 };

export type Unavailable = 'needs-number-column' | 'needs-number-x';

export interface ChartChoice {
  kind: ChartKind;
  recommended: boolean;
  /** Why the kind can't be made from this table, or null when it can. */
  unavailable: Unavailable | null;
}

export interface ChartDefaults {
  x: number;
  series: number[];
  /** Rows with the same x add up when any x repeats. */
  aggregate: 'sum' | 'none';
  kind: ChartKind;
  /** Every kind, the recommended one first. */
  choices: ChartChoice[];
}

/** The x column: the first date column, else the first text column, else the first number column. */
function pickX(table: Table): number {
  const kinds = table.columns.map(xKindOf);
  for (const kind of ['date', 'text', 'number'] as XKind[]) {
    const at = kinds.indexOf(kind);
    if (at !== -1) return at;
  }
  return 0;
}

function distinctValues(table: Table, col: number): number {
  return new Set(table.rows.map((r) => String(r.cells[col].value ?? ''))).size;
}

function recommend(table: Table, x: number, series: number[]): ChartKind {
  const xKind = xKindOf(table.columns[x]);
  if (series.length > 0 && table.columns.every((c) => NUMERIC.has(c.type))) return 'scatter';
  if (xKind === 'date') return 'line';
  const slices = distinctValues(table, x);
  const pie = xKind === 'text' && series.length === 1 && slices >= PIE_SLICES.min && slices <= PIE_SLICES.max;
  return pie ? 'pie' : 'bar';
}

function unavailable(kind: ChartKind, xKind: XKind, hasSeries: boolean): Unavailable | null {
  if (!hasSeries) return 'needs-number-column';
  return kind === 'scatter' && xKind === 'text' ? 'needs-number-x' : null;
}

/** Works out the recommended chart and its columns. Returns null for a table with no columns. */
export function chartDefaults(table: Table): ChartDefaults | null {
  if (table.columns.length === 0) return null;
  const x = pickX(table);
  const series = table.columns.flatMap((c, i) => (i !== x && NUMERIC.has(c.type) ? [i] : [])).slice(0, MAX_SERIES);
  const kind = recommend(table, x, series);
  const xKind = xKindOf(table.columns[x]);
  const choices = [kind, ...KINDS.filter((k) => k !== kind)].map((k): ChartChoice => ({
    kind: k,
    recommended: k === kind,
    unavailable: unavailable(k, xKind, series.length > 0),
  }));
  const seen = new Set<string>();
  const repeats = table.rows.some((r) => {
    const key = String(r.cells[x].value ?? '');
    return seen.size === seen.add(key).size;
  });
  return { x, series, aggregate: repeats ? 'sum' : 'none', kind, choices };
}

/** The config for a chart of the given kind, or the recommended one. Null when the table can't make it. */
export function chartConfigFor(table: Table, kind?: ChartKind): ChartConfig | null {
  const defaults = chartDefaults(table);
  const choice = defaults?.choices.find((c) => c.kind === (kind ?? defaults.kind));
  if (!defaults || !choice || choice.unavailable) return null;
  const series = choice.kind === 'pie' ? defaults.series.slice(0, 1) : defaults.series;
  return { kind: choice.kind, x: defaults.x, series, aggregate: defaults.aggregate };
}
