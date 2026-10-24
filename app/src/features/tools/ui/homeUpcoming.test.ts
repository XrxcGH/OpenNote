// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { homeUpcoming } from './homeUpcoming';
import { examsStore, timetableStore } from './upcomingStores';

describe('Home upcoming', () => {
  it('lists an exam and the next class with the tasks', () => {
    const now = new Date(2026, 9, 21, 9, 0).getTime();
    examsStore.set([{ id: 'e1', name: 'Chemistry final', date: '2026-11-10', time: '14:00' }]);
    timetableStore.set([{ id: 'c1', name: 'Biology 101', days: [3], start: '10:00', end: '11:00', room: '' }]);
    const titles = homeUpcoming(now).map((item) => item.title);
    expect(titles).toEqual(['Biology 101', 'Chemistry final']);
    examsStore.set([]);
    timetableStore.set([]);
  });
});
