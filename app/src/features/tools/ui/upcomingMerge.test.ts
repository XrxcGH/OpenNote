// @vitest-environment jsdom
// Items from another feature: they replace their own source's items, keep what the person ticked off, and never touch
// the person's own items. An open Upcoming window is told to re-read.
import { beforeEach, describe, expect, it } from 'vitest';
import type { UpcomingItem } from '../upcoming';
import { readUpcoming, setSourceItems, sourceItems, UPCOMING_CHANGED } from './upcomingMerge';

const item = (id: string, title: string, done = false): UpcomingItem => ({
  id,
  title,
  due: { date: { year: 2026, month: 10, day: 14 }, time: null },
  done,
});

describe('setSourceItems', () => {
  beforeEach(() => localStorage.clear());

  it('adds, updates, and removes only its own source’s items', () => {
    localStorage.setItem('opennote.tools.upcoming', JSON.stringify({ items: [item('u1', 'Buy a notebook')], next: 2 }));
    let heard = 0;
    window.addEventListener(UPCOMING_CHANGED, () => (heard += 1));
    expect(setSourceItems('canvas:11', [item('a', 'Lab 3'), item('b', 'Quiz')])).toEqual({
      added: 2,
      removed: 0,
      changed: 0,
    });
    expect(setSourceItems('canvas:11', [item('a', 'Lab 3 (revised)')])).toEqual({ added: 0, removed: 1, changed: 1 });
    expect(sourceItems('canvas:11').map((one) => one.title)).toEqual(['Lab 3 (revised)']);
    expect(readUpcoming().items.map((one) => one.title)).toEqual(['Buy a notebook', 'Lab 3 (revised)']);
    expect(readUpcoming().next).toBe(2);
    expect(heard).toBe(2);
  });

  it('keeps what the person ticked off', () => {
    setSourceItems('canvas:11', [item('a', 'Lab 3')]);
    const saved = readUpcoming();
    localStorage.setItem(
      'opennote.tools.upcoming',
      JSON.stringify({ ...saved, items: saved.items.map((one) => ({ ...one, done: true })) }),
    );
    setSourceItems('canvas:11', [item('a', 'Lab 3')]);
    expect(sourceItems('canvas:11')[0]?.done).toBe(true);
  });
});
