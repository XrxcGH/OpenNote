// Reads the text a person types or pastes: numbers, lists, and tables. A table's cells are split on tabs when a
// line has any, else on bars, commas, or semicolons, else on spaces, so a spreadsheet paste, a CSV line, and a
// typed list all work. Blank lines and lines that start with # are skipped. Nothing here runs the text.
import { fail } from './types';

/** A number from text: a minus sign of either kind, a decimal point, and an exponent are allowed. */
export function readNumber(text: string): number {
  const clean = text.trim().replace(/−/g, '-');
  if (clean === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean)) return NaN;
  return Number(clean);
}

/** The lines that hold something, with their line numbers from 1. */
export function lines(text: string): { line: number; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((one, i) => ({ line: i + 1, text: one.trim() }))
    .filter((one) => one.text !== '' && !one.text.startsWith('#'));
}

/** A line's cells. */
export function cells(line: string): string[] {
  const split = line.includes('\t')
    ? line.split('\t')
    : line.includes('|')
      ? line.split('|')
      : /[,;]/.test(line)
        ? line.split(/[,;]/)
        : line.split(/\s+/);
  return split.map((cell) => cell.trim());
}

/** Numbers in a list, split on commas, semicolons, or spaces. */
export function readList(text: string, field: string): number[] {
  const parts = text.split(/[\s,;]+/).filter((part) => part !== '');
  if (parts.length === 0) fail('empty', {}, field);
  return parts.map((part) => {
    const value = readNumber(part);
    if (Number.isNaN(value)) fail('badCell', { cell: part, line: 1 }, field);
    return value;
  });
}

/** A missing value: an empty cell, NA, a dot, or a dash. */
export const isMissing = (cell: string): boolean => /^(|na|n\/a|\.|-|nan)$/i.test(cell.trim());

export interface Table {
  /** The first line when any of its cells is not a number; otherwise null. */
  readonly header: string[] | null;
  readonly rows: string[][];
  /** Each row's line number, for messages. */
  readonly lineOf: number[];
}

/** A table of cells. A first line with a word in it is taken as the column names. */
export function readTable(text: string, field: string): Table {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, field);
  const first = cells(found[0].text);
  const header = first.some((cell) => !isMissing(cell) && Number.isNaN(readNumber(cell))) ? first : null;
  const body = header ? found.slice(1) : found;
  return { header, rows: body.map((one) => cells(one.text)), lineOf: body.map((one) => one.line) };
}

/**
 * A table of numbers with the same number of columns on every line. A first line of names is kept as the
 * header. Missing cells are NaN when `missing` is true; otherwise they stop the tool.
 */
export function readMatrix(
  text: string,
  field: string,
  missing = false,
): { header: string[] | null; rows: number[][] } {
  const table = readTable(text, field);
  if (table.rows.length === 0) fail('empty', {}, field);
  const width = table.header?.length ?? table.rows[0].length;
  const rows = table.rows.map((row, r) => {
    const line = table.lineOf[r];
    if (row.length !== width) fail('ragged', { line, got: row.length, want: width }, field);
    return row.map((cell) => {
      if (missing && isMissing(cell)) return NaN;
      const value = readNumber(cell);
      if (Number.isNaN(value)) fail('badCell', { cell, line }, field);
      return value;
    });
  });
  return { header: table.header, rows };
}

/** The column whose name matches, ignoring case; or -1. */
export const columnOf = (header: readonly string[], name: string): number =>
  header.findIndex((cell) => cell.trim().toLowerCase() === name.trim().toLowerCase());
