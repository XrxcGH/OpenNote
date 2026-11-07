// The typed table model: columns with types, and cells that keep both what was typed (raw) and what it means (value).
// Tables are immutable values. Every edit in edit.ts returns a new table and shares the rows it didn't change.

import { parseDate } from './dates';
import { parseLocaleNumber, type Locale } from './locale';
import { round15, type Value } from './values';
import { columnFromLetters, lettersFromColumn } from '../../../core/expr';
import { convertUnit, splitQuantity } from '../../../core/units';

export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date' | 'checkbox' | 'choice';
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
  /** The names of a choice column's options, in the order the person set. */
  options?: readonly string[];
  /** A choice column that lets a cell hold several of its options. */
  multi?: boolean;
  /**
   * The unit of a number column's values, such as "kN" (Engineering tools). A cell typed in another unit of the same
   * kind, such as "250 N", is converted to it, so totals and formulas add like with like.
   */
  unit?: string;
  /** How a number column writes its values: in engineering notation (12.5×10³), or with SI prefixes (12.5 kN). */
  notation?: 'engineering' | 'si';
}

export interface Cell {
  /** The text as typed or pasted. Empty for cells of a calculated column. */
  raw: string;
  /** The typed value. For a formula, the last result. */
  value: Value;
  /** The formula in stored form when this single cell was entered as "=...". */
  formula?: string;
  /** Set when the value comes from a formula in another cell that spills over this one (ADR 0059). */
  spill?: true;
  /**
   * A legacy array formula entered over a block, as older workbooks store it: the formula's result fills this many
   * rows and columns from this cell, with #N/A where the result is smaller.
   */
  array?: { readonly rows: number; readonly cols: number };
}

export interface Row {
  id: string;
  cells: readonly Cell[];
}

export interface Table {
  columns: readonly Column[];
  rows: readonly Row[];
  /**
   * The table's data.sheet.v. A table that has it computes with Excel's rules (ADR 0058); one without it was written
   * before them, and its formulas keep their old meaning (formula/legacy.ts).
   */
  sheetVersion?: number;
  /** The table's name for references from other tables, such as Sales[Amount]. Unset means Table1, Table2, ... */
  name?: string;
  /** Defined names (ADR 0062): table scope unless `scope` is 'page'. */
  names?: readonly TableName[];
  /** 'manual' recalculates only on request (F9), as Excel's manual calculation does. Default 'auto'. */
  calc?: 'auto' | 'manual';
  /** Iterative calculation for circular formulas. Unset means off: a cycle shows Circular. */
  iterate?: IterateSettings;
}

/** A defined name: a formula text (a range, a constant, a formula, or a function made by LAMBDA) and its scope. */
export interface TableName {
  readonly name: string;
  /** The formula in stored form, without "=". */
  readonly ref: string;
  /** 'table' (the default) is visible in its own table; 'page' in every table of the page. */
  readonly scope?: 'table' | 'page';
}

/** How circular formulas iterate: at most `max` passes, until no value changes by more than `change`. */
export interface IterateSettings {
  readonly max: number;
  readonly change: number;
}

/** Excel's defaults for iterative calculation. */
export const ITERATE_DEFAULTS: IterateSettings = Object.freeze({ max: 100, change: 0.001 });

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
    case 'choice':
      return raw;
    case 'number':
      if (column.unit) return parseQuantityIn(column.unit, raw, text, locale);
    // falls through
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

/** A number in a column with a unit: "250 N" in a kN column is 0.25, and "3" is 3 kN. Other text stays as text. */
function parseQuantityIn(unit: string, raw: string, text: string, locale: Locale): Value {
  const parts = splitQuantity(text);
  const parsed = parseLocaleNumber(parts.number, locale);
  if (!parsed || parsed.percent) return raw;
  if (parts.unit === '') return parsed.value;
  return convertUnit(parsed.value, parts.unit, unit) ?? raw;
}

/** True when a typed column holds text that isn't of its type. Calculated columns never mismatch. */
export function isMismatch(column: Column, cell: Cell): boolean {
  return column.type !== 'text' && column.type !== 'choice' && !column.formula && typeof cell.value === 'string';
}
