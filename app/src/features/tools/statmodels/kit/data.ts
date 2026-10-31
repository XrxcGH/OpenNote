// Tables of data as people paste them: from a spreadsheet (tabs), a CSV or TSV file, or columns typed with
// spaces. The first line names the columns when any of its cells is not a number; otherwise the columns are named
// c1, c2, and so on. An empty cell, NA, or a dot is a missing value, and a tool uses the rows where every column it
// needs has a value. Nothing here runs the text: each cell is read as a number or kept as a word.
import { fail } from './types';

export interface DataTable {
  readonly names: readonly string[];
  /** The cells by row, as typed, trimmed. */
  readonly cells: readonly (readonly string[])[];
}

export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 60;
const MISSING = new Set(['', 'na', 'n/a', 'nan', '.', 'null', '?']);

/** A cell as a number: NaN when it is missing, and null when it is a word. */
export function cellNumber(cell: string): number | null {
  const text = cell.trim();
  if (MISSING.has(text.toLowerCase())) return NaN;
  const normal = text.replace(/^[−–]/, '-');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(normal)) return null;
  const value = Number(normal.replace(/%$/, ''));
  return normal.endsWith('%') ? value / 100 : value;
}

export const isMissing = (cell: string): boolean => MISSING.has(cell.trim().toLowerCase());

/** Splits one CSV line, honoring double quotes, and doubled quotes inside them. */
function splitQuoted(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delimiter) {
      out.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function delimiterOf(lines: readonly string[]): string {
  if (lines.some((line) => line.includes('\t'))) return '\t';
  if (lines.some((line) => line.includes(','))) return ',';
  if (lines.some((line) => line.includes(';'))) return ';';
  return ' ';
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === ' ') return line.trim().split(/\s+/);
  return splitQuoted(line, delimiter);
}

/** Reads pasted text into a table. It stops with a message when the rows have different numbers of cells. */
export function parseTable(text: string): DataTable {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  if (lines.length === 0) fail('noData');
  const delimiter = delimiterOf(lines);
  const rows = lines.map((line) => splitLine(line, delimiter));
  const width = rows[0].length;
  if (width > MAX_COLUMNS) fail('tooWide', String(MAX_COLUMNS));
  rows.forEach((row, i) => {
    if (row.length !== width) fail('ragged', `${i + 1}|${width}`);
  });
  const header = rows[0].some((cell) => cellNumber(cell) === null);
  const body = header ? rows.slice(1) : rows;
  if (body.length === 0) fail('noData');
  if (body.length > MAX_ROWS) fail('tooLong', String(MAX_ROWS));
  const names = header ? uniqueNames(rows[0]) : rows[0].map((_, i) => `c${i + 1}`);
  return { names, cells: body };
}

function uniqueNames(header: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((raw, i) => {
    const base = raw === '' ? `c${i + 1}` : raw;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}.${count + 1}`;
  });
}

/** The column names of pasted text, or an empty list when it cannot be read. For the column pickers. */
export function columnNames(text: string): string[] {
  try {
    return [...parseTable(text).names];
  } catch {
    return [];
  }
}

export function columnIndex(table: DataTable, name: string): number {
  const at = table.names.indexOf(name);
  if (at < 0) fail('noColumn', name);
  return at;
}

/** True when every value present in the column is a number. */
export function isNumericColumn(table: DataTable, name: string): boolean {
  const at = columnIndex(table, name);
  return table.cells.every((row) => cellNumber(row[at]) !== null);
}

/**
 * The first word in a column that is otherwise numbers, such as "five" among 4 or more numbers that make up at least
 * 80% of it. That is more likely a slip than a column of words, so the tools say so instead of making levels.
 */
export function strayWord(table: DataTable, name: string): string | null {
  const at = columnIndex(table, name);
  const present = table.cells.map((row) => row[at]).filter((cell) => !isMissing(cell));
  const words = present.filter((cell) => cellNumber(cell) === null);
  const numbers = present.length - words.length;
  return words.length > 0 && numbers >= 4 && numbers >= 0.8 * present.length ? words[0].trim() : null;
}

/** The rows where every named column has a value. */
export function completeRows(table: DataTable, names: readonly string[]): number[] {
  const at = names.map((name) => columnIndex(table, name));
  const rows: number[] = [];
  table.cells.forEach((row, r) => {
    if (at.every((i) => !isMissing(row[i]))) rows.push(r);
  });
  return rows;
}

/** A numeric column at the given rows. It stops with a message naming the first cell that is a word. */
export function numbersAt(table: DataTable, name: string, rows: readonly number[]): number[] {
  const at = columnIndex(table, name);
  return rows.map((r) => {
    const value = cellNumber(table.cells[r][at]);
    if (value === null) fail('notNumeric', `${name}|${table.cells[r][at]}`);
    return value;
  });
}

/** A column's cells at the given rows, as text. */
export const wordsAt = (table: DataTable, name: string, rows: readonly number[]): string[] => {
  const at = columnIndex(table, name);
  return rows.map((r) => table.cells[r][at].trim());
};

/** The numbers of one column, with missing values left out. */
export function numericColumn(table: DataTable, name: string): number[] {
  return numbersAt(table, name, completeRows(table, [name]));
}

/** Reads a list of numbers typed with commas, spaces, or one to a line. */
export function parseNumbers(text: string, what: string): number[] {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== '');
  return parts.map((part) => {
    const value = cellNumber(part);
    if (value === null || Number.isNaN(value)) fail('notNumeric', `${what}|${part}`);
    return value;
  });
}

/** Sorted distinct values of a column of words, in the order a person expects: numbers by size, words A to Z. */
export function levelsOf(values: readonly string[]): string[] {
  const distinct = [...new Set(values)];
  const allNumbers = distinct.every((v) => cellNumber(v) !== null);
  return allNumbers ? distinct.sort((a, b) => Number(a) - Number(b)) : distinct.sort((a, b) => a.localeCompare(b));
}
