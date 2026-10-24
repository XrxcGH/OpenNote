// The design matrix of a model: one column for each numeric predictor, a column for each level but the first of a
// predictor of words (reference coding) or a column that sets the first level to −1 (effect coding), powers and
// logarithms, and products for interactions. Rows with a missing value in any column the model uses are left out,
// and the tools say how many.
import { completeRows, isNumericColumn, levelsOf, numbersAt, strayWord, wordsAt, type DataTable } from './data';
import type { Matrix } from './linalg';
import { fail } from './types';

export interface Factor {
  readonly name: string;
  /** A power of the variable (2 for x^2), or 1. */
  readonly power?: number;
  readonly log?: boolean;
}

/** A term is a product of factors: x, x:z, or x^2. */
export interface Term {
  readonly factors: readonly Factor[];
}

export interface DesignOptions {
  readonly coding?: 'reference' | 'effect';
  /** Subtract each numeric predictor's mean before powers and products. */
  readonly center?: boolean;
  readonly intercept?: boolean;
  /** Further columns that must have a value in a row for it to be used, such as a cluster or an offset. */
  readonly need?: readonly string[];
}

export interface Design {
  readonly x: Matrix;
  /** Column names as text, such as (Intercept), x1, group[B], x1:group[B]. */
  readonly columns: readonly string[];
  /** Each term's label and the design columns it makes. */
  readonly terms: readonly { readonly label: string; readonly columns: readonly number[] }[];
  /** The data rows used, in order. */
  readonly rows: readonly number[];
  /** The levels of each predictor of words; the first is the reference. */
  readonly levels: ReadonlyMap<string, readonly string[]>;
  /** The means subtracted from numeric predictors when centering. */
  readonly means: ReadonlyMap<string, number>;
}

export const INTERCEPT = '(Intercept)';

export const termLabel = (term: Term): string =>
  term.factors
    .map((f) => (f.log ? `log(${f.name})` : f.power && f.power !== 1 ? `${f.name}^${f.power}` : f.name))
    .join(':');

/** The columns one factor makes, with their names, at the rows used. */
function factorColumns(
  table: DataTable,
  factor: Factor,
  rows: readonly number[],
  options: DesignOptions,
  levels: Map<string, string[]>,
  means: Map<string, number>,
): { names: string[]; values: number[][] } {
  if (isNumericColumn(table, factor.name)) {
    let values = numbersAt(table, factor.name, rows);
    if (factor.log) {
      if (values.some((v) => v <= 0)) fail('logPositive', factor.name);
      values = values.map(Math.log);
    } else if (options.center) {
      const m = values.reduce((s, v) => s + v, 0) / values.length;
      means.set(factor.name, m);
      values = values.map((v) => v - m);
    }
    const power = factor.power ?? 1;
    if (power !== 1) values = values.map((v) => v ** power);
    return { names: [termLabel({ factors: [factor] })], values: [values] };
  }
  const stray = strayWord(table, factor.name);
  if (stray !== null) fail('notNumeric', `${factor.name}|${stray}`);
  if (factor.log || (factor.power ?? 1) !== 1) fail('wordsTransform', factor.name);
  const words = wordsAt(table, factor.name, rows);
  const found = levels.get(factor.name) ?? levelsOf(words);
  levels.set(factor.name, found);
  if (found.length < 2) fail('oneLevel', factor.name);
  const effect = options.coding === 'effect';
  const names = found.slice(1).map((level) => `${factor.name}[${level}]`);
  const values = found.slice(1).map((level) => words.map((w) => (w === level ? 1 : effect && w === found[0] ? -1 : 0)));
  return { names, values };
}

/** Builds the design matrix for these terms over the rows where every needed column has a value. */
export function buildDesign(table: DataTable, terms: readonly Term[], options: DesignOptions = {}): Design {
  const used = new Set<string>(options.need ?? []);
  for (const term of terms) for (const f of term.factors) used.add(f.name);
  const rows = completeRows(table, [...used]);
  if (rows.length === 0) fail('noCompleteRows');
  const levels = new Map<string, string[]>();
  const means = new Map<string, number>();
  const columns: string[] = [];
  const cols: number[][] = [];
  const termCols: { label: string; columns: number[] }[] = [];
  if (options.intercept !== false) {
    columns.push(INTERCEPT);
    cols.push(rows.map(() => 1));
  }
  for (const term of terms) {
    let names = [''];
    let values = [rows.map(() => 1)];
    for (const factor of term.factors) {
      const next = factorColumns(table, factor, rows, options, levels, means);
      names = names.flatMap((a) => next.names.map((b) => (a === '' ? b : `${a}:${b}`)));
      values = values.flatMap((a) => next.values.map((b) => a.map((v, i) => v * b[i])));
    }
    const label = termLabel(term);
    if (termCols.some((t) => t.label === label)) continue;
    termCols.push({ label, columns: names.map((_, k) => columns.length + k) });
    columns.push(...names);
    cols.push(...values);
  }
  const x = rows.map((_, i) => cols.map((col) => col[i]));
  return { x, columns, terms: termCols, rows, levels, means };
}

/** One term for each named predictor. */
export const mainTerms = (names: readonly string[]): Term[] => names.map((name) => ({ factors: [{ name }] }));

/** The design without some of its columns, for a test that drops a term. */
export function dropColumns(x: Matrix, drop: readonly number[]): Matrix {
  const gone = new Set(drop);
  return x.map((row) => row.filter((_, j) => !gone.has(j)));
}
