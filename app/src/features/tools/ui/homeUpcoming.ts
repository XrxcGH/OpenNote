// What Home reads from Upcoming: the next few items, from the list kept on this device and the dates written on
// pages. Home loads this code only when its Upcoming section shows.
import { soonest } from '../upcoming/homeList';
import type { UpcomingItem } from '../upcoming';
import { loadStored } from './storage';
import { pageItemsStore } from './upcomingStores';

export function homeUpcoming(now = Date.now(), limit?: number): UpcomingItem[] {
  const saved = loadStored<{ items?: UpcomingItem[] }>('upcoming', {});
  const own = Array.isArray(saved.items) ? saved.items : [];
  const fromPages = Object.values(pageItemsStore.get()).flatMap((entry) => entry.items);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return soonest([...own, ...fromPages], { now, timeZone }, limit);
}
