// Display text for values, in the person's regional format. A cell's number format code (ADR 0057) wins; without one,
// the column type maps to a code (columnCode). Compiled codes are cached because grids call this per cell.

import type { Column } from './model';
import type { Locale } from './locale';
import { fixedDigits, toDigits } from './numfmt/digits';
import { lcidHex, regionDateCode, render, type Rendered } from './numfmt';
import { ERROR_WORDS, isError, numberToText, toScalar, type Value } from './values';
import { engineeringText, prefixedText } from '../../../core/units';

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Intl throws for a malformed tag; such a tag formats as en-US. */
function intlTag(tag: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0 ? tag : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** A cached formatter. Throws a RangeError for options Intl refuses, such as a currency that is not an ISO code. */
function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale.tag}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlTag(locale.tag), options);
    numberFormats.set(key, format);
  }
  return format;
}

/** Excel allows 0 to 30 decimals. A note file may hold any number, so it is clamped here. */
const MAX_DECIMALS = 30;

function decimalsOf(column: Column): number | undefined {
  const d = column.decimals;
  if (typeof d !== 'number' || !Number.isFinite(d)) return undefined;
  return Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(d)));
}

function fixed(column: Column): Intl.NumberFormatOptions {
  const decimals = decimalsOf(column);
  return decimals === undefined
    ? { maximumFractionDigits: 10 }
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
}

function digits(column: Column): Intl.NumberFormatOptions {
  return decimalsOf(column) === undefined ? {} : fixed(column);
}

/** A literal in a code, quoted unless it is a plain space. */
function quoted(text: string): string {
  return text === ' ' ? ' ' : `"${text.replace(/"/g, '')}"`;
}

const currencyCodes = new Map<string, string>();
const NUMERIC_PARTS = new Set(['integer', 'group', 'decimal', 'fraction']);

/**
 * The code of a currency column, read from how the region writes the currency: `[$$-409]#,##0.00` in en-US, and
 * the digits, a no-break space, and `[$€-407]` for euros in de-DE. The language ID is the region's.
 */
function currencyCode(column: Column, locale: Locale): string {
  const currency = column.currency ?? locale.currency;
  const key = `${locale.tag}|${currency}|${decimalsOf(column) ?? ''}`;
  const known = currencyCodes.get(key);
  if (known !== undefined) return known;
  let format: Intl.NumberFormat;
  try {
    format = numberFormat(locale, { style: 'currency', currency, ...digits(column) });
  } catch {
    // Not an ISO 4217 code (a hostile or hand-edited note): the plain number, then the code as written.
    const plainCode = `#,##0${decimalsText(decimalsOf(column) ?? 2)}${currency ? ` ${quoted(currency)}` : ''}`;
    currencyCodes.set(key, plainCode);
    return plainCode;
  }
  const decimals = decimalsOf(column) ?? format.resolvedOptions().minimumFractionDigits ?? 2;
  const parts = format.formatToParts(1_234_567.5);
  const first = parts.findIndex((p) => NUMERIC_PARTS.has(p.type));
  let last = first;
  parts.forEach((p, i) => {
    if (NUMERIC_PARTS.has(p.type)) last = i;
  });
  const id = lcidHex(locale.tag);
  const piece = (p: Intl.NumberFormatPart): string => {
    if (p.type === 'currency') return id !== null && !/[\]"]/.test(p.value) ? `[$${p.value}-${id}]` : quoted(p.value);
    return p.type === 'literal' ? quoted(p.value) : '';
  };
  const grouped = parts.some((p) => p.type === 'group');
  const core = `${grouped ? '#,##0' : '0'}${decimalsText(decimals)}`;
  const code =
    parts.slice(0, first).map(piece).join('') +
    core +
    parts
      .slice(last + 1)
      .map(piece)
      .join('');
  currencyCodes.set(key, code);
  return code;
}

/** Digits after the point that a value needs, up to `max`, read from its 15-digit form. */
function neededDecimals(value: number, max: number): number {
  return fixedDigits(toDigits(value), max).frac.replace(/0+$/, '').length;
}

function decimalsText(n: number): string {
  return n > 0 ? `.${'0'.repeat(n)}` : '';
}

/**
 * The code a column type stands for when no style sets `fmt` (DESIGN.md section 5.3): number with 2 decimals is
 * `#,##0.00`, percent is `0%` or `0.00%`, currency is the region's currency code, and date is the region's medium
 * date. Without set decimals the value decides them, up to 10 for numbers and 2 for percents, as the column showed
 * before codes. Unit and notation columns, text, checkbox, and choice columns have no code (null).
 */
export function columnCode(column: Column, locale: Locale, value = 0): string | null {
  switch (column.type) {
    case 'currency':
      return currencyCode(column, locale);
    case 'percent':
      return `0${decimalsText(decimalsOf(column) ?? neededDecimals(value * 100, 2))}%`;
    case 'date':
      return regionDateCode(locale, value !== Math.floor(value) ? 'mediumDateTime' : 'medium');
    case 'number':
      if (column.unit || column.notation) return null;
      return `#,##0${decimalsText(decimalsOf(column) ?? neededDecimals(value, 10))}`;
    default:
      return null;
  }
}

/**
 * A number column with a unit or a notation: "12.5 kN", "12.5×10³ N", or "12,500 N". Without a unit, SI prefixes
 * write the number alone ("12.5k"), and the digits kept are the ones typed up to six, not four, so 12345 reads
 * 12.345×10³ and not 12.35×10³ (Beta 8 walk A1-A09-3).
 */
function withUnit(value: number, column: Column, locale: Locale): string {
  const unit = column.unit ?? '';
  const set = decimalsOf(column);
  const kept = set === undefined ? 6 : Math.max(1, set + 1);
  if (column.notation === 'si') {
    const prefixed = prefixedText(value, unit, kept);
    if (prefixed) return prefixed;
  }
  const number =
    column.notation === 'engineering'
      ? engineeringText(value, kept)
      : numberFormat(locale, fixed(column)).format(value);
  return unit ? `${number} ${unit}` : number;
}

export interface DisplayOptions {
  /** The cell's number format code (style `fmt`), which wins over the column type. Unit columns keep their units. */
  fmt?: string | null;
  /** The characters that fit in the cell, for the `#` overflow. */
  maxChars?: number;
}

function plain(text: string): Rendered {
  return { text, color: null, fill: null, overflow: false };
}

/** What a cell shows: text, a color token, a fill, and overflow. Errors show plain words, never tokens. */
export function renderValue(input: Value, column: Column, locale: Locale, options: DisplayOptions = {}): Rendered {
  const value = toScalar(input);
  if (value === null) return plain('');
  if (isError(value)) return plain(ERROR_WORDS[value.error]);
  const fmt = options.fmt || null;
  if (typeof value === 'string') return fmt ? render(value, fmt, locale, options) : plain(value);
  if (typeof value === 'boolean')
    return plain(column.type === 'checkbox' ? (value ? '[x]' : '[ ]') : value ? 'TRUE' : 'FALSE');
  if (!Number.isFinite(value)) return plain(numberToText(value));
  if (column.type === 'number' && (column.unit || column.notation)) return plain(withUnit(value, column, locale));
  const code = fmt ?? columnCode(column, locale, value);
  if (code === null) return plain(numberFormat(locale, fixed(column)).format(value));
  return render(value, code, locale, options);
}

/** The text a cell shows. Text in a typed column shows as typed unless the code has a text section. */
export function formatValue(input: Value, column: Column, locale: Locale, fmt?: string | null): string {
  return renderValue(input, column, locale, { fmt }).text;
}
