// The views of a smart table: lanes, days, bars, and months, from the table's own cells.
import { describe, expect, it } from 'vitest';
import { EN_US } from '../engine';
import { EMPTY_SMART } from './data';
import { buildModel } from './model';
import {
  barsOf,
  cellText,
  dayText,
  defaultColumns,
  lanesOf,
  monthOf,
  monthWeeks,
  neighborLane,
  rowsByDay,
  shiftMonth,
} from './viewLogic';

const model = buildModel(
  {
    header: true,
    columnIds: ['a', 'b', 'c', 'd'],
    texts: [
      ['Task', 'Status', 'Start', 'End'],
      ['Write essay', 'Doing', '2026-10-05', '2026-10-09'],
      ['Read book', 'Todo', '2026-10-07', ''],
      ['Lab report', 'Doing', '2026-10-07', '2026-10-08'],
      ['Plan trip', '', '', ''],
    ],
  },
  EMPTY_SMART,
  EN_US,
);

describe('table views', () => {
  it('pick sensible columns to start from', () => {
    expect(defaultColumns(model)).toEqual({ title: 0, group: 1, date: 2, end: 3 });
  });
  it('make lanes in order of first appearance, with a last lane for rows with no value', () => {
    const lanes = lanesOf(model, 1, EN_US);
    expect(lanes.map((lane) => [lane.value, lane.rows])).toEqual([
      ['Doing', [0, 2]],
      ['Todo', [1]],
      ['', [3]],
    ]);
    expect(neighborLane(lanes, 'Doing', 1)?.value).toBe('Todo');
    expect(neighborLane(lanes, 'Doing', -1)).toBeNull();
    expect(cellText(model, 0, 0, EN_US)).toBe('Write essay');
  });
  it('place rows on days and lay a month out in Sunday-first weeks', () => {
    const days = rowsByDay(model, 2);
    expect([...days.values()].map((rows) => rows.length).sort()).toEqual([1, 2]);
    const october = monthWeeks({ year: 2026, month: 10 });
    expect(october).toHaveLength(5);
    expect(october[0]).toHaveLength(7);
    // 1 October 2026 is a Thursday, so the first week starts on Sunday 27 September.
    expect(dayText(october[0][0])).toBe('2026-09-27');
    expect(dayText(october[0][4])).toBe('2026-10-01');
    expect(monthOf(october[1][0])).toEqual({ year: 2026, month: 10 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
  it('draw bars from start to end, or one day when there is no end', () => {
    const { bars, first, last } = barsOf(model, 2, 3);
    expect(bars.map((bar) => bar.row)).toEqual([0, 1, 2]);
    expect(bars[1].end).toBe(bars[1].start);
    expect(last - first).toBe(4);
  });
});
