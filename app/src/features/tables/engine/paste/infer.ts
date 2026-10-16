// Builds a typed table from pasted cells. A column gets a type when at least 90% of its filled cells fit it.
// The decimal vote reads a column twice, with the region's convention and with the other one. The convention that
// reads more cells wins, so "1234.56" on a German system is still a number. Pasting never creates formulas.

import { excelSerialToDays, parseDate } from '../dates';
import { otherConvention, parseNumeric, type DateOrder, type Locale, type NumericParse } from '../locale';
import { columnLetter, parseCheckbox, type Column, type ColumnType, type Row, type Table } from '../model';
import { round15, type Value } from '../values';
import type { HtmlGrid, PasteCell, PasteSource } from './html';

export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 100;
const TYPED_SHARE = 0.9;
const BLANK: PasteCell = Object.freeze({ text: '' });
const ORDERS: readonly DateOrder[] = ['mdy', 'dmy', 'ymd'];

export interface PasteResult {
  table: Table;
  /** True when the first pasted row became the column names. */
  header: boolean;
  source: PasteSource;
  /** Rows and columns beyond the limits, which are left out. */
  droppedRows: number;
  droppedColumns: number;
  /** True when the source had formulas. Only their values are kept. */
  formulasDropped: boolean;
}

interface Convention {
  decimal: string;
  group: string;
}

interface Guess extends Convention {
  type: ColumnType;
  decimals?: number;
  currency?: string;
  order: DateOrder;
}

const isEmpty = (cell: PasteCell): boolean =>
  cell.num === undefined && cell.bool === undefined && cell.text.trim() === '';

function looksLikeDate(text: string): boolean {
  return /[-/.\s]/.test(text.trim()) && ORDERS.some((order) => parseDate(text, order) !== null);
}

/** The cell's format hint. A cell with a number but no hint whose text reads as a date is a date serial. */
function hintOf(cell: PasteCell): PasteCell['hint'] {
  if (cell.hint || cell.num === undefined) return cell.hint;
  return looksLikeDate(cell.text) ? 'date' : undefined;
}

function readNumber(cell: PasteCell, conv: Convention): NumericParse | null {
  const parsed = parseNumeric(cell.text, conv.decimal, conv.group);
  const hint = hintOf(cell);
  if (cell.num === undefined || hint === 'date') return parsed;
  return {
    value: cell.num,
    percent: hint === 'percent' || (parsed?.percent ?? false),
    currency: hint === 'currency' ? (parsed?.currency ?? '') : (parsed?.currency ?? null),
    decimals: parsed?.decimals ?? 0,
  };
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function guessNumeric(filled: PasteCell[], locale: Locale, need: number): Partial<Guess> | null {
  let best: { conv: Convention; reads: NumericParse[] } | null = null;
  for (const conv of [locale, otherConvention(locale)]) {
    const reads = filled.map((cell) => readNumber(cell, conv)).filter((r): r is NumericParse => r !== null);
    if (reads.length > (best?.reads.length ?? -1)) best = { conv, reads };
  }
  if (!best || best.reads.length < need) return null;
  const { conv, reads } = best;
  const share = Math.ceil(reads.length * TYPED_SHARE);
  const currencies = reads.filter((r) => r.currency !== null);
  const type: ColumnType =
    reads.filter((r) => r.percent).length >= share ? 'percent' : currencies.length >= share ? 'currency' : 'number';
  const decimals = Math.min(4, mode(reads.map((r) => r.decimals)));
  const code = currencies.find((r) => r.currency)?.currency ?? locale.currency;
  return {
    type,
    decimal: conv.decimal,
    group: conv.group,
    decimals,
    ...(type === 'currency' ? { currency: code } : {}),
  };
}

function isDateCell(cell: PasteCell, order: DateOrder): boolean {
  if (cell.num !== undefined && hintOf(cell) === 'date') return true;
  return parseDate(cell.text, order) !== null;
}

function guessDate(filled: PasteCell[], locale: Locale, need: number): DateOrder | null {
  let best: { order: DateOrder; count: number } | null = null;
  for (const order of [locale.dateOrder, ...ORDERS.filter((o) => o !== locale.dateOrder)]) {
    const count = filled.filter((cell) => isDateCell(cell, order)).length;
    if (count > (best?.count ?? -1)) best = { order, count };
  }
  return best && best.count >= need ? best.order : null;
}

function guessColumn(cells: PasteCell[], locale: Locale): Guess {
  const base: Guess = { type: 'text', decimal: locale.decimal, group: locale.group, order: locale.dateOrder };
  const filled = cells.filter((cell) => !isEmpty(cell));
  if (filled.length === 0) return base;
  const need = Math.ceil(filled.length * TYPED_SHARE);
  if (filled.filter((c) => c.bool !== undefined || parseCheckbox(c.text) !== undefined).length >= need) {
    return { ...base, type: 'checkbox' };
  }
  const numeric = guessNumeric(filled, locale, need);
  if (numeric) return { ...base, ...numeric };
  const order = guessDate(filled, locale, need);
  return order ? { ...base, type: 'date', order } : base;
}

function cellValue(cell: PasteCell, guess: Guess): Value {
  if (isEmpty(cell)) return null;
  switch (guess.type) {
    case 'checkbox':
      return cell.bool ?? parseCheckbox(cell.text) ?? cell.text;
    case 'number':
    case 'currency':
    case 'percent': {
      const read = readNumber(cell, guess);
      if (!read) return cell.text;
      return cell.num === undefined && read.percent ? round15(read.value / 100) : read.value;
    }
    case 'date':
      if (cell.num !== undefined && hintOf(cell) === 'date') return excelSerialToDays(cell.num);
      return parseDate(cell.text, guess.order) ?? cell.text;
    default:
      return cell.text;
  }
}

/** The first row is a header when the source marks it, or when it is unique text above typed data. */
function detectHeader(rows: PasteCell[][], locale: Locale): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  if (first.every((cell) => cell.header)) return true;
  const names = first.map((cell) => cell.text.trim().toLowerCase());
  if (names.some((n) => n === '') || new Set(names).size !== names.length) return false;
  const body = rows.slice(1);
  return first.some((cell, c) => {
    const guess = guessColumn(
      body.map((row) => row[c]),
      locale,
    );
    return guess.type !== 'text' && typeof cellValue(cell, guess) === 'string';
  });
}

function uniqueName(wanted: string, index: number, used: Set<string>): string {
  const base = wanted.trim() === '' ? columnLetter(index) : wanted.trim();
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

function makeColumns(guesses: Guess[], first: PasteCell[] | null): Column[] {
  const used = new Set<string>();
  return guesses.map((guess, c) => {
    const column: Column = { id: `c${c}`, name: uniqueName(first?.[c].text ?? '', c, used), type: guess.type };
    if (guess.decimals) column.decimals = guess.decimals;
    if (guess.currency) column.currency = guess.currency;
    return column;
  });
}

/** Builds a typed table from pasted cells. Never creates formulas, so pasted text that starts with "=" stays text. */
export function buildPastedTable(grid: HtmlGrid, locale: Locale): PasteResult {
  const widest = grid.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const width = Math.min(widest, MAX_COLUMNS);
  const rows = grid.rows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? BLANK));
  const header = detectHeader(rows, locale);
  const all = header ? rows.slice(1) : rows;
  const body = all.slice(0, MAX_ROWS);
  const guesses = Array.from({ length: width }, (_, c) =>
    guessColumn(
      body.map((row) => row[c]),
      locale,
    ),
  );
  const tableRows: Row[] = body.map((row, r) => ({
    id: `r${r}`,
    cells: row.map((cell, c) =>
      isEmpty(cell) ? { raw: '', value: null } : { raw: cell.text, value: cellValue(cell, guesses[c]) },
    ),
  }));
  return {
    table: { columns: makeColumns(guesses, header ? rows[0] : null), rows: tableRows },
    header,
    source: grid.source,
    droppedRows: all.length - body.length,
    droppedColumns: widest - width,
    formulasDropped: grid.rows.some((row) => row.some((cell) => cell.formula)),
  };
}
