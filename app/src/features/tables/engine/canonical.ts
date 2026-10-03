// Canonical cell text: one locale-free form per column type, for storage, filters, and sync. The Markdown layer adds
// its own escapes (`\-3`, `\[x\]`, `\#DIV/0!`); reading accepts text with or without them.

import { daysToIso, parseIsoDate } from './dates';
import type { ColumnType } from './model';
import { ERROR_TOKENS, errorFromToken, isError, numberToText, parseCanonicalNumber, type Value } from './values';

/** The locale-free text of a value. */
export function toCanonical(type: ColumnType, value: Value): string {
  if (value === null) return '';
  if (isError(value)) return ERROR_TOKENS[value.error];
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return type === 'checkbox' ? (value ? '[x]' : '[ ]') : value ? 'TRUE' : 'FALSE';
  if (type === 'date') return daysToIso(value);
  return numberToText(value);
}

/** Reads canonical text. Text that isn't canonical for a typed column stays text, as the format requires. */
export function parseCanonical(type: ColumnType, text: string): Value {
  if (text === '') return null;
  const error = errorFromToken(text);
  if (error) return error;
  switch (type) {
    case 'text':
      return text;
    case 'number':
    case 'currency':
    case 'percent':
      return parseCanonicalNumber(text) ?? text;
    case 'date':
      return parseIsoDate(text) ?? text;
    case 'checkbox': {
      const word = text.trim().replace(/\\/g, '').toLowerCase();
      return word === '[x]' ? true : word === '[ ]' ? false : text;
    }
  }
}
