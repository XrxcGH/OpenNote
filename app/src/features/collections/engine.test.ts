import { describe, expect, it } from 'vitest';
import type { PageFact } from '../../services/search/types';
import { emptyCollection, groupRows, matches, propertyNames, satisfies, sortRows, toRow, withValue } from './engine';

const fact = (title: string, fields: unknown[], tags: string[] = [], section = 's1'): PageFact => ({
  page: title.toLowerCase(),
  notebook: 'n1',
  section,
  title,
  created: 0,
  modified: 0,
  tags,
  hasProperties: fields.length > 0,
  properties: { fields },
});

const rows = [
  toRow(
    fact(
      'Essay',
      [
        { id: 'a', name: 'Course', type: 'choice', value: 'Bio 201' },
        { id: 'b', name: 'Due', type: 'date', value: '2026-10-07' },
        { id: 'c', name: 'Pages', type: 'number', value: 9 },
      ],
      ['school/bio'],
    ),
  ),
  toRow(
    fact(
      'Lab report',
      [
        { id: 'a', name: 'Course', type: 'choice', value: 'Bio 201' },
        { id: 'b', name: 'Due', type: 'date', value: '2026-10-14' },
        { id: 'c', name: 'Pages', type: 'number', value: 12 },
      ],
      ['school/bio'],
      's2',
    ),
  ),
  toRow(fact('Groceries', [], ['home'])),
];

const words = { none: 'No value', yes: 'Yes', no: 'No' };

describe('collections', () => {
  it('chooses pages by tag (nested tags count), section, and property values', () => {
    const def = { ...emptyCollection('c', 'Bio'), tag: 'school' };
    expect(rows.filter((row) => matches(row, def, null)).map((row) => row.title)).toEqual(['Essay', 'Lab report']);
    expect(rows.filter((row) => matches(row, { ...def, section: 's2' }, null))).toHaveLength(1);
    const open = { ...def, conditions: [{ name: 'Due', op: 'before' as const, value: '2026-10-10' }] };
    expect(rows.filter((row) => matches(row, open, null)).map((row) => row.title)).toEqual(['Essay']);
    const long = { ...def, conditions: [{ name: 'Pages', op: 'atLeast' as const, value: '10' }] };
    expect(rows.filter((row) => matches(row, long, null)).map((row) => row.title)).toEqual(['Lab report']);
  });

  it('keeps to the pages a search found', () => {
    expect(rows.filter((row) => matches(row, emptyCollection('c', 'x'), new Set(['groceries'])))).toHaveLength(1);
  });

  it('treats a missing property as empty', () => {
    expect(satisfies(undefined, { name: 'Due', op: 'empty', value: '' })).toBe(true);
    expect(satisfies(undefined, { name: 'Due', op: 'is', value: 'x' })).toBe(false);
  });

  it('sorts by a property, with empty values last either way', () => {
    const asc = sortRows(rows, { sortBy: 'Pages', sortDir: 'asc' }).map((row) => row.title);
    const desc = sortRows(rows, { sortBy: 'Pages', sortDir: 'desc' }).map((row) => row.title);
    expect(asc).toEqual(['Essay', 'Lab report', 'Groceries']);
    expect(desc).toEqual(['Lab report', 'Essay', 'Groceries']);
  });

  it('groups by a property, and by week for a date', () => {
    const def = { ...emptyCollection('c', 'x'), groupBy: 'Course' };
    expect(groupRows(rows, def, words).map((group) => [group.label, group.rows.length])).toEqual([
      ['Bio 201', 2],
      ['No value', 1],
    ]);
    const weekly = { ...emptyCollection('c', 'x'), groupBy: 'Due', groupDate: 'week' as const };
    expect(groupRows(rows, weekly, words).map((group) => group.key)).toEqual(['2026-10-05', '2026-10-12', '~']);
  });

  it('lists property names by use and sets a value', () => {
    expect(propertyNames(rows)).toEqual(['Course', 'Due', 'Pages']);
    const set = withValue(rows[0].fields, 'Course', 'choice', 'Chem 101');
    expect(set.find((field) => field.name === 'Course')?.value).toBe('Chem 101');
    expect(withValue([], 'Status', 'text', 'Open')).toHaveLength(1);
  });
});
