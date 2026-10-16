// Display text for values, in the person's regional format. Formats are cached because grids call this per cell.

import type { Column } from './model';
import type { Locale } from './locale';
import { ERROR_WORDS, isError, numberToText, type Value } from './values';

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale.tag}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale.tag, options);
    numberFormats.set(key, format);
  }
  return format;
}

function dateFormat(locale: Locale, withTime: boolean): Intl.DateTimeFormat {
  const key = `${locale.tag}|${withTime}`;
  let format = dateFormats.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = withTime
      ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }
      : { dateStyle: 'medium', timeZone: 'UTC' };
    format = new Intl.DateTimeFormat(locale.tag, options);
    dateFormats.set(key, format);
  }
  return format;
}

function fixed(column: Column): Intl.NumberFormatOptions {
  return column.decimals === undefined
    ? { maximumFractionDigits: 10 }
    : { minimumFractionDigits: column.decimals, maximumFractionDigits: column.decimals };
}

function formatNumber(value: number, column: Column, locale: Locale): string {
  switch (column.type) {
    case 'currency':
      return numberFormat(locale, {
        style: 'currency',
        currency: column.currency ?? locale.currency,
        ...digits(column),
      }).format(value);
    case 'percent':
      return numberFormat(locale, {
        style: 'percent',
        ...(column.decimals === undefined ? { maximumFractionDigits: 2 } : fixed(column)),
      }).format(value);
    case 'date':
      return dateFormat(locale, value !== Math.floor(value)).format(new Date(value * 86_400_000));
    default:
      return numberFormat(locale, fixed(column)).format(value);
  }
}

function digits(column: Column): Intl.NumberFormatOptions {
  return column.decimals === undefined ? {} : fixed(column);
}

/** The text a cell shows. Errors show plain words, never tokens. Text in a typed column shows as typed. */
export function formatValue(value: Value, column: Column, locale: Locale): string {
  if (value === null) return '';
  if (isError(value)) return ERROR_WORDS[value.error];
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean')
    return column.type === 'checkbox' ? (value ? '[x]' : '[ ]') : value ? 'TRUE' : 'FALSE';
  if (!Number.isFinite(value)) return numberToText(value);
  return formatNumber(value, column, locale);
}
