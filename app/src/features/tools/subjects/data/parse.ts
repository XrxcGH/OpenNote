// Reading pasted text, CSV and TSV files, and table grids into a DataSet. The delimited reader is the smart tables'
// own: quoted fields, doubled quotes, and line breaks inside quotes. This module adds what statistics needs: a
// header guess, a column kind for each column, decimal commas, missing-value tokens, units, and the row cap.
import {
  EN_US,
  columnLetter,
  daysToIso,
  parseDate,
  parseDelimited,
  parseLocaleNumber,
  sniffDelimiter,
  stripBom,
} from '../../../tables';
import type { Delimiter, Locale } from '../../../tables';
import { MAX_ROWS, isMissingText } from './model';
import type { ColumnKind, DataColumn, DataProblem, DataSet } from './model';

export type DelimiterChoice = Delimiter | 'whitespace' | 'auto';

export interface ParseOptions {
  /** The region's conventions; decimal commas are also detected from the data. Defaults to en-US. */
  locale?: Locale;
  delimiter?: DelimiterChoice;
  /** Whether the first row names the columns; 'auto' guesses from the cells. */
  header?: 'auto' | 'yes' | 'no';
  maxRows?: number;
  /** The decimal mark: 'auto' votes from the cells (the default), 'point' and 'comma' fix it. */
  decimal?: DecimalChoice;
}

export type DecimalChoice = 'auto' | 'point' | 'comma';

type Convention = Pick<Locale, 'decimal' | 'group'>;
const DOT: Convention = { decimal: '.', group: ',' };
const COMMA: Convention = { decimal: ',', group: '.' };
const PLAIN_DOT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const PLAIN_COMMA = /^[+-]?(?:\d+,?\d*|,\d+)(?:[eE][+-]?\d+)?$/;
/**
 * A number followed by a unit, such as "12.5 kg" or "3,2 °C". The unit starts with a letter or a unit sign, so a
 * date "03/04/2024", a time "3:45", a fraction "1/2" or a range "5–6" is not read as its leading digits. Percent and
 * currency signs are read by parseLocaleNumber.
 */
const WITH_UNIT = /^(.*?\d)\s*([\p{L}°µ].*)$/u;
/** How much of a column must read as numbers (or dates) for the column to be that kind. */
const KIND_SHARE = 0.8;
/** The decimal-mark vote reads this many rows; that is plenty and keeps a large paste quick. */
const VOTE_ROWS = 2000;
/** A text column with at most this many distinct values, some repeated, is a category. */
const MAX_LEVELS = 50;

interface Reading {
  value: number;
  unit: string | null;
}

/**
 * A cell such as "1,234" that reads both as one thousand two hundred thirty-four (a grouping comma) and as 1.234 (a
 * decimal comma): one to three digits, one comma, exactly three digits, and nothing more but a unit.
 */
const GROUP_OR_DECIMAL = /^[+\-−]?\d{1,3},\d{3}(?![\d.,])/;

/**
 * Reads one cell as a number in the given convention, with an optional unit after it. A number too large or too small
 * for a double ("1e400") is not read, so the column reports it instead of holding an infinity.
 */
export function readNumber(text: string, convention: Convention): Reading | null {
  const reading = readFinite(text, convention);
  return reading && Number.isFinite(reading.value) ? reading : null;
}

function isOverflow(text: string, convention: Convention): boolean {
  const reading = readFinite(text, convention);
  return reading !== null && !Number.isFinite(reading.value);
}

function readFinite(text: string, convention: Convention): Reading | null {
  const cell = text.trim().replace('−', '-');
  if (convention.decimal === '.' ? PLAIN_DOT.test(cell) : PLAIN_COMMA.test(cell)) {
    return { value: Number(convention.decimal === '.' ? cell : cell.replace(',', '.')), unit: null };
  }
  const locale: Locale = { ...EN_US, ...convention };
  const parsed = parseLocaleNumber(cell, locale);
  if (parsed) return { value: parsed.value, unit: parsed.percent ? '%' : parsed.currency };
  const split = WITH_UNIT.exec(cell);
  if (!split) return null;
  const head = parseLocaleNumber(split[1], locale);
  return head && !head.percent && head.currency === null ? { value: head.value, unit: split[2].trim() } : null;
}

/** Picks the decimal mark by a vote of the cells that read one way only; a tie keeps the region's mark. */
function voteConvention(cells: readonly string[], locale: Locale): Convention {
  let dotOnly = 0;
  let commaOnly = 0;
  for (const cell of cells) {
    if (isMissingText(cell)) continue;
    const dot = readNumber(cell, DOT) !== null;
    const comma = readNumber(cell, COMMA) !== null;
    if (dot && !comma) dotOnly += 1;
    if (comma && !dot) commaOnly += 1;
  }
  if (dotOnly === commaOnly) return locale.decimal === ',' ? COMMA : DOT;
  return commaOnly > dotOnly ? COMMA : DOT;
}

function splitRows(text: string, delimiter: DelimiterChoice, maxRows: number): string[][] {
  const source = stripBom(text);
  if (delimiter === 'whitespace') return whitespaceRows(source, maxRows);
  if (delimiter !== 'auto') return parseDelimited(source, delimiter, maxRows);
  const sniffed = sniffDelimiter(source);
  if (sniffed) return parseDelimited(source, sniffed, maxRows);
  const lines = source.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  if (lines.length === 1) return oneLineList(lines[0]);
  const spaced = whitespaceRows(source, maxRows);
  return isRectangular(spaced) ? spaced : lines.slice(0, maxRows).map((l) => [l.trim()]);
}

function whitespaceRows(source: string, maxRows: number): string[][] {
  return source
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, maxRows)
    .map((l) => l.trim().split(/\s+/));
}

/** A single pasted line such as "1, 2, 3" or "4 5 6" is a list of values: one column, one value per row. */
function oneLineList(line: string): string[][] {
  const parts = line.includes(';') ? line.split(';') : line.includes(',') ? line.split(',') : line.trim().split(/\s+/);
  return parts.map((p) => [p.trim()]);
}

function isRectangular(rows: readonly string[][]): boolean {
  if (rows.length < 2 || rows[0].length < 2) return false;
  const width = rows[0].length;
  return rows.filter((r) => r.length === width).length >= rows.length * 0.9;
}

/** Reads pasted text or a CSV or TSV file into a data set. */
export function parseDataText(text: string, options: ParseOptions = {}): DataSet {
  const maxRows = options.maxRows ?? MAX_ROWS;
  // One extra row for a possible header, and one more to learn that the input was cut.
  const grid = splitRows(text, options.delimiter ?? 'auto', maxRows + 2);
  return dataFromGrid(grid, options);
}

/** Builds a data set from rows of cell text: the header guess, the column kinds, and the row cap. */
export function dataFromGrid(grid: readonly (readonly string[])[], options: ParseOptions = {}): DataSet {
  const locale = options.locale ?? EN_US;
  const maxRows = options.maxRows ?? MAX_ROWS;
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  const rows = grid.map((r) => Array.from({ length: width }, (_, c) => (r[c] ?? '').trim()));
  const choice = options.decimal ?? 'auto';
  const convention =
    choice === 'point' ? DOT : choice === 'comma' ? COMMA : voteConvention(rows.slice(0, VOTE_ROWS).flat(), locale);
  const header = options.header === 'yes' || (options.header !== 'no' && looksLikeHeader(rows, convention));
  const body = header ? rows.slice(1) : rows;
  const truncated = body.length > maxRows;
  const kept = truncated ? body.slice(0, maxRows) : body;
  const names = uniqueNames(Array.from({ length: width }, (_, c) => (header ? rows[0][c] : '') || columnLetter(c)));
  const problems: DataProblem[] = [];
  const columns = names.map((name, c) => {
    const read = readColumn(
      name,
      kept.map((r) => r[c]),
      convention,
      locale,
    );
    problems.push(...read.problems);
    return read.column;
  });
  const data: DataSet = { columns, rows: kept.length, truncated, problems };
  if (choice === 'auto') {
    const guessed = columns.find(
      (column, c) =>
        column.kind === 'number' &&
        isGroupOrDecimal(
          kept.map((r) => r[c]),
          convention,
        ),
    );
    if (guessed) data.decimalGuess = { column: guessed.name, decimal: convention.decimal };
  }
  return data;
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

/** True when every present cell of a column reads either as a grouped or as a decimal-comma number. */
function isGroupOrDecimal(cells: readonly string[], convention: Convention): boolean {
  const present = cells.filter((cell) => !isMissingText(cell) && readNumber(cell, convention) !== null);
  return present.length > 0 && present.every((cell) => GROUP_OR_DECIMAL.test(cell));
}

const isNumberCell = (cell: string, convention: Convention) =>
  !isMissingText(cell) && readNumber(cell, convention) !== null;

/** The first row is a header when it has a word above a column of numbers, or names an all-text table uniquely. */
function looksLikeHeader(rows: readonly string[][], convention: Convention): boolean {
  if (rows.length < 2) return false;
  const [first, ...rest] = rows;
  for (let c = 0; c < first.length; c += 1) {
    const below = rest.map((r) => r[c]).filter((cell) => !isMissingText(cell));
    const numeric = below.filter((cell) => isNumberCell(cell, convention)).length;
    if (!isMissingText(first[c]) && !isNumberCell(first[c], convention) && numeric > 0 && numeric >= below.length / 2)
      return true;
  }
  const anyNumbers = rows.some((r) => r.some((cell) => isNumberCell(cell, convention)));
  if (anyNumbers) return false;
  return (
    first.every((cell, c) => cell !== '' && rest.every((r) => r[c] !== cell)) && new Set(first).size === first.length
  );
}

interface ColumnRead {
  column: DataColumn;
  problems: DataProblem[];
}

/** Reads one column as the kind most of its cells fit: numbers, then dates, then categories or text. */
export function readColumn(name: string, cells: readonly string[], convention: Convention, locale: Locale): ColumnRead {
  const present = cells.filter((cell) => !isMissingText(cell));
  const numbers = cells.map((cell) => (isMissingText(cell) ? null : readNumber(cell, convention)));
  // A number too large for a double ("1e400") was meant as a number: it counts toward the kind and is reported.
  const tooLarge = cells.filter((cell) => !isMissingText(cell) && isOverflow(cell, convention)).length;
  const numeric = numbers.filter((n) => n !== null).length + tooLarge;
  // One stray token in a short number column ("1, 2, three, 4" is only 75% numbers) is a typo to report, not a
  // reason to lose the whole column as text.
  const oneStray = numeric >= 2 && present.length - numeric === 1;
  if (present.length === 0 || numeric >= KIND_SHARE * present.length || oneStray) {
    // Cells in different units cannot be averaged together: the column takes its most common unit (no unit counts
    // as one), and a cell in any other unit is left out and reported.
    const unit = mostCommonUnit(numbers);
    const values = numbers.map((n) => (n !== null && n.unit === unit ? n.value : null));
    const kept = values.filter((v) => v !== null).length;
    if (
      kept === numeric - tooLarge ||
      kept >= KIND_SHARE * present.length ||
      (kept >= 2 && present.length - kept === 1)
    ) {
      const column: DataColumn = { name, kind: 'number', values, unit };
      return { column, problems: problemsOf(name, cells, values) };
    }
  }
  const dates = cells.map((cell) => (isMissingText(cell) ? null : parseDate(cell, locale.dateOrder)));
  if (dates.filter((d) => d !== null).length >= KIND_SHARE * present.length) {
    const column: DataColumn = { name, kind: 'date', values: dates };
    return { column, problems: problemsOf(name, cells, dates) };
  }
  const labels = cells.map((cell) => (isMissingText(cell) ? null : cell));
  const kind = guessLabelKind(present);
  return { column: { name, kind, values: labels }, problems: [] };
}

/** The unit most cells carry, the first seen winning a tie; null when no cell carries one or none reads. */
function mostCommonUnit(numbers: readonly (Reading | null)[]): string | null {
  const counts = new Map<string | null, number>();
  for (const n of numbers) if (n !== null) counts.set(n.unit, (counts.get(n.unit) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [unit, count] of counts) {
    if (count > most) {
      best = unit;
      most = count;
    }
  }
  return best;
}

function guessLabelKind(present: readonly string[]): 'category' | 'text' {
  const levels = new Set(present).size;
  return levels <= MAX_LEVELS && levels < present.length ? 'category' : 'text';
}

function problemsOf(name: string, cells: readonly string[], values: readonly (number | null)[]): DataProblem[] {
  const out: DataProblem[] = [];
  values.forEach((v, r) => {
    if (v === null && !isMissingText(cells[r])) out.push({ column: name, row: r + 1, text: cells[r] });
  });
  return out;
}

/** The column read again as another kind, from the text of its present values. */
export function convertColumn(column: DataColumn, kind: ColumnKind, locale: Locale = EN_US): ColumnRead {
  const cells = column.values.map((v) => {
    if (v === null) return '';
    if (column.kind === 'date' && typeof v === 'number') return daysToIso(v);
    return String(v);
  });
  const convention = voteConvention(cells, locale);
  if (kind === 'category' || kind === 'text') {
    return {
      column: { name: column.name, kind, values: column.values.map((v, r) => (v === null ? null : cells[r])) },
      problems: [],
    };
  }
  if (kind === 'number') {
    const read = cells.map((cell) => (cell === '' ? null : (readNumber(cell, convention)?.value ?? null)));
    return {
      column: { name: column.name, kind, values: read, unit: null },
      problems: problemsOf(column.name, cells, read),
    };
  }
  const read = cells.map((cell) => (cell === '' ? null : parseDate(cell, locale.dateOrder)));
  return { column: { name: column.name, kind, values: read }, problems: problemsOf(column.name, cells, read) };
}
