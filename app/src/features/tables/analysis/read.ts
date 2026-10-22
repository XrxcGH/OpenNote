// Reads the numbers of a table's selection for the analysis tools. The selection is the selected cells, or the whole
// table when only the cursor is in it. Rows the filters hide are left out. A number may carry a unit, such as
// "12.5 kg"; a column whose numbers share one unit keeps it in the results.
import { columnLetter, parseLocaleNumber } from '../engine';
import type { Locale } from '../engine';
import type { SmartModel } from '../smart/model';
import type { Range } from '../smart/ops';

export const MAX_CELLS = 20000;

export interface Block {
  /** Table column indexes, left to right. */
  cols: number[];
  /** Data row indexes (counted without the header) that the block reads, top to bottom. */
  rows: number[];
  names: string[];
  /** The unit all the numbers of a column share, or null. */
  units: (string | null)[];
  /** `values[r][c]` for the row and column at the same place in `rows` and `cols`. Null where there is no number. */
  values: (number | null)[][];
  /** A column whose numbers have different units. */
  mixed: { column: string; units: string } | null;
}

const WITH_UNIT = /^\s*([-+−]?(?:\d[\d.,\s]*|[.,]\d+)(?:[eE][-+]?\d+)?)\s*([^\d\s.,+\-−].*?)\s*$/;

export interface Reading {
  value: number | null;
  unit: string | null;
}

/** A cell's number and unit. Text such as "12.5 kg" reads as 12.5 with the unit kg. */
export function readCell(model: SmartModel, locale: Locale, row: number, column: number): Reading {
  const cell = model.table.rows[row]?.cells[column];
  if (!cell) return { value: null, unit: null };
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return { value: cell.value, unit: null };
  if (typeof cell.value !== 'string') return { value: null, unit: null };
  const found = WITH_UNIT.exec(cell.value);
  if (!found) return { value: null, unit: null };
  const parsed = parseLocaleNumber(found[1].replace('−', '-'), locale);
  return parsed ? { value: parsed.value, unit: found[2] } : { value: null, unit: null };
}

/** The address of a data cell the way the table's strip shows it: column letter, then the row below the header. */
export const addressOf = (row: number, column: number) => `${columnLetter(column)}${row + 1}`;

export function readBlock(
  model: SmartModel,
  locale: Locale,
  range: Range | null,
  hidden: 'skip' | 'keep' = 'skip',
): Block | null {
  const single = range === null || (range.row0 === range.row1 && range.col0 === range.col1);
  const colCount = model.columnIds.length;
  const cols = single
    ? Array.from({ length: colCount }, (_, c) => c)
    : Array.from({ length: range.col1 - range.col0 + 1 }, (_, i) => range.col0 + i);
  const first = single ? 0 : Math.max(0, range.row0 - model.offset);
  const last = single ? model.table.rows.length - 1 : range.row1 - model.offset;
  const shown = new Set(model.shown);
  const rows: number[] = [];
  for (let r = first; r <= last; r++) if (hidden === 'keep' || shown.has(r)) rows.push(r);
  if (rows.length === 0 || cols.length === 0 || rows.length * cols.length > MAX_CELLS) return null;
  const readings = rows.map((r) => cols.map((c) => readCell(model, locale, r, c)));
  const units: (string | null)[] = [];
  let mixed: Block['mixed'] = null;
  cols.forEach((c, i) => {
    const found = new Set(
      readings
        .map((row) => row[i])
        .filter((one) => one.value !== null)
        .map((one) => one.unit),
    );
    if (found.size > 1 && !mixed) {
      mixed = { column: model.names[c], units: [...found].map((unit) => unit ?? '—').join(', ') };
    }
    units.push(found.size === 1 ? ([...found][0] ?? null) : null);
  });
  return {
    cols,
    rows,
    names: cols.map((c) => model.names[c]),
    units,
    values: readings.map((row) => row.map((one) => one.value)),
    mixed,
  };
}

/** The numbers of one column of the block, in order, without the gaps. */
export const columnValues = (block: Block, index: number): number[] =>
  block.values.flatMap((row) => (row[index] === null ? [] : [row[index] as number]));

/** A range such as "D1:E2" as zero-based data rows and columns, or null when it does not read as one. */
export function parseRange(text: string): Range | null {
  const found = /^\s*([A-Za-z]{1,3})(\d{1,6})\s*(?::\s*([A-Za-z]{1,3})(\d{1,6}))?\s*$/.exec(text);
  if (!found) return null;
  const column = (letters: string) =>
    [...letters.toUpperCase()].reduce((total, ch) => total * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const [c0, r0] = [column(found[1]), Number(found[2]) - 1];
  const [c1, r1] = found[3] ? [column(found[3]), Number(found[4]) - 1] : [c0, r0];
  if (r0 < 0 || r1 < 0) return null;
  return { row0: Math.min(r0, r1), row1: Math.max(r0, r1), col0: Math.min(c0, c1), col1: Math.max(c0, c1) };
}
