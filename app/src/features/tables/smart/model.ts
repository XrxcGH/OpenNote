// From the text in a table's cells to the engine's typed table (Phase 7). The cells keep what was typed. This reads
// them by the columns' types, runs the formulas, and says what each cell shows, which rows the filters leave, and
// what a chart or a total reads. It is pure, so tests run it without an editor.
import {
  columnLetter,
  ERROR_TOKENS,
  ERROR_WORDS,
  filterIndices,
  formatValue,
  isError,
  makeCell,
  parseDate,
  parseLocaleNumber,
  recalculate,
} from '../engine';
import type {
  Column,
  ColumnInit,
  ColumnType,
  ErrorCode,
  FilterCondition,
  IterateSettings,
  Locale,
  Row,
  Table,
  TableName,
} from '../engine';
import { namesOf, tableName } from '../sheet/model';
import type { Sheet } from '../sheet/model';
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

/** The settings of data.sheet the engine reads: the version, the table's name, names, and how it calculates. */
function sheetRules(sheet: Sheet | undefined): Partial<Table> {
  if (!sheet) return {};
  const rules: Partial<Table> = {};
  if (typeof sheet.v === 'number' && Number.isInteger(sheet.v) && sheet.v >= 1) rules.sheetVersion = sheet.v;
  const name = tableName(sheet);
  if (name) rules.name = name;
  const names = namesOf(sheet).map((n): TableName => ({ name: n.name, ref: n.ref, scope: n.scope }));
  if (names.length > 0) rules.names = names;
  const table = sheet.table;
  if (table && typeof table === 'object' && !Array.isArray(table)) {
    if (table.calc === 'manual') rules.calc = 'manual';
    const iterate = table.iterate;
    if (iterate && typeof iterate === 'object' && !Array.isArray(iterate)) {
      const { max, change } = iterate as Partial<Record<keyof IterateSettings, unknown>>;
      if (typeof max === 'number' && typeof change === 'number') rules.iterate = { max, change };
    }
  }
  return rules;
}

/** A table's typed cells before any formula runs, so a whole page can be calculated as one workbook. */
export interface Prepared {
  /** The table with every formula still to run. */
  raw: Table;
  offset: 0 | 1;
  columnIds: readonly string[];
  names: readonly string[];
}

/** Reads the cells by the columns' types, without running the formulas. `sheet` is the block's data.sheet. */
export function prepareModel(grid: Grid, smart: SmartData, locale: Locale, sheet?: Sheet): Prepared {
  const offset = grid.header ? 1 : 0;
  const body = grid.texts.slice(offset);
  const names = grid.columnIds.map((_, c) => (grid.header ? grid.texts[0]?.[c]?.trim() : '') || columnLetter(c));
  const inits: ColumnInit[] = grid.columnIds.map((id, c) => {
    const own = smart.columns[id] ?? {};
    const type =
      own.type ??
      (own.unit ? 'number' : undefined) ??
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
      ...(type === 'number' && own.unit ? { unit: own.unit } : {}),
      ...(type === 'number' && own.notation ? { notation: own.notation } : {}),
      ...(type === 'choice'
        ? { options: (own.options ?? []).map((option) => option.name), ...(own.multi ? { multi: true } : {}) }
        : {}),
    };
  });
  const rules = sheetRules(sheet);
  const version = rules.sheetVersion === undefined ? {} : { sheetVersion: rules.sheetVersion };
  const columns: Column[] = inits.map((init, i) => ({ id: `c${i}`, type: 'text', ...init }));
  const rows: Row[] = body.map((line, r) => ({
    id: `r${r}`,
    cells: columns.map((column, c) => makeCell(column, line[c] ?? '', locale, true, version)),
  }));
  return { raw: { columns, rows, ...rules }, offset, columnIds: grid.columnIds, names };
}

/** The model of a table whose formulas have run: `table` is `prepared.raw` calculated, alone or with its page. */
export function finishModel(prepared: Prepared, table: Table, smart: SmartData): SmartModel {
  const { offset, columnIds, names } = prepared;
  const conditions = smart.filters.flatMap((filter): FilterCondition[] => {
    const column = columnIds.indexOf(filter.column);
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
  return { table, offset, columnIds, names, shown: filterIndices(table, conditions) };
}

/** The model of one table calculated on its own. */
export function buildModel(grid: Grid, smart: SmartData, locale: Locale, sheet?: Sheet): SmartModel {
  const prepared = prepareModel(grid, smart, locale, sheet);
  return finishModel(prepared, recalculate(prepared.raw), smart);
}

export interface Shown {
  text: string;
  kind: 'number' | 'error' | 'text';
  /** The error a formula gives (decision 3: the cell shows Excel's token, the tooltip says it in words). */
  error?: ErrorCode;
  /** The value comes from a formula above or to the left that spills over this cell. */
  spill?: true;
}

/** What an error shows in its cell: Excel's token, or Circular for a cell in a circle of formulas. */
export const errorText = (code: ErrorCode): string => (code === 'CYCLE' ? ERROR_WORDS.CYCLE : ERROR_TOKENS[code]);

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
  const formatted =
    own?.type !== undefined ||
    own?.decimals !== undefined ||
    own?.currency !== undefined ||
    own?.unit !== undefined ||
    own?.notation !== undefined;
  const spill = cell.spill === true && cell.formula === undefined;
  if (isError(cell.value) && (cell.formula !== undefined || spill)) {
    return { text: errorText(cell.value.error), kind: 'error', error: cell.value.error, ...(spill ? { spill } : {}) };
  }
  if (spill) {
    const text = cell.value === null ? '' : formatValue(cell.value, col, locale);
    return { text, kind: typeof cell.value === 'number' ? 'number' : 'text', spill };
  }
  if (cell.formula === undefined && !(formatted && cell.value !== null && typeof cell.value !== 'string')) return null;
  const text = formatValue(cell.value, col, locale);
  if (cell.formula === undefined && text === cell.raw.trim()) return null;
  return { text, kind: isError(cell.value) ? 'error' : typeof cell.value === 'number' ? 'number' : 'text' };
}
