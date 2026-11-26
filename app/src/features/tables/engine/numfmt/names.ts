// Month names, day names, and the AM and PM words of a region, from `Intl.DateTimeFormat`. Read once per tag.

export interface Names {
  months: string[];
  monthsShort: string[];
  days: string[];
  daysShort: string[];
  am: string;
  pm: string;
}

const cache = new Map<string, Names>();

function part(format: Intl.DateTimeFormat, date: Date, type: Intl.DateTimeFormatPartTypes): string {
  return format.formatToParts(date).find((p) => p.type === type)?.value ?? '';
}

function read(tag: string): Names {
  // Format codes count Gregorian days, so the names are Gregorian whatever the tag asks for.
  const utc = { timeZone: 'UTC', calendar: 'gregory' } as const;
  const long = new Intl.DateTimeFormat(tag, { ...utc, month: 'long' });
  const short = new Intl.DateTimeFormat(tag, { ...utc, month: 'short' });
  const day = new Intl.DateTimeFormat(tag, { ...utc, weekday: 'long' });
  const dayShort = new Intl.DateTimeFormat(tag, { ...utc, weekday: 'short' });
  const hour = new Intl.DateTimeFormat(tag, { ...utc, hour: 'numeric', hour12: true });
  const months: string[] = [];
  const monthsShort: string[] = [];
  for (let m = 0; m < 12; m++) {
    const date = new Date(Date.UTC(2024, m, 15));
    months.push(part(long, date, 'month'));
    monthsShort.push(part(short, date, 'month'));
  }
  const days: string[] = [];
  const daysShort: string[] = [];
  // 2024-01-07 was a Sunday.
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.UTC(2024, 0, 7 + d));
    days.push(part(day, date, 'weekday'));
    daysShort.push(part(dayShort, date, 'weekday'));
  }
  const am = part(hour, new Date(Date.UTC(2024, 0, 1, 9)), 'dayPeriod') || 'AM';
  const pm = part(hour, new Date(Date.UTC(2024, 0, 1, 21)), 'dayPeriod') || 'PM';
  return { months, monthsShort, days, daysShort, am, pm };
}

/** The names of a region. An unknown tag reads as en-US. */
export function namesOf(tag: string): Names {
  let names = cache.get(tag);
  if (!names) {
    try {
      names = read(tag);
    } catch {
      names = read('en-US');
    }
    cache.set(tag, names);
  }
  return names;
}
