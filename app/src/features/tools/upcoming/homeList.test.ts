import { describe, expect, it } from 'vitest';
import type { Due } from './date';
import type { UpcomingItem } from './group';
import { HOME_UPCOMING_COUNT, soonest } from './homeList';
import { toInstant } from './zone';

const NY = 'America/New_York';
const NOW = toInstant({ year: 2026, month: 10, day: 1 }, { hour: 10, minute: 0 }, NY);
const context = { now: NOW, timeZone: NY };
const day = (month: number, date: number): Due => ({ date: { year: 2026, month, day: date }, time: null });
const item = (id: string, due: Due | null, done = false): UpcomingItem => ({ id, title: id, due, done });

describe('the Home page list', () => {
  it('lists overdue items first, then the soonest, and leaves out the undated and the done', () => {
    const list = soonest(
      [
        item('later', day(11, 2)),
        item('none', null),
        item('old', day(9, 1)),
        item('over', day(9, 30), true),
        item('soon', day(10, 2)),
      ],
      context,
    );
    expect(list.map((one) => one.id)).toEqual(['old', 'soon', 'later']);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 12 }, (_, index) => item(`i${index}`, day(10, 2 + index)));
    expect(soonest(many, context)).toHaveLength(HOME_UPCOMING_COUNT);
    expect(soonest(many, context, 2).map((one) => one.id)).toEqual(['i0', 'i1']);
    expect(soonest(many, context, 0)).toEqual([]);
  });
});
