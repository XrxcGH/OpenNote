// Reading what a person pastes into the kit (lists of numbers, groups on lines of their own, grids of counts or
// columns from a spreadsheet) and the few summaries every tool shares: means, variances, and ranks with ties.
import { check } from '../report';

/** The most values read from one field, so a huge paste cannot stall the window. */
export const MAX_VALUES = 100_000;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** A number written as text, with a typographic minus allowed. NaN when it is not one. */
export function toNumber(text: string): number {
  const clean = text.trim().replace(/^−/, '-');
  return NUMBER.test(clean) ? Number(clean) : NaN;
}

const pieces = (line: string): string[] => line.split(/[\s,;]+/).filter((piece) => piece !== '');

/** Every number in the text. Commas, spaces, tabs, semicolons, and new lines separate them. */
export function parseNumbers(text: string): number[] {
  const tokens = pieces(text);
  check(tokens.length <= MAX_VALUES, 'tooMany', { max: String(MAX_VALUES) });
  return tokens.map((token) => {
    const value = toNumber(token);
    check(Number.isFinite(value), 'notNumber', { text: token.slice(0, 24) });
    return value;
  });
}

export interface Group {
  readonly label: string;
  readonly values: readonly number[];
}

/**
 * Groups of numbers: one group to a line, or groups split by a vertical bar. A group may start with its name and a
 * colon, as in "Control: 4, 5, 6". Unnamed groups are numbered from 1.
 */
export function parseGroups(text: string): Group[] {
  const parts = text
    .split(/\r?\n|\|/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.map((part, i) => {
    const colon = part.indexOf(':');
    const label = colon > 0 ? part.slice(0, colon).trim() : String(i + 1);
    return { label, values: parseNumbers(colon > 0 ? part.slice(colon + 1) : part) };
  });
}

/** The cells of a pasted grid. Rows are lines; cells are split by tabs if there are any, by commas and
 * semicolons if not, and by spaces otherwise. */
export function parseGrid(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const splitter = /\t/.test(text) ? /\t/ : /[,;]/.test(text) ? /[,;]/ : /\s+/;
  return lines.map((line) =>
    line
      .trim()
      .split(splitter)
      .map((cell) => cell.trim()),
  );
}

export interface Counts {
  readonly rows: readonly string[];
  readonly cols: readonly string[];
  readonly counts: readonly (readonly number[])[];
}

/**
 * A grid of counts, with optional labels: a first row of column names and a first column of row names are used
 * when they are not numbers. Unnamed rows and columns are numbered from 1.
 */
export function parseCounts(text: string): Counts {
  let grid = parseGrid(text);
  check(grid.length > 0, 'empty');
  const header = grid[0].some((cell, i) => i > 0 && !Number.isFinite(toNumber(cell)));
  let cols: string[] | null = null;
  if (header) {
    cols = grid[0];
    grid = grid.slice(1);
  }
  const labelled = grid.length > 0 && grid.every((row) => !Number.isFinite(toNumber(row[0])));
  const rows = grid.map((row, i) => (labelled ? row[0] : String(i + 1)));
  const counts = grid.map((row) => (labelled ? row.slice(1) : row).map(readCount));
  check(counts.length > 0 && counts[0].length > 0, 'empty');
  check(
    counts.every((row) => row.length === counts[0].length),
    'ragged',
  );
  const width = counts[0].length;
  const names = cols ? cols.slice(cols.length - width) : [];
  return { rows, cols: names.length === width ? names : counts[0].map((_, j) => String(j + 1)), counts };
}

function readCount(cell: string): number {
  const value = toNumber(cell);
  check(Number.isFinite(value), 'notNumber', { text: cell.slice(0, 24) });
  check(value >= 0, 'negativeCount', { text: cell.slice(0, 24) });
  return value;
}

export interface Columns {
  readonly names: readonly string[];
  readonly cells: readonly (readonly string[])[];
}

/** Columns of a pasted table: the first row names them when any of its cells is not a number. */
export function parseColumns(text: string): Columns {
  const grid = parseGrid(text);
  check(grid.length > 0, 'empty');
  const width = Math.max(...grid.map((row) => row.length));
  const named = grid[0].some((cell) => !Number.isFinite(toNumber(cell)));
  const body = named ? grid.slice(1) : grid;
  const names = Array.from({ length: width }, (_, j) => (named ? (grid[0][j] ?? '') : '') || String(j + 1));
  const cells = names.map((_, j) => body.map((row) => row[j] ?? ''));
  return { names, cells };
}

/** A column read as numbers. */
export function numericColumn(cells: readonly string[]): number[] {
  return cells.map((cell) => {
    const value = toNumber(cell);
    check(Number.isFinite(value), 'notNumber', { text: cell.slice(0, 24) });
    return value;
  });
}

export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
export const mean = (values: readonly number[]): number => sum(values) / values.length;

/** The sum of squared deviations from the mean. */
export function sumSquares(values: readonly number[]): number {
  const m = mean(values);
  return values.reduce((total, value) => total + (value - m) ** 2, 0);
}

/** The sample variance (n - 1). */
export const variance = (values: readonly number[]): number => sumSquares(values) / (values.length - 1);
export const sd = (values: readonly number[]): number => Math.sqrt(variance(values));

export const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

/**
 * A quantile by linear interpolation between order statistics (type 7), the convention the table statistics and
 * the calculator already use, so quartiles agree across the app.
 */
export function quantile(sortedValues: readonly number[], p: number): number {
  const at = (sortedValues.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * (at - low);
}

/** Equal-width bins, their number by Sturges' rule. The last bin includes its upper edge. */
export function histogram(values: readonly number[]): { from: number; to: number; count: number }[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min - 0.5, to: max + 0.5, count: values.length }];
  const k = Math.min(60, Math.ceil(Math.log2(values.length)) + 1);
  const width = (max - min) / k;
  const bins = Array.from({ length: k }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const x of values) bins[Math.min(k - 1, Math.floor((x - min) / width))].count += 1;
  return bins;
}

export const median = (values: readonly number[]): number => quantile(sorted(values), 0.5);

export interface Ranked {
  /** Each value's rank, ties given the mean of the ranks they share. */
  readonly ranks: readonly number[];
  /** The size of each group of tied values, for tie corrections. */
  readonly ties: readonly number[];
}

/** Ranks from 1, with ties sharing their mean rank. */
export function rank(values: readonly number[]): Ranked {
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  const ties: number[] = [];
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end += 1;
    const shared = (start + end + 2) / 2;
    for (let k = start; k <= end; k += 1) ranks[order[k].i] = shared;
    if (end > start) ties.push(end - start + 1);
    start = end + 1;
  }
  return { ranks, ties };
}

/** Σ (t³ - t) over the tie groups. */
export const tieSum = (ties: readonly number[]): number => sum(ties.map((t) => t ** 3 - t));

/** A number typed in a field; a problem naming the field when it is not one. */
export function readField(text: string, name: string): number {
  const value = toNumber(text);
  check(Number.isFinite(value), 'fieldNumber', { name });
  return value;
}

/** A significance level or a probability strictly between 0 and 1. */
export function readProbability(text: string, name: string): number {
  const value = readField(text, name);
  check(value > 0 && value < 1, 'probabilityRange', { name });
  return value;
}
