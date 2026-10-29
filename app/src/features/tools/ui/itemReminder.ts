// A reminder for one item of Upcoming. It is the person's choice for each item: a task in the list keeps the choice
// on the item (so a repeat keeps it), and a line on a page keeps it under the page and the words of the line.
// Turning one on asks Windows for permission the first time, because reminders are off until then.
import type { UpcomingItem } from '../upcoming';
import { pageReminderKey } from '../upcoming/reminders';
import { enableReminders, remindersOn } from './notify';
import { readReminders, writeReminders } from './upcomingStores';

/** Whether this item has a reminder asked for. */
export function hasReminder(item: UpcomingItem, pageLines: readonly string[]): boolean {
  return item.page ? pageLines.includes(pageReminderKey(item)) : item.remind === true;
}

/** The page lines with this item's reminder turned on or off. */
export function withPageReminder(pageLines: readonly string[], item: UpcomingItem, on: boolean): string[] {
  const key = pageReminderKey(item);
  const rest = pageLines.filter((one) => one !== key);
  return on ? [...rest, key] : rest;
}

/**
 * Saves the choice for a page line and, when turning one on, makes sure Windows reminders are on. Returns false when
 * the person turned a reminder on but Windows will not show notifications, so the screen can say why.
 */
export async function chooseReminder(item: UpcomingItem, on: boolean): Promise<boolean> {
  if (item.page) {
    const state = readReminders();
    writeReminders({ ...state, pageLines: withPageReminder(state.pageLines, item, on) });
  }
  if (on && !remindersOn()) return enableReminders();
  return true;
}
