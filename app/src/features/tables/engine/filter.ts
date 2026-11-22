// Filters. A condition's values are canonical cell text, so a filter means the same on every device. A condition with
// an unknown operation or column is ignored, which shows more rows, never fewer.

import { splitChoices } from './choice';
import { parseCanonical, toCanonical } from './canonical';
import { compareValues } from './formula/operators';
import type { Column, Table } from './model';
import { isError, type Value } from './values';
import { sortedIndices, type LookOf, type SortKey } from './sort';
import type { Locale } from './locale';

export type FilterOp =
  | 'in'
  | 'contains'
  | 'has'
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
  | 'unchecked'
  | 'beginsWith'
  | 'endsWith'
  | 'notContains'
  /** The largest `value` numbers (or percent of the rows when `to` is "percent"). */
  | 'top'
  /** The smallest `value` numbers (or percent of the rows when `to` is "percent"). */
  | 'bottom'
  | 'aboveAverage'
  | 'belowAverage'
  /** Cells whose fill color is `value`, or `value` "" for cells with no fill. */
  | 'fill'
  | 'fontColor';

export interface FilterCondition {
  column: number;
  op: FilterOp;
  value?: string;
  values?: string[];
  to?: string;
}

const isBlank = (v: Value): boolean => v === null || v === '';

type Test = (v: Value, row: number) => boolean;

interface Context {
  /** The column's values, for the operations that compare a cell with the rest of its column. */
  values: readonly Value[];
  look?: LookOf;
  column: number;
}

function ordered(op: 'lt' | 'le' | 'gt' | 'ge', target: Value): Test {
  return (v) => {
    if (isBlank(v) || isError(v)) return false;
    const order = compareValues(v, target);
    return op === 'lt' ? order < 0 : op === 'le' ? order <= 0 : op === 'gt' ? order > 0 : order >= 0;
  };
}

/** The numbers of a column, for top, bottom, and average. */
const numbers = (values: readonly Value[]): number[] => values.filter((v): v is number => typeof v === 'number');

/** The number a top or bottom filter cuts at: ties at the cut stay in. */
function cutoff(values: readonly Value[], cond: FilterCondition, largest: boolean): number | null {
  const sorted = numbers(values).sort((a, b) => (largest ? b - a : a - b));
  if (sorted.length === 0) return null;
  const asked = Math.max(0, Math.floor(Number(cond.value ?? '10')) || 0);
  // A percent above 0 shows at least one item, as the menus of Excel and Sheets do.
  const count =
    cond.to === 'percent'
      ? asked > 0
        ? Math.max(1, Math.floor((sorted.length * Math.min(asked, 100)) / 100))
        : 0
      : asked;
  return count < 1 ? null : sorted[Math.min(count, sorted.length) - 1];
}

function build(column: Column, cond: FilterCondition, ctx: Context): Test | null {
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
    case 'has': {
      const wanted = (cond.value ?? '').trim().toLowerCase();
      return (v) => splitChoices(canonical(v)).some((name) => name.toLowerCase() === wanted);
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
      return (v, row) => low(v, row) && high(v, row);
    }
    case 'empty':
      return isBlank;
    case 'notEmpty':
      return (v) => !isBlank(v);
    case 'beginsWith': {
      const prefix = (cond.value ?? '').toLowerCase();
      return (v) => canonical(v).toLowerCase().startsWith(prefix);
    }
    case 'endsWith': {
      const suffix = (cond.value ?? '').toLowerCase();
      return (v) => canonical(v).toLowerCase().endsWith(suffix);
    }
    case 'notContains': {
      const needle = (cond.value ?? '').toLowerCase();
      return (v) => !canonical(v).toLowerCase().includes(needle);
    }
    case 'top':
    case 'bottom': {
      const largest = cond.op === 'top';
      const edge = cutoff(ctx.values, cond, largest);
      return (v) => edge !== null && typeof v === 'number' && (largest ? v >= edge : v <= edge);
    }
    case 'aboveAverage':
    case 'belowAverage': {
      const all = numbers(ctx.values);
      const mean = all.length === 0 ? null : all.reduce((a, b) => a + b, 0) / all.length;
      const above = cond.op === 'aboveAverage';
      return (v) => mean !== null && typeof v === 'number' && (above ? v > mean : v < mean);
    }
    case 'fill':
    case 'fontColor': {
      // Without a LookOf there is no color to test, so the condition puts no limit on the rows. Otherwise totals and
      // charts, which have no sheet, would hide every row the grid shows.
      const look = ctx.look;
      if (!look) return () => true;
      const want = (cond.value ?? '').toLowerCase();
      return (_v, row) => (look(row, ctx.column, cond.op as 'fill')?.toLowerCase() ?? '') === want;
    }
    case 'checked':
      return (v) => v === true;
    case 'unchecked':
      return (v) => v !== true;
    default:
      return null;
  }
}

/** Indices of the rows for which every condition holds. */
export function filterIndices(table: Table, conditions: readonly FilterCondition[], look?: LookOf): number[] {
  const tests: { col: number; test: Test }[] = [];
  for (const cond of conditions) {
    const column = table.columns[cond.column];
    const test = column
      ? build(column, cond, { values: table.rows.map((r) => r.cells[cond.column].value), look, column: cond.column })
      : null;
    if (test) tests.push({ col: cond.column, test });
  }
  const all = table.rows.map((_, i) => i);
  if (tests.length === 0) return all;
  return all.filter((i) => tests.every(({ col, test }) => test(table.rows[i].cells[col].value, i)));
}

export interface TableView {
  filters?: readonly FilterCondition[];
  sort?: readonly SortKey[];
}

/** The rows a table shows: filtered, then sorted. Totals and charts read these indices. */
export function viewIndices(table: Table, view: TableView, locale: Locale, look?: LookOf): number[] {
  const shown = filterIndices(table, view.filters ?? [], look);
  return sortedIndices(table, view.sort ?? [], locale, shown, look);
}
