// Switching a data set between wide form and long form, as repeated-measures and grouped analyses need. Wide form
// has one column per measurement; long form has one row per measurement and a column naming what was measured.
import { ensure } from '../errors';
import { columnNamed, labelsOf, levelsOf } from './model';
import type { DataColumn, DataSet } from './model';

/** Names the two new columns of long form; the tool passes them in the reader's language. */
export interface StackNames {
  key: string;
  value: string;
}

/**
 * Wide to long: the id columns repeat once per measure column, a key column names the measure, and a value column
 * holds it. Measure columns must be numbers.
 */
export function stack(data: DataSet, ids: readonly string[], measures: readonly string[], names: StackNames): DataSet {
  ensure(measures.length > 0, 'empty', 'measures');
  const idColumns = ids.map((n) => columnNamed(data, n));
  const measureColumns = measures.map((n) => columnNamed(data, n));
  ensure(idColumns.every((c) => c !== null) && measureColumns.every((c) => c !== null), 'shape', 'column');
  ensure(
    measureColumns.every((c) => c?.kind === 'number'),
    'domain',
    'measures',
  );
  const rows = data.rows * measures.length;
  const repeat = (c: DataColumn): DataColumn => {
    const values = Array.from({ length: rows }, (_, i) => c.values[i % data.rows]);
    return { ...c, values } as DataColumn;
  };
  const key: DataColumn = {
    name: names.key,
    kind: 'category',
    values: Array.from({ length: rows }, (_, i) => measures[Math.floor(i / data.rows)]),
  };
  const value: DataColumn = {
    name: names.value,
    kind: 'number',
    values: measureColumns.flatMap((c) => (c?.values ?? []) as (number | null)[]),
    unit: sharedUnit(measureColumns as DataColumn[]),
  };
  return { columns: [...(idColumns as DataColumn[]).map(repeat), key, value], rows, truncated: false, problems: [] };
}

function sharedUnit(columns: readonly DataColumn[]): string | null {
  const units = new Set(columns.map((c) => (c.kind === 'number' ? c.unit : null)));
  return units.size === 1 ? [...units][0] : null;
}

/**
 * Long to wide: one row per distinct combination of the id columns, and one number column per level of the key
 * column. A combination that appears twice for the same level is refused, since it has no single value.
 */
export function unstack(data: DataSet, ids: readonly string[], keyName: string, valueName: string): DataSet {
  const key = columnNamed(data, keyName);
  const value = columnNamed(data, valueName);
  const idColumns = ids.map((n) => columnNamed(data, n));
  ensure(key !== null && value !== null && idColumns.every((c) => c !== null), 'shape', 'column');
  ensure(value.kind === 'number', 'domain', valueName);
  const levels = levelsOf(key);
  const keyLabels = labelsOf(key);
  const idLabels = (idColumns as DataColumn[]).map(labelsOf);
  const rowOf = new Map<string, number>();
  const firstRow: number[] = [];
  const cells: (number | null)[][] = levels.map(() => []);
  for (let r = 0; r < data.rows; r += 1) {
    const level = keyLabels[r];
    if (level === null) continue;
    const id = JSON.stringify(idLabels.map((labels) => labels[r]));
    if (!rowOf.has(id)) {
      rowOf.set(id, firstRow.length);
      firstRow.push(r);
    }
    const out = rowOf.get(id) ?? 0;
    const li = levels.indexOf(level);
    ensure(cells[li][out] === undefined, 'domain', `${level}`);
    cells[li][out] = value.values[r] as number | null;
  }
  const n = firstRow.length;
  const idOut = (idColumns as DataColumn[]).map(
    (c) => ({ ...c, values: firstRow.map((r) => c.values[r]) }) as DataColumn,
  );
  const unit = value.kind === 'number' ? value.unit : null;
  const wide: DataColumn[] = levels.map((level, li) => ({
    name: level,
    kind: 'number',
    values: Array.from({ length: n }, (_, i) => cells[li][i] ?? null),
    unit,
  }));
  return { columns: [...idOut, ...wide], rows: n, truncated: false, problems: [] };
}
