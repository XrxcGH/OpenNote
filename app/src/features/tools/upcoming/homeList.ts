// The few items the Home page lists under Upcoming: what is overdue or due soonest, in date order, a handful at most.
// Items with no date and items already done are left out, so Home stays short and calm.
import { groupUpcoming } from './group';
import type { GroupContext, UpcomingGroupId, UpcomingItem } from './group';

export const HOME_UPCOMING_COUNT = 5;

const ORDER: readonly UpcomingGroupId[] = ['overdue', 'today', 'thisWeek', 'later'];

export function soonest(
  items: readonly UpcomingItem[],
  context: GroupContext,
  limit: number = HOME_UPCOMING_COUNT,
): UpcomingItem[] {
  const groups = groupUpcoming(items, context);
  return ORDER.flatMap((id) => groups[id]).slice(0, Math.max(0, limit));
}
