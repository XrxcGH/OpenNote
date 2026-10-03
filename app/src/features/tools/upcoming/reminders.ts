// Which items are due for a reminder (Productivity and study tools). A reminder comes once, when an item with a
// time reaches that time, and once at 8 in the morning for an item with only a day. It never repeats, and an item
// that is long past, done, or already announced is left alone.
import { compareDates, dateKey } from './date';
import type { UpcomingItem } from './group';
import { dateIn, dueInstant } from './zone';

export interface Reminder {
  /** A name for this reminder, so it is announced once. */
  key: string;
  title: string;
}

/** How long after its time an item may still be announced, such as after the computer wakes. */
export const GRACE_MS = 30 * 60_000;
const ALL_DAY_HOUR = 8;

export function dueReminders(
  items: readonly UpcomingItem[],
  now: number,
  zone: string,
  sent: ReadonlySet<string>,
): Reminder[] {
  const today = dateIn(now, zone);
  const found: Reminder[] = [];
  for (const item of items) {
    if (item.done || !item.due || item.page) continue;
    const key = `${item.id}@${dateKey(item.due.date)}${item.due.time ? `T${item.due.time.hour}:${item.due.time.minute}` : ''}`;
    if (sent.has(key)) continue;
    if (item.due.time) {
      const at = dueInstant(item.due, zone);
      if (now >= at && now - at <= GRACE_MS) found.push({ key, title: item.title });
    } else if (compareDates(item.due.date, today) === 0) {
      const local = new Date(now).toLocaleString('en-US', { timeZone: zone, hour12: false, hour: '2-digit' });
      if (Number(local.replace(/\D/g, '')) % 24 >= ALL_DAY_HOUR) found.push({ key, title: item.title });
    }
  }
  return found;
}
