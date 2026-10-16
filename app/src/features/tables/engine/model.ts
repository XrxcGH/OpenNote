// The typed table model: columns with types, and cells that keep both what was typed (raw) and what it means (value).
// Tables are immutable values. Every edit in edit.ts returns a new table and shares the rows it didn't change.

import { parseDate } from './dates';
import { parseLocaleNumber, type Locale } from './locale';
import { round15, type Value } from './values';
import { columnFromLetters, lettersFromColumn } from '../../../core/expr';

export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date' | 'checkbox';
export type TotalKind = 'sum' | 'average' | 'count' | 'min' | 'max' | 'checked';

export interface Column {
  id: string;
  /** The name used in `[Name]` references. Names are matched without regard to case. */
  name: string;
  type: ColumnType;
  /** Digits after the decimal mark when shown. Unset means as many as the value needs. */
  decimals?: number;
  /** An ISO 4217 code for currency columns. Unset means the region's currency. */
  currency?: string;
  /** A calculated column runs this formula, in stored form, on every row. */
  formula?: string;
  total?: TotalKind;
}

export interface Cell {
  /** The text as typed or pasted. Empty for cells of a calculated column. */
  raw: string;
  /** The typed value. For a formula, the last result. */
  value: Value;
  /** The formula in stored form when this single cell was entered as "=...". */
  formula?: string;
}

export interface Row {
  id: string;
  cells: readonly Cell[];
}

export interface Table {
  columns: readonly Column[];
  rows: readonly Row[];
}

export const EMPTY_CELL: Cell = Object.freeze({ raw: '', value: null });

/** The spreadsheet letter of a column index: 0 is A, 25 is Z, and 26 is AA. The shared engine owns the rule. */
export const columnLetter = lettersFromColumn;

/** The column index of a spreadsheet letter, or -1 when the text isn't letters. */
export const letterToColumn = columnFromLetters;

const CHECKED = new Set(['true', 'yes', '[x]', '\\[x\\]', '✓', '✔']);
const UNCHECKED = new Set(['false', 'no', '[ ]', '\\[ \\]', '[]']);

/** Reads a checkbox word such as "Yes", "[x]", or a check mark. Returns undefined for anything else. */
export function parseCheckbox(text: string): boolean | undefined {
  const word = text.trim().toLowerCase();
  if (CHECKED.has(word)) return true;
  return UNCHECKED.has(word) ? false : undefined;
}

/**
 * Reads typed text by the column's type, in the person's regional format. Text that doesn't fit the type stays as
 * text, which the app flags and never guesses at. A percent column reads "25" and "25%" as 0.25.
 */
export function parseInput(column: Column, raw: string, locale: Locale): Value {
  const text = raw.trim();
  if (text === '') return null;
  switch (column.type) {
    case 'text':
      return raw;
    case 'number':
    case 'currency':
    case 'percent': {
      const parsed = parseLocaleNumber(text, locale);
      if (!parsed) return raw;
      return parsed.percent || column.type === 'percent' ? round15(parsed.value / 100) : parsed.value;
    }
    case 'date':
      return parseDate(text, locale.dateOrder) ?? raw;
    case 'checkbox':
      return parseCheckbox(text) ?? raw;
  }
}

/** True when a typed column holds text that isn't of its type. Calculated columns never mismatch. */
export function isMismatch(column: Column, cell: Cell): boolean {
  return column.type !== 'text' && !column.formula && typeof cell.value === 'string';
}
