// Windows notifications for due items and finished timers (Productivity and study tools). They are off until the
// person turns them on, which is also when Windows is asked for permission. Each reminder comes once, and nothing
// repeats or nags. The page's web notifications show as Windows toasts, so no extra plugin is needed.
import { t } from '../../../strings/t';
import { dueReminders } from '../upcoming/reminders';
import type { UpcomingItem } from '../upcoming';
import { loadStored } from './storage';
import { readReminders, writeReminders } from './upcomingStores';

const supported = (): boolean => typeof Notification !== 'undefined';

export const remindersOn = (): boolean => readReminders().on && supported() && Notification.permission === 'granted';

/** Turns reminders on, asking Windows for permission if it has not been asked. Returns whether they are on. */
export async function enableReminders(): Promise<boolean> {
  if (!supported()) return false;
  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  const on = permission === 'granted';
  writeReminders({ ...readReminders(), on });
  return on;
}

export function disableReminders(): void {
  writeReminders({ ...readReminders(), on: false });
}

/** Shows a notification now, if reminders are on. */
export function showNotice(title: string, body?: string): void {
  if (!remindersOn()) return;
  try {
    new Notification(title, body ? { body, silent: false } : { silent: false });
  } catch {
    // A notification that cannot show is not worth an error.
  }
}

/** Announces the items whose time has come. Safe to call often. */
export function runReminderCheck(now = Date.now()): void {
  if (!remindersOn()) return;
  const saved = loadStored<{ items?: UpcomingItem[] }>('upcoming', {});
  const items = Array.isArray(saved.items) ? saved.items : [];
  const state = readReminders();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const found = dueReminders(items, now, zone, new Set(state.sent));
  if (found.length === 0) return;
  for (const reminder of found) showNotice(t('study.reminders.due'), reminder.title);
  writeReminders({ ...state, sent: [...state.sent, ...found.map((one) => one.key)] });
}
