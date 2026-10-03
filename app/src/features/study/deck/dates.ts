// Calendar days as 'YYYY-MM-DD' keys, counted in whole days so a change of clocks never shifts a due date.
const DAY = 86_400_000;

const pad = (value: number): string => String(value).padStart(2, '0');

/** The local day of `now`. */
export function dayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function utcOf(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

const toKey = (utc: number): string => {
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** Whether the text is a day key for a day that exists. */
export function isDayKey(text: unknown): text is string {
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && toKey(utcOf(text)) === text;
}

export function addDays(key: string, days: number): string {
  return toKey(utcOf(key) + Math.round(days) * DAY);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY);
}
