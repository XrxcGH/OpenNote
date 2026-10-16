// From the text in a table's cells to the engine's typed table (Phase 7). The cells keep what was typed. This reads
// them by the columns' types, runs the formulas, and says what each cell shows, which rows the filters leave, and
// what a chart or a total reads. It is pure, so tests run it without an editor.
import {
  columnLetter,
  createTable,
  filterIndices,
  formatValue,
  isError,
  parseDate,
  parseLocaleNumber,
} from '../engine';
import type { ColumnInit, ColumnType, FilterCondition, Locale, Table } from '../engine';
import type { SmartData } from './data';

/** Cell text as typed, one list per row. The header row, when there is one, comes first. */
export interface Grid {
  header: boolean;
  columnIds: readonly string[];
  texts: readonly (readonly string[])[];
}

export interface SmartModel {
  table: Table;
  /** 1 when the first row of the grid is a header row. */
  offset: 0 | 1;
  columnIds: readonly string[];
  /** The header text, or the column letter. Formulas refer to a column by this name. */
  names: readonly string[];
  /** Engine row indices the filters leave, in stored order. */
  shown: readonly number[];
}

const NUMBER_SHARE = 0.9;

/** The type of a column nobody picked: numbers, percents, or dates when nine in ten cells read as one. */
export function inferType(cells: readonly string[], locale: Locale): ColumnType {
  const filled = cells.map((cell) => cell.trim()).filter((cell) => cell !== '');
  if (filled.length === 0) return 'text';
  const formulas = filled.filter((cell) => cell.startsWith('=')).length;
  if (formulas === filled.length) return 'number';
  const plain = filled.filter((cell) => !cell.startsWith('='));
  const numbers = plain.filter((cell) => parseLocaleNumber(cell, locale) !== null);
  if (numbers.length >= plain.length * NUMBER_SHARE) {
    return numbers.every((cell) => cell.endsWith('%')) ? 'percent' : 'number';
  }
  const dates = plain.filter((cell) => parseDate(cell, locale.dateOrder) !== null);
  return dates.length >= plain.length * NUMBER_SHARE ? 'date' : 'text';
}

export function buildModel(grid: Grid, smart: SmartData, locale: Locale): SmartModel {
  const offset = grid.header ? 1 : 0;
  const body = grid.texts.slice(offset);
  const names = grid.columnIds.map((_, c) => (grid.header ? grid.texts[0]?.[c]?.trim() : '') || columnLetter(c));
  const inits: ColumnInit[] = grid.columnIds.map((id, c) => {
    const own = smart.columns[id] ?? {};
    const type =
      own.type ??
      inferType(
        body.map((row) => row[c] ?? ''),
        locale,
      );
    return {
      id,
      name: names[c],
      type,
      ...(own.decimals !== undefined ? { decimals: own.decimals } : {}),
      ...(own.currency ? { currency: own.currency } : {}),
      ...(own.total ? { total: own.total } : {}),
    };
  });
  const table = createTable(inits, body, locale);
  const conditions = smart.filters.flatMap((filter): FilterCondition[] => {
    const column = grid.columnIds.indexOf(filter.column);
    return column < 0
      ? []
      : [
          {
            column,
            op: filter.op,
            ...(filter.value !== undefined ? { value: filter.value } : {}),
            ...(filter.to !== undefined ? { to: filter.to } : {}),
          },
        ];
  });
  return { table, offset, columnIds: grid.columnIds, names, shown: filterIndices(table, conditions) };
}

export interface Shown {
  text: string;
  kind: 'number' | 'error' | 'text';
}

/** What a cell shows in place of its typed text, or null when the typed text is what to show. */
export function shownFor(
  model: SmartModel,
  smart: SmartData,
  row: number,
  column: number,
  locale: Locale,
): Shown | null {
  const cell = model.table.rows[row]?.cells[column];
  const col = model.table.columns[column];
  if (!cell || !col) return null;
  const own = smart.columns[model.columnIds[column]];
  const formatted = own?.type !== undefined || own?.decimals !== undefined || own?.currency !== undefined;
  if (cell.formula === undefined && !(formatted && cell.value !== null && typeof cell.value !== 'string')) return null;
  const text = formatValue(cell.value, col, locale);
  if (cell.formula === undefined && text === cell.raw.trim()) return null;
  return { text, kind: isError(cell.value) ? 'error' : typeof cell.value === 'number' ? 'number' : 'text' };
}
