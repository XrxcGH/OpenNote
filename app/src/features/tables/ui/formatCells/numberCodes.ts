// The Number tab's logic (DESIGN 10.3): the categories, the code each choice writes, the check of a custom code that
// says where it breaks, and the preview. Codes are in the invariant form (ADR 0057); a custom code is typed in the
// region's form and converted. Pure, so tests work it by hand against the code grammar of ECMA-376 18.8.31.
import type { MessageKey } from '../../../../strings/t';
import type { Locale } from '../../engine/locale';
import { compile, readTypedCode, regionDateCode, render } from '../../engine/numfmt';
import type { CompileError } from '../../engine/numfmt';
import { currencySign } from '../toolbar/numberFormats';

export const CATEGORIES = [
  'general',
  'number',
  'currency',
  'accounting',
  'date',
  'time',
  'percent',
  'fraction',
  'scientific',
  'text',
  'special',
  'custom',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Negative = 'minus' | 'red' | 'paren' | 'redParen';

export interface NumberOptions {
  decimals: number;
  thousands: boolean;
  negative: Negative;
  /** The currency or accounting symbol (a sign such as `$` or `EUR`), or '' for none. */
  symbol: string;
  /** The index of the chosen pattern in the category's list (date, time, fraction, special). */
  pattern: number;
}

export const DEFAULT_OPTIONS: NumberOptions = {
  decimals: 2,
  thousands: false,
  negative: 'minus',
  symbol: '',
  pattern: 0,
};

export const MAX_DECIMALS = 30;

const zeros = (n: number) => (n > 0 ? `.${'0'.repeat(n)}` : '');
const quote = (s: string) => `"${s.replaceAll('"', '')}"`;

/** The sections of a number code for a negative style. The second section is the one for negative numbers. */
function withNegative(pos: string, negative: Negative): string {
  switch (negative) {
    case 'minus':
      return pos;
    case 'red':
      return `${pos};[Red]-${pos}`;
    case 'paren':
      return `${pos}_);(${pos})`;
    case 'redParen':
      return `${pos}_);[Red](${pos})`;
  }
}

/** The date patterns of the Date category: the region's short and long dates, then fixed patterns. */
export function datePatterns(locale: Locale): readonly string[] {
  return [
    regionDateCode(locale, 'short'),
    regionDateCode(locale, 'long'),
    'yyyy-mm-dd',
    'd-mmm-yy',
    'mmm d',
    'mmmm d, yyyy',
    'dddd, mmmm d, yyyy',
    'mmm-yy',
    'm/d/yy',
  ];
}

export const TIME_PATTERNS: readonly string[] = [
  'h:mm AM/PM',
  'h:mm:ss AM/PM',
  'h:mm',
  'h:mm:ss',
  '[h]:mm:ss',
  'm/d/yyyy h:mm',
  'mm:ss.0',
];

/** Up to one, two, and three digits, then halves, quarters, eighths, sixteenths, tenths, and hundredths. */
export const FRACTION_PATTERNS: readonly string[] = [
  '# ?/?',
  '# ??/??',
  '# ???/???',
  '# ?/2',
  '# ?/4',
  '# ?/8',
  '# ??/16',
  '# ?/10',
  '# ??/100',
];

/** Special formats: zip code, zip code and four digits, phone number, and an identification number. */
export const SPECIAL_PATTERNS: readonly string[] = [
  '00000',
  '00000-0000',
  '[<=9999999]###-####;(###) ###-####',
  '000-00-0000',
];

export const SPECIAL_LABELS: readonly MessageKey[] = [
  'sheetFormat.number.special.zip',
  'sheetFormat.number.special.zip4',
  'sheetFormat.number.special.phone',
  'sheetFormat.number.special.id',
];

const at = <T>(list: readonly T[], i: number): T => list[Math.min(Math.max(0, Math.trunc(i)), list.length - 1)];

/** The code a category and its options write, or null for General (the table's own format shows through). */
export function codeFor(category: Category, options: NumberOptions, locale: Locale): string | null {
  const d = Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(options.decimals)));
  const digits = `${options.thousands ? '#,##0' : '0'}${zeros(d)}`;
  switch (category) {
    case 'general':
    case 'custom':
      return null;
    case 'number':
      return withNegative(digits, options.negative);
    case 'currency':
      return withNegative(`${options.symbol === '' ? '' : quote(options.symbol)}#,##0${zeros(d)}`, options.negative);
    case 'accounting': {
      const sign = options.symbol === '' ? '' : quote(options.symbol);
      const body = `#,##0${zeros(d)}`;
      const dash = d > 0 ? `"-"${'?'.repeat(d)}` : '"-"';
      return `_(${sign}* ${body}_);_(${sign}* \\(${body}\\);_(${sign}* ${dash}_);_(@_)`;
    }
    case 'date':
      return at(datePatterns(locale), options.pattern);
    case 'time':
      return at(TIME_PATTERNS, options.pattern);
    case 'percent':
      return `0${zeros(d)}%`;
    case 'fraction':
      return at(FRACTION_PATTERNS, options.pattern);
    case 'scientific':
      return `0${zeros(d)}E+00`;
    case 'text':
      return '@';
    case 'special':
      return at(SPECIAL_PATTERNS, options.pattern);
  }
}

/** The symbol the region uses for currency. */
export const regionSymbol = (locale: Locale): string => currencySign(locale);

/**
 * The category a code belongs to and the options that rebuild it, as far as the code is one of the forms the dialog
 * writes. Any other code is Custom, and keeps its text.
 */
export function categoryOf(code: string | undefined, locale: Locale): { category: Category; options: NumberOptions } {
  const base = { ...DEFAULT_OPTIONS };
  if (code === undefined || code === '' || /^general$/i.test(code)) return { category: 'general', options: base };
  if (code === '@') return { category: 'text', options: base };
  const pick = (list: readonly string[], category: Category) => {
    const pattern = list.indexOf(code);
    return pattern < 0 ? null : { category, options: { ...base, pattern } };
  };
  const fixed =
    pick(datePatterns(locale), 'date') ??
    pick(TIME_PATTERNS, 'time') ??
    pick(FRACTION_PATTERNS, 'fraction') ??
    pick(SPECIAL_PATTERNS, 'special');
  if (fixed) return fixed;
  const first = code.split(';')[0];
  const decimals = /\.(0+)/.exec(first.replace(/\[[^\]]*\]|"[^"]*"/g, ''))?.[1].length ?? 0;
  const thousands = first.includes('#,##0');
  const symbol = /"([^"]*)"/.exec(first)?.[1] ?? '';
  if (/^0(\.0+)?%$/.test(code)) return { category: 'percent', options: { ...base, decimals } };
  if (/^0(\.0+)?E\+00$/.test(code)) return { category: 'scientific', options: { ...base, decimals } };
  for (const category of ['number', 'currency', 'accounting'] as const) {
    for (const negative of ['minus', 'red', 'paren', 'redParen'] as const) {
      const options = { ...base, decimals, thousands, symbol, negative };
      if (codeFor(category, options, locale) === code) return { category, options };
    }
  }
  return { category: 'custom', options: base };
}

export interface CodeCheck {
  ok: boolean;
  /** The invariant code, when ok. */
  code?: string;
  error?: CompileError;
  /** Where the problem is in the typed text, counted from 0, when a position is known. */
  at?: number;
}

/** Where a quote, a bracket, an escape, or a fifth section goes wrong in a typed code. */
function whereBroken(typed: string, error: CompileError): number | undefined {
  let quoteAt = -1;
  let bracketAt = -1;
  let semicolons = 0;
  for (let i = 0; i < typed.length; i++) {
    const c = typed[i];
    if (quoteAt >= 0) {
      if (c === '"') quoteAt = -1;
      continue;
    }
    if (bracketAt >= 0) {
      if (c === ']') bracketAt = -1;
      continue;
    }
    if (c === '\\' || c === '_' || c === '*') {
      if (i === typed.length - 1 && error === 'escape') return i;
      i++;
    } else if (c === '"') quoteAt = i;
    else if (c === '[') bracketAt = i;
    else if (c === ';' && ++semicolons === 4) {
      if (error === 'sections') return i;
    }
  }
  if (error === 'quote' && quoteAt >= 0) return quoteAt;
  if (error === 'bracket' && bracketAt >= 0) return bracketAt;
  return undefined;
}

/** Checks a code typed in the region's form. A bad code says what is wrong and, where it can, the position. */
export function checkCode(typed: string, locale: Locale): CodeCheck {
  const read = readTypedCode(typed, locale);
  if (read.ok) return { ok: true, code: read.code };
  return { ok: false, error: read.error, at: whereBroken(typed, read.error) };
}

/** What a code shows for a sample value, or null when the code does not compile (so the preview keeps the last text). */
export function previewCode(code: string, sample: number | string, locale: Locale): string | null {
  const result = compile(code === '' ? 'General' : code);
  return result.ok ? render(sample, code === '' ? 'General' : code, locale).text : null;
}

/** The sample the preview shows: the cell's number when it holds one, or 1234.5678. */
export function sampleOf(text: string | undefined): number {
  const n = text === undefined || text.trim() === '' ? NaN : Number(text.trim());
  return Number.isFinite(n) ? n : 1234.5678;
}
