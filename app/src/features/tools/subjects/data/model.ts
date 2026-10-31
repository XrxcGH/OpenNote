// The data set every subject tool reads: named columns of numbers, categories, dates, or free text. Missing values
// are kept as null, so a tool can say how many it left out. Dates are days since 1970-01-01 (fractions are the
// time of day), the convention of the smart tables.

export type ColumnKind = 'number' | 'category' | 'date' | 'text';

export type DataColumn =
  | { name: string; kind: 'number'; values: (number | null)[]; unit: string | null }
  | { name: string; kind: 'date'; values: (number | null)[] }
  | { name: string; kind: 'category' | 'text'; values: (string | null)[] };

/** A cell that could not be read as its column's kind; it is kept as missing and reported. */
export interface DataProblem {
  column: string;
  /** The data row, counted from 1 below the header. */
  row: number;
  text: string;
}

export interface DataSet {
  columns: DataColumn[];
  /** The number of data rows (every column has this many values). */
  rows: number;
  /** True when the input had more than MAX_ROWS rows and the rest were left out. */
  truncated: boolean;
  problems: DataProblem[];
  /**
   * Set when the decimal mark was guessed for a column whose every cell, such as "1,234", reads both ways: the
   * column named, and the mark chosen ('.' means the commas were read as thousands separators).
   */
  decimalGuess?: { column: string; decimal: '.' | ',' };
}

/** The most rows a pasted or loaded data set keeps. */
export const MAX_ROWS = 100_000;

/** Cell text that means "no value": blank, NA, N/A, a lone full stop, and NaN (any letter case). */
export const MISSING_TOKENS: readonly string[] = ['', 'na', 'n/a', '.', 'nan'];

export const isMissingText = (text: string): boolean => MISSING_TOKENS.includes(text.trim().toLowerCase());

export const emptyDataSet = (): DataSet => ({ columns: [], rows: 0, truncated: false, problems: [] });

/** The column with this name, or null. */
export const columnNamed = (data: DataSet, name: string): DataColumn | null =>
  data.columns.find((c) => c.name === name) ?? null;

/** The present numbers of a number or date column, in row order (missing values dropped). */
export function numbersOf(column: DataColumn): number[] {
  if (column.kind !== 'number' && column.kind !== 'date') return [];
  return column.values.filter((v): v is number => v !== null);
}

/** Each row's value as text, for categories (numbers and dates are written plainly), or null when missing. */
export function labelsOf(column: DataColumn): (string | null)[] {
  if (column.kind === 'category' || column.kind === 'text') return column.values.slice();
  return column.values.map((v) => (v === null ? null : String(v)));
}

/** The distinct present labels of a column, in order of first appearance. */
export function levelsOf(column: DataColumn): string[] {
  const seen = new Set<string>();
  for (const label of labelsOf(column)) if (label !== null) seen.add(label);
  return [...seen];
}

/**
 * Rows where every named column has a value, for paired analyses: returns the kept row indexes and how many rows
 * were dropped for a missing value.
 */
export function completeRows(data: DataSet, names: readonly string[]): { rows: number[]; dropped: number } {
  const columns = names.map((n) => columnNamed(data, n)).filter((c): c is DataColumn => c !== null);
  const rows: number[] = [];
  for (let r = 0; r < data.rows; r += 1) if (columns.every((c) => c.values[r] !== null)) rows.push(r);
  return { rows, dropped: data.rows - rows.length };
}
