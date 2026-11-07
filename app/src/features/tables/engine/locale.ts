// Regional settings and number reading. The region comes from Rust (Phase 2) as a plain object, so this module
// stays pure. `Intl` formats with the regional tag, never the interface language.

export type DateOrder = 'mdy' | 'dmy' | 'ymd';

export interface Locale {
  /** A BCP 47 tag for `Intl`, such as "de-DE". */
  tag: string;
  decimal: '.' | ',';
  /** The digit group separator. Other spaces and no-break spaces are read as this one. */
  group: string;
  /** The separator between function arguments: a semicolon where the decimal mark is a comma. */
  list: ',' | ';';
  dateOrder: DateOrder;
  /** An ISO 4217 code. */
  currency: string;
}

export const EN_US: Locale = { tag: 'en-US', decimal: '.', group: ',', list: ',', dateOrder: 'mdy', currency: 'USD' };
export const DE_DE: Locale = { tag: 'de-DE', decimal: ',', group: '.', list: ';', dateOrder: 'dmy', currency: 'EUR' };
export const FR_FR: Locale = {
  tag: 'fr-FR',
  decimal: ',',
  group: '\u202f',
  list: ';',
  dateOrder: 'dmy',
  currency: 'EUR',
};

const groupCache = new Map<string, readonly number[]>();
const percentCache = new Map<string, string>();

/**
 * How the region groups integer digits: [3] for most regions, [3, 2] where the groups after the first are two digits,
 * such as en-IN's 12,34,567.
 */
export function groupSizes(locale: Locale): readonly number[] {
  let sizes = groupCache.get(locale.tag);
  if (!sizes) {
    sizes = [3];
    try {
      const parts = new Intl.NumberFormat(locale.tag, { useGrouping: true })
        .formatToParts(123_456_789)
        .filter((p) => p.type === 'integer');
      if (parts.length >= 3) sizes = [parts[parts.length - 1].value.length, parts[parts.length - 2].value.length];
    } catch {
      // An unknown tag keeps groups of three.
    }
    groupCache.set(locale.tag, sizes);
  }
  return sizes;
}

/** The space the region writes between a number and its percent sign: "" in en-US, a no-break space in de-DE. */
export function percentSpace(locale: Locale): string {
  let space = percentCache.get(locale.tag);
  if (space === undefined) {
    space = '';
    try {
      const parts = new Intl.NumberFormat(locale.tag, { style: 'percent' }).formatToParts(0.5);
      const sign = parts.findIndex((p) => p.type === 'percentSign');
      const before = parts[sign - 1];
      if (sign > 0 && before.type === 'literal' && /^\s+$/.test(before.value)) space = before.value;
    } catch {
      // An unknown tag writes no space.
    }
    percentCache.set(locale.tag, space);
  }
  return space;
}

/** The same region read with the other decimal convention, for the decimal vote. */
export function otherConvention(locale: Locale): Pick<Locale, 'decimal' | 'group'> {
  return locale.decimal === '.' ? { decimal: ',', group: '.' } : { decimal: '.', group: ',' };
}

export interface NumericParse {
  value: number;
  percent: boolean;
  /** An ISO code when a currency symbol or code was present. */
  currency: string | null;
  /** Digits after the decimal mark. */
  decimals: number;
}

const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const SPACES = '\\s\\u00a0\\u202f\\u2009';
const CODES = 'USD|EUR|GBP|JPY|CAD|AUD|NZD|CHF|CNY|INR|MXN|BRL|SEK|NOK|DKK|PLN|CZK|KRW';
const PREFIX = new RegExp(`^([$€£¥]|${CODES})[${SPACES}]*`);
const SUFFIX = new RegExp(`[${SPACES}]*([$€£¥]|${CODES})$`);
const PERCENT = new RegExp(`[${SPACES}]*%$`);

function escapeClass(char: string): string {
  return char.replace(/[\\\]^-]/g, '\\$&');
}

function groupClass(group: string): string {
  return /^[\s\u00a0\u202f\u2009]$/.test(group) ? `[${SPACES}]` : `[${escapeClass(group)}]`;
}

function coreRegex(decimal: string, group: string): RegExp {
  const d = `[${escapeClass(decimal)}]`;
  return new RegExp(`^(\\d{1,3}(?:${groupClass(group)}\\d{3})+|\\d+)?(?:${d}(\\d+))?(?:[eE]([+-]?\\d+))?$`);
}

function takeSign(text: string): { rest: string; negative: boolean } {
  const m = /^([+\-−])\s*/.exec(text);
  return m ? { rest: text.slice(m[0].length), negative: m[1] !== '+' } : { rest: text, negative: false };
}

/**
 * Reads a typed or pasted number. It accepts a sign or parentheses, a currency symbol at either end, digits in
 * groups of exactly three, a decimal part, an exponent, and a trailing percent sign.
 */
export function parseNumeric(input: string, decimal: string, group: string): NumericParse | null {
  let text = input.trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  let sign = takeSign(text);
  text = sign.rest;
  negative ||= sign.negative;
  let currency: string | null = null;
  const prefix = PREFIX.exec(text);
  if (prefix) {
    currency = prefix[1];
    sign = takeSign(text.slice(prefix[0].length));
    text = sign.rest;
    negative ||= sign.negative;
  }
  const suffix = SUFFIX.exec(text);
  if (suffix && !currency) {
    currency = suffix[1];
    text = text.slice(0, suffix.index);
  }
  const percent = PERCENT.test(text);
  if (percent) text = text.replace(PERCENT, '');
  const m = coreRegex(decimal, group).exec(text);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const whole = (m[1] ?? '0').replace(new RegExp(groupClass(group), 'g'), '');
  const value = Number(`${whole}.${m[2] ?? '0'}e${m[3] ?? '0'}`);
  if (!Number.isFinite(value)) return null;
  return {
    value: negative ? -value : value,
    percent,
    currency: currency === null ? null : (SYMBOLS[currency] ?? currency),
    decimals: m[2]?.length ?? 0,
  };
}

/** Reads a number in the locale's convention. */
export function parseLocaleNumber(input: string, locale: Locale): NumericParse | null {
  return parseNumeric(input, locale.decimal, locale.group);
}
