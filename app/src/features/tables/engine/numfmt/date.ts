// Renders a date or time section. The time rounds to the shown precision (whole seconds, or tenths to thousandths)
// and each field is then cut down, so 23:59:59.6 shown without fractions is the next day's 0:00:00.

import { daysToYmd, weekdayOf, type Ymd } from '../dates';
import type { Locale } from '../locale';
import { generalText } from './general';
import { namesOf, type Names } from './names';
import { Out } from './out';
import { compile } from './parse';
import { regionDateCode } from './region';
import type { Section, Token } from './types';

const DAY_SECONDS = 86_400;

type DateToken = Extract<Token, { t: 'date' }>;

interface Clock {
  ymd: Ymd;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  fraction: number;
  fracDigits: number;
  /** The whole time in units of 10^-fracDigits seconds, for elapsed tokens. */
  total: number;
  unit: number;
  twelve: boolean;
  names: Names;
  decimal: string;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function has(tokens: readonly Token[], kinds: readonly string[]): boolean {
  return tokens.some((t) => t.t === 'date' && kinds.includes(t.k));
}

/** The text of one date or time token. */
function field(t: DateToken, c: Clock): string {
  const { ymd, names } = c;
  switch (t.k) {
    case 'y':
      return t.n <= 2 ? pad(ymd.y % 100, 2) : pad(ymd.y, 4);
    case 'm':
      if (t.n <= 2) return pad(ymd.m, t.n);
      if (t.n === 3) return names.monthsShort[ymd.m - 1];
      return t.n === 5 ? names.months[ymd.m - 1].charAt(0) : names.months[ymd.m - 1];
    case 'd':
      if (t.n <= 2) return pad(ymd.d, t.n);
      return t.n === 3 ? names.daysShort[c.weekday] : names.days[c.weekday];
    case 'h':
      return pad(c.twelve ? c.hour % 12 || 12 : c.hour, Math.min(t.n, 2));
    case 'min':
      return pad(c.minute, t.n);
    case 's':
      return pad(c.second, Math.min(t.n, 2));
    case 'frac':
      return c.decimal + pad(c.fraction, c.fracDigits).slice(0, t.n);
    case 'eh':
      return pad(Math.floor(c.total / (3600 * c.unit)), t.n);
    case 'em':
      return pad(Math.floor(c.total / (60 * c.unit)), t.n);
    case 'es':
      return pad(Math.floor(c.total / c.unit), t.n);
    case 'ampm': {
      const word = c.hour < 12 ? names.am : names.pm;
      return t.text === t.text.toLowerCase() ? word.toLowerCase() : word;
    }
    case 'ap': {
      const letter = c.hour < 12 ? 'A' : 'P';
      return t.text[0] === t.text[0].toLowerCase() ? letter.toLowerCase() : letter;
    }
  }
}

/** Splits a serial into days and time units. Elapsed codes count the whole span and show its sign. */
function split(serial: number, dayUnits: number, elapsed: boolean): { days: number; units: number; total: number } {
  if (elapsed) {
    const total = Math.round(Math.abs(serial) * dayUnits);
    const days = Math.floor(total / dayUnits);
    return { days, units: total - days * dayUnits, total };
  }
  let days = Math.floor(serial);
  let units = Math.round((serial - days) * dayUnits);
  if (units >= dayUnits) {
    days++;
    units -= dayUnits;
  }
  return { days, units, total: units };
}

/** Renders a date or time section. Returns null when the date can't be shown. */
export function renderDate(serial: number, section: Section, locale: Locale): Out | null {
  if (section.system) {
    const inner = compile(regionDateCode(locale, section.system === 'longDate' ? 'long' : 'time'));
    if (inner.ok) return renderDate(serial, { ...inner.compiled.sections[0], color: section.color }, locale);
  }
  const tokens = section.tokens;
  const fracDigits = Math.max(0, ...tokens.map((t) => (t.t === 'date' && t.k === 'frac' ? t.n : 0)));
  const unit = 10 ** fracDigits;
  const elapsed = has(tokens, ['eh', 'em', 'es']);
  const { days, units, total } = split(serial, DAY_SECONDS * unit, elapsed);
  const needsDate = has(tokens, ['y', 'm', 'd']);
  const ymd = needsDate ? daysToYmd(days) : { y: 1900, m: 1, d: 1 };
  if (!(ymd.y >= 0 && ymd.y <= 9999)) return null;
  const clock: Clock = {
    ymd,
    weekday: weekdayOf(days),
    hour: Math.floor(units / (3600 * unit)),
    minute: Math.floor(units / (60 * unit)) % 60,
    second: Math.floor(units / unit) % 60,
    fraction: units % unit,
    fracDigits,
    total,
    unit,
    twelve: has(tokens, ['ampm', 'ap']),
    names: namesOf(section.locale ?? locale.tag),
    decimal: locale.decimal,
  };
  const out = new Out();
  if (elapsed && serial < 0) out.push('-');
  for (const t of tokens) {
    if (t.t === 'date') out.push(field(t, clock));
    else if (t.t === 'general') out.push(generalText(serial, locale.decimal));
    else out.token(t);
  }
  return out;
}
