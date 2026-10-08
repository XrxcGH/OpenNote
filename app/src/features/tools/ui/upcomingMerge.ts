// How another feature puts items in Upcoming: it hands over everything from one source, such as a course, and the
// list keeps its own items, replaces that source's items, and keeps which of them the person ticked off. An open
// Upcoming window re-reads when this runs.
import { updateFromFile } from '../upcoming';
import type { UpcomingItem } from '../upcoming';
import { loadStored, saveStored } from './storage';

export const UPCOMING_STORE = 'upcoming';
export const UPCOMING_CHANGED = 'opennote:upcoming-changed';

export interface UpcomingSaved {
  items: UpcomingItem[];
  next: number;
}

export function readUpcoming(): UpcomingSaved {
  const saved = loadStored<Partial<UpcomingSaved>>(UPCOMING_STORE, {});
  const items = Array.isArray(saved.items)
    ? saved.items.filter((item): item is UpcomingItem => typeof item?.id === 'string' && typeof item.title === 'string')
    : [];
  return { items, next: typeof saved.next === 'number' ? saved.next : items.length + 1 };
}

/**
 * Replaces the items of one source (`source` is stored on each, so it is also what the list uses to tell them apart).
 * Answers how many were added, removed, and changed.
 */
export function setSourceItems(
  source: string,
  incoming: readonly UpcomingItem[],
): { added: number; removed: number; changed: number } {
  const saved = readUpcoming();
  const tagged = incoming.map((item) => ({ ...item, source }));
  const { next, added, removed, changed } = updateFromFile(saved.items, tagged, source);
  saveStored(UPCOMING_STORE, { ...saved, items: next });
  try {
    window.dispatchEvent(new Event(UPCOMING_CHANGED));
  } catch {
    // No window (a test without a DOM): nothing is open to refresh.
  }
  return { added, removed, changed };
}

/** The items that one source put in the list. */
export const sourceItems = (source: string): UpcomingItem[] =>
  readUpcoming().items.filter((item) => item.source === source);
