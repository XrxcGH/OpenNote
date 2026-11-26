import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics';
import { escapeIcsText, writeIcs } from './icsWrite';
import type { UpcomingItem } from './group';
import type { ClassSlot, Exam } from './productivity';

const base = { today: { year: 2026, month: 11, day: 4 }, stamp: '20261104T150000Z' };
const task: UpcomingItem = {
  id: 'a1',
  title: 'Lab report, part 2; draft',
  due: { date: { year: 2026, month: 11, day: 6 }, time: { hour: 17, minute: 30 } },
  done: false,
};
const exam: Exam = { id: 'e1', name: 'Chem midterm', date: '2026-11-12', time: '' };
const slot: ClassSlot = { id: 'c1', name: 'Biology', days: [3, 1], start: '09:00', end: '10:15', room: 'Hall 2' };

describe('writing an .ics file', () => {
  it('writes tasks, exams, and weekly classes that the reader reads back', () => {
    const text = writeIcs({ ...base, items: [task], exams: [exam], classes: [slot] });
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const calendar = parseIcs(text);
    expect(calendar.skipped).toBe(0);
    expect(calendar.components.map((one) => [one.kind, one.title])).toEqual([
      ['todo', 'Lab report, part 2; draft'],
      ['event', 'Chem midterm'],
      ['event', 'Biology'],
    ]);
    const biology = calendar.components[2];
    expect(biology.rule).not.toBeNull();
    expect(biology.location).toBe('Hall 2');
    // Monday and Wednesday: the first meeting on or after the day the file was made (Wednesday 4 November 2026).
    expect(text).toContain('DTSTART:20261104T090000');
    expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('leaves out an item with no date and marks a finished task completed', () => {
    const text = writeIcs({
      ...base,
      items: [
        { ...task, done: true },
        { id: 'n', title: 'Someday', due: null, done: false },
      ],
      exams: [],
      classes: [],
    });
    expect(text).toContain('STATUS:COMPLETED');
    expect(text).not.toContain('Someday');
  });

  it('escapes text and folds long lines', () => {
    expect(escapeIcsText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
    const long = writeIcs({ ...base, items: [{ ...task, title: 'x'.repeat(200) }], exams: [], classes: [] });
    expect(long.split('\r\n').every((line) => line.length <= 75)).toBe(true);
    expect(parseIcs(long).components[0].title).toBe('x'.repeat(200));
  });
});
