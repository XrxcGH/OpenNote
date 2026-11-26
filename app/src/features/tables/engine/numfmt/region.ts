// The region's own date and time codes, read from the parts `Intl.DateTimeFormat` writes. They stand in for the
// locale-dependent built-in formats (14, 22, and the East Asian IDs), the system codes `[$-F800]` and `[$-F400]`,
// and the date column preset. en-US gives m/d/yyyy, mmm d, yyyy, dddd, mmmm d, yyyy, and h:mm:ss AM/PM.

import type { Locale } from '../locale';
import { namesOf } from './names';

export type DateStyle = 'short' | 'medium' | 'long' | 'time' | 'shortTime' | 'mediumDateTime' | 'shortDateTime';

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { year: 'numeric', month: 'numeric', day: 'numeric' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'full' },
  time: { timeStyle: 'medium' },
  shortTime: { timeStyle: 'short' },
  mediumDateTime: { dateStyle: 'medium', timeStyle: 'short' },
  shortDateTime: { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' },
};

const cache = new Map<string, string>();

/** A literal in a code: plain when it holds only characters that are literal anyway, quoted otherwise. */
function literal(text: string): string {
  const s = text.replace(/[\u202f\u00a0]/g, ' ');
  if (s === '') return '';
  return /^[ ,/:\-.]+$/.test(s) ? s : `"${s.replace(/"/g, '')}"`;
}

function build(locale: Locale, style: DateStyle): string {
  // Monday 2026-01-05 03:04:05 tells one-digit fields from two-digit ones.
  const sample = new Date(Date.UTC(2026, 0, 5, 3, 4, 5));
  const format = new Intl.DateTimeFormat(locale.tag, { ...OPTIONS[style], timeZone: 'UTC' });
  const names = namesOf(locale.tag);
  let code = '';
  for (const part of format.formatToParts(sample)) {
    const v = part.value;
    switch (part.type) {
      case 'weekday':
        code += v === names.days[1] ? 'dddd' : 'ddd';
        break;
      case 'day':
        code += v.length === 2 ? 'dd' : 'd';
        break;
      case 'month':
        if (/^\d+$/.test(v)) code += v.length === 2 ? 'mm' : 'm';
        else code += v === names.months[0] ? 'mmmm' : 'mmm';
        break;
      case 'year':
        code += v.length === 2 ? 'yy' : 'yyyy';
        break;
      case 'hour':
        code += v.length === 2 ? 'hh' : 'h';
        break;
      case 'minute':
        code += 'mm';
        break;
      case 'second':
        code += 'ss';
        break;
      case 'dayPeriod':
        code += 'AM/PM';
        break;
      case 'literal':
        code += literal(v);
        break;
      default:
        break;
    }
  }
  return code;
}

/** The region's code for a date or time style. */
export function regionDateCode(locale: Locale, style: DateStyle): string {
  const key = `${locale.tag}|${style}`;
  let code = cache.get(key);
  if (code === undefined) {
    try {
      code = build(locale, style);
    } catch {
      code = style === 'time' ? 'h:mm:ss AM/PM' : style === 'shortTime' ? 'h:mm AM/PM' : 'm/d/yyyy';
    }
    cache.set(key, code);
  }
  return code;
}
