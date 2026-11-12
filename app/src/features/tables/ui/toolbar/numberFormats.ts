// The number format menu and the decimal and thousands buttons (DESIGN 10.1). Pure functions over format codes:
// a code is a string of the number format language (DESIGN 5), so the buttons edit it as text. Only the first
// section decides the direction of a change, and the change is made in every section that shows digits, since the
// rest are the negative and zero cases of the same format. A text section has no digit placeholders and stays.
import type { MessageKey } from '../../../../strings/t';
import type { Locale } from '../../engine/locale';
import { regionDateCode } from '../../engine/numfmt';

export interface FormatChoice {
  id: string;
  label: MessageKey;
  /** The code the choice writes, or null for General (the table's default format shows through). */
  code(locale: Locale): string | null;
}

/** The currency sign of a region, by the platform's own table. */
export function currencySign(locale: Locale): string {
  try {
    const parts = new Intl.NumberFormat(locale.tag, {
      style: 'currency',
      currency: locale.currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1);
    return parts.find((part) => part.type === 'currency')?.value ?? '$';
  } catch {
    return '$';
  }
}

const quoted = (sign: string) => `"${sign.replaceAll('"', '')}"`;

/** Currency: the sign, thousands separators, two decimals, and negatives in parentheses (ECMA-376 ID 7 form). */
export const currencyCode = (locale: Locale): string => {
  const sign = quoted(currencySign(locale));
  return `${sign}#,##0.00_);(${sign}#,##0.00)`;
};

/** Accounting: the sign at the cell's left edge and the number at its right (ECMA-376 ID 44 form). */
export const accountingCode = (locale: Locale): string => {
  const sign = quoted(currencySign(locale));
  return `_(${sign}* #,##0.00_);_(${sign}* \\(#,##0.00\\);_(${sign}* "-"??_);_(@_)`;
};

export const FORMAT_CHOICES: readonly FormatChoice[] = [
  { id: 'general', label: 'sheetToolbar.fmtGeneral', code: () => null },
  { id: 'number', label: 'sheetToolbar.fmtNumber', code: () => '0.00' },
  { id: 'currency', label: 'sheetToolbar.fmtCurrency', code: currencyCode },
  { id: 'accounting', label: 'sheetToolbar.fmtAccounting', code: accountingCode },
  { id: 'shortDate', label: 'sheetToolbar.fmtShortDate', code: (locale) => regionDateCode(locale, 'short') },
  { id: 'longDate', label: 'sheetToolbar.fmtLongDate', code: (locale) => regionDateCode(locale, 'long') },
  { id: 'time', label: 'sheetToolbar.fmtTime', code: (locale) => regionDateCode(locale, 'time') },
  { id: 'percent', label: 'sheetToolbar.fmtPercent', code: () => '0.00%' },
  { id: 'fraction', label: 'sheetToolbar.fmtFraction', code: () => '# ?/?' },
  { id: 'scientific', label: 'sheetToolbar.fmtScientific', code: () => '0.00E+00' },
  { id: 'text', label: 'sheetToolbar.fmtText', code: () => '@' },
];

/** The menu choice a code is (General for none), or null for a custom code. The Percent button's `0%` is Percent. */
export function choiceOf(code: string | undefined, locale: Locale): string | null {
  if (isGeneral(code)) return 'general';
  if (code === '0%') return 'percent';
  return FORMAT_CHOICES.find((choice) => choice.code(locale) === code)?.id ?? null;
}

/** The positions of characters of a code that are outside quotes, escapes, and brackets, with the first section's end. */
function scan(code: string): { open: boolean[]; end: number } {
  const open = new Array<boolean>(code.length).fill(false);
  let quote = false;
  let bracket = false;
  let end = code.length;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (!quote && (c === '\\' || c === '_' || c === '*')) i++;
    else if (c === '"') quote = !quote;
    else if (!quote && c === '[') bracket = true;
    else if (!quote && c === ']') bracket = false;
    else if (!quote && !bracket) {
      if (c === ';') {
        end = i;
        break;
      }
      open[i] = true;
    }
  }
  return { open, end };
}

const isDigit = (c: string | undefined) => c !== undefined && /[0#?]/.test(c);
const isGeneral = (code: string | undefined) => code === undefined || code === '' || /^general$/i.test(code);

/** Excel and Sheets allow at most 30 decimal places. */
const MAX_DECIMALS = 30;

/**
 * More or fewer digits after the decimal point in the first section. General gains one decimal as `0.0`. A format with
 * none gains `.0` after its last digit. Fewer takes the last digit off, and the point with it at none.
 */
function stepSection(text: string, direction: 1 | -1): string {
  const { open, end } = scan(text);
  // The mantissa of a scientific format ends at its E; digits after the E are the exponent.
  let limit = end;
  for (let i = 0; i < end; i++) {
    if (open[i] && /[eE]/.test(text[i]) && /[+-]/.test(text[i + 1] ?? '')) {
      limit = i;
      break;
    }
  }
  let dot = -1;
  for (let i = 0; i < limit; i++) {
    if (open[i] && text[i] === '.') {
      dot = i;
      break;
    }
  }
  if (dot === -1) {
    if (direction === -1) return text;
    let last = -1;
    for (let i = 0; i < limit; i++) if (open[i] && isDigit(text[i])) last = i;
    return last === -1 ? text : `${text.slice(0, last + 1)}.0${text.slice(last + 1)}`;
  }
  let stop = dot + 1;
  while (stop < limit && open[stop] && isDigit(text[stop])) stop++;
  const digits = stop - dot - 1;
  if (direction === 1) return digits >= MAX_DECIMALS ? text : `${text.slice(0, stop)}0${text.slice(stop)}`;
  return digits <= 1 ? `${text.slice(0, dot)}${text.slice(stop)}` : `${text.slice(0, stop - 1)}${text.slice(stop)}`;
}

/** The sections of a code: the text between semicolons that are outside quotes, escapes, and brackets. */
function sections(code: string): string[] {
  const parts: string[] = [];
  let from = 0;
  let quote = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (!quote && (c === '\\' || c === '_' || c === '*')) i++;
    else if (c === '"') quote = !quote;
    else if (!quote && c === '[') bracket = true;
    else if (!quote && c === ']') bracket = false;
    else if (!quote && !bracket && c === ';') {
      parts.push(code.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(code.slice(from));
  return parts;
}

/** Whether a section shows digits with 0 or # placeholders (a text section or a dash section does not). */
function showsDigits(section: string): boolean {
  const { open, end } = scan(section);
  for (let i = 0; i < end; i++) if (open[i] && /[0#]/.test(section[i])) return true;
  return false;
}

/** The decimal places of a code, changed in every section that shows digits. */
export function stepDecimals(code: string | undefined, direction: 1 | -1): string | null {
  if (isGeneral(code)) return direction === 1 ? '0.0' : null;
  return sections(code as string)
    .map((part) => (showsDigits(part) ? stepSection(part, direction) : part))
    .join(';');
}

/** The position of a thousands comma in the first section: between two digit placeholders, outside quotes. */
function commaAt(text: string): number {
  const { open, end } = scan(text);
  for (let i = 1; i < end - 1; i++) {
    if (open[i] && text[i] === ',' && isDigit(text[i - 1]) && isDigit(text[i + 1])) return i;
  }
  return -1;
}

/** Whether the first section groups its integer digits. */
export function hasThousands(code: string | undefined): boolean {
  return !isGeneral(code) && commaAt(code as string) !== -1;
}

/** Turns the grouping on or off. General becomes `#,##0`; `0.00` becomes `#,##0.00`. */
function groupSection(text: string, on: boolean): string {
  const comma = commaAt(text);
  if (!on) return comma === -1 ? text : text.slice(0, comma) + text.slice(comma + 1);
  if (comma !== -1) return text;
  const { open, end } = scan(text);
  let from = -1;
  for (let i = 0; i < end; i++) {
    if (open[i] && isDigit(text[i])) {
      from = i;
      break;
    }
  }
  if (from === -1) return text;
  let to = from;
  while (to < end && open[to] && isDigit(text[to])) to++;
  const run = to - from;
  return run >= 4 ? `${text.slice(0, to - 3)},${text.slice(to - 3)}` : `${text.slice(0, from)}#,##0${text.slice(to)}`;
}

/** Turns the grouping on or off: the first section decides, and every section that shows digits follows. */
export function toggleThousands(code: string | undefined): string {
  if (isGeneral(code)) return '#,##0';
  const parts = sections(code as string);
  const on = commaAt(parts[0]) === -1;
  return parts.map((part) => (showsDigits(part) ? groupSection(part, on) : part)).join(';');
}
