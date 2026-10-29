// The person's region as the table engine reads it (Phase 7): the decimal mark, digit groups, the separator between
// function arguments, the order of day, month, and year, and the usual currency. It comes from the browser's
// locale, which Windows sets from the regional format, never from the interface language.
import type { DateOrder, Locale } from '../engine';
import { EN_US } from '../engine';

const CURRENCIES: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  JP: 'JPY',
  CN: 'CNY',
  IN: 'INR',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  BR: 'BRL',
  MX: 'MXN',
};
const EURO = new Set([
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'BE',
  'AT',
  'IE',
  'PT',
  'FI',
  'GR',
  'LU',
  'SK',
  'SI',
  'EE',
  'LV',
  'LT',
]);

function orderOf(tag: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(tag).formatToParts(new Date(2001, 10, 25));
    const names = parts.flatMap((part) => (['day', 'month', 'year'].includes(part.type) ? [part.type] : []));
    const first = names[0];
    return first === 'year' ? 'ymd' : first === 'day' ? 'dmy' : 'mdy';
  } catch {
    return 'mdy';
  }
}

let cached: Locale | null = null;

/** The region the engine reads and writes numbers and dates in. */
export function appLocale(): Locale {
  if (cached) return cached;
  const tag = typeof navigator === 'undefined' || !navigator.language ? 'en-US' : navigator.language;
  try {
    const parts = new Intl.NumberFormat(tag).formatToParts(1234567.5);
    const decimal = parts.find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.';
    const group = parts.find((part) => part.type === 'group')?.value ?? (decimal === ',' ? '.' : ',');
    const region = new Intl.Locale(tag).maximize().region ?? 'US';
    cached = {
      tag,
      decimal,
      group,
      list: decimal === ',' ? ';' : ',',
      dateOrder: orderOf(tag),
      currency: CURRENCIES[region] ?? (EURO.has(region) ? 'EUR' : 'USD'),
    };
  } catch {
    cached = EN_US;
  }
  return cached;
}
