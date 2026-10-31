// Reads the multivariate tool's columns: several numeric ones, optionally standardized, and an optional column of
// row names (row numbers when there is none).
import { completeRows, numbersAt, parseTable, wordsAt } from '../kit/data';
import { columnList, type Values } from '../kit/spec';
import { fail } from '../kit/types';
import { covariance } from './engine';

export interface Read {
  readonly x: number[][];
  readonly names: string[];
  readonly labels: string[];
}

export function readColumns(values: Values, standardize: boolean): Read {
  const table = parseTable(String(values.data));
  const names = columnList(values.columns);
  const labelName = String(values.label);
  if (names.length < 2) fail('fewColumns');
  if (names.includes(labelName)) fail('sameColumn');
  const rows = completeRows(table, labelName ? [...names, labelName] : names);
  const cols = names.map((n) => numbersAt(table, n, rows));
  let x = rows.map((_, i) => cols.map((c) => c[i]));
  if (standardize && x.length > 1) {
    const { means, sds } = covariance(x, false);
    x = x.map((row) => row.map((v, j) => (v - means[j]) / sds[j]));
  }
  const labels = labelName ? wordsAt(table, labelName, rows) : rows.map((r) => String(r + 1));
  return { x, names, labels };
}

export const literal = (names: readonly string[]) => names.map((n) => `=${n}`);
