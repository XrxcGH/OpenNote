// Filters. A condition's values are canonical cell text, so a filter means the same on every device. A condition with
// an unknown operation or column is ignored, which shows more rows, never fewer.

import { parseCanonical, toCanonical } from './canonical';
import { compareValues } from './formula/operators';
import type { Column, Table } from './model';
import { isError, type Value } from './values';
import { sortedIndices, type SortKey } from './sort';
import type { Locale } from './locale';

export type FilterOp =
  | 'in'
  | 'contains'
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'between'
  | 'empty'
  | 'notEmpty'
  | 'checked'
  | 'unchecked';

export interface FilterCondition {
  column: number;
  op: FilterOp;
  value?: string;
  values?: string[];
  to?: string;
}

const isBlank = (v: Value): boolean => v === null || v === '';

type Test = (v: Value) => boolean;

function ordered(op: 'lt' | 'le' | 'gt' | 'ge', target: Value): Test {
  return (v) => {
    if (isBlank(v) || isError(v)) return false;
    const order = compareValues(v, target);
    return op === 'lt' ? order < 0 : op === 'le' ? order <= 0 : op === 'gt' ? order > 0 : order >= 0;
  };
}

function build(column: Column, cond: FilterCondition): Test | null {
  const read = (text: string | undefined): Value => parseCanonical(column.type, text ?? '');
  const canonical = (v: Value): string => toCanonical(column.type, v);
  switch (cond.op) {
    case 'in': {
      const allowed = new Set(cond.values ?? []);
      return (v) => allowed.has(canonical(v));
    }
    case 'contains': {
      const needle = (cond.value ?? '').toLowerCase();
      return (v) => canonical(v).toLowerCase().includes(needle);
    }
    case 'eq':
      return (v) => compareValues(v, read(cond.value)) === 0 && !isError(v);
    case 'ne':
      return (v) => compareValues(v, read(cond.value)) !== 0 || isError(v);
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      return ordered(cond.op, read(cond.value));
    case 'between': {
      const [low, high] = [ordered('ge', read(cond.value)), ordered('le', read(cond.to))];
      return (v) => low(v) && high(v);
    }
    case 'empty':
      return isBlank;
    case 'notEmpty':
      return (v) => !isBlank(v);
    case 'checked':
      return (v) => v === true;
    case 'unchecked':
      return (v) => v !== true;
    default:
      return null;
  }
}

/** Indices of the rows for which every condition holds. */
export function filterIndices(table: Table, conditions: readonly FilterCondition[]): number[] {
  const tests: { col: number; test: Test }[] = [];
  for (const cond of conditions) {
    const column = table.columns[cond.column];
    const test = column ? build(column, cond) : null;
    if (test) tests.push({ col: cond.column, test });
  }
  const all = table.rows.map((_, i) => i);
  if (tests.length === 0) return all;
  return all.filter((i) => tests.every(({ col, test }) => test(table.rows[i].cells[col].value)));
}

export interface TableView {
  filters?: readonly FilterCondition[];
  sort?: readonly SortKey[];
}

/** The rows a table shows: filtered, then sorted. Totals and charts read these indices. */
export function viewIndices(table: Table, view: TableView, locale: Locale): number[] {
  const shown = filterIndices(table, view.filters ?? []);
  return sortedIndices(table, view.sort ?? [], locale, shown);
}
