// Numbers, dates, and times in the docs/BRAND.md style: "3 pages", "2:05 PM", and "Sep 30, 2026". The locale is set
// here, in one place, until Phase 13 adds others.

const LOCALE = 'en-US';

const dates = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
const times = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const numbers = new Intl.NumberFormat(LOCALE);

/** "Sep 30, 2026", in the local time zone. */
export function formatDate(iso: string): string {
  return dates.format(new Date(iso));
}

/** "2:05 PM", in the local time zone. */
export function formatTime(iso: string): string {
  return times.format(new Date(iso));
}

/** "1,000". */
export function formatNumber(n: number): string {
  return numbers.format(n);
}
