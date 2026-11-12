import { describe, expect, it } from 'vitest';
import { createTable } from '../engine/edit';
import { filterIndices } from '../engine/filter';
import { EN_US } from '../engine/locale';
import { builtInLists, sortedIndices, type LookOf } from '../engine/sort';
import { removeDuplicates, trimSpaces } from './rows';
import { splitText } from './textToColumns';
import { lookCounts, valueCounts } from './filterMenu';

const names = (indices: number[], column: (i: number) => string): string[] => indices.map(column);

describe('sort with custom lists and colors', () => {
  const table = createTable(
    [{ name: 'Month' }, { name: 'N', type: 'number' }],
    [
      ['Mar', '1'],
      ['Jan', '2'],
      ['Feb', '3'],
      ['Apr', '4'],
    ],
    EN_US,
  );
  const month = (i: number): string => table.rows[i].cells[0].raw;

  it('orders Mar, Jan, Feb as Jan, Feb, Mar by the built-in month list', () => {
    // Hand-worked: the list is the calendar order Jan..Dec; "Apr" is on it too, so it follows Mar.
    const list = builtInLists('en-US').months[1];
    expect(list.slice(0, 3)).toEqual(['Jan', 'Feb', 'Mar']);
    expect(names(sortedIndices(table, [{ column: 0, customList: list }], EN_US), month)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
    ]);
  });

  it('puts text not on the list after the listed text', () => {
    const t = createTable([{ name: 'M' }], [['x'], ['Feb'], ['Jan']], EN_US);
    const order = sortedIndices(t, [{ column: 0, customList: ['Jan', 'Feb'] }], EN_US);
    expect(order.map((i) => t.rows[i].cells[0].raw)).toEqual(['Jan', 'Feb', 'x']);
  });

  it('puts cells with the amber fill first and keeps the others in order', () => {
    const fills = ['gray', 'amber', 'gray', 'amber'];
    const look: LookOf = (row, _c, kind) => (kind === 'fill' ? fills[row] : undefined);
    expect(sortedIndices(table, [{ column: 0, by: 'fill', color: 'AMBER' }], EN_US, undefined, look)).toEqual([
      1, 3, 0, 2,
    ]);
    expect(
      sortedIndices(table, [{ column: 0, by: 'fill', color: 'amber', desc: true }], EN_US, undefined, look),
    ).toEqual([0, 2, 1, 3]);
  });

  it('sorts case sensitively with lowercase before capitals of the same letter', () => {
    const t = createTable([{ name: 'T' }], [['B'], ['b'], ['A'], ['a']], EN_US);
    const plain = sortedIndices(t, [{ column: 0 }], EN_US).map((i) => t.rows[i].cells[0].raw);
    // Without case sensitivity the equal letters keep their input order (a stable sort).
    expect(plain).toEqual(['A', 'a', 'B', 'b']);
    const cased = sortedIndices(t, [{ column: 0, caseSensitive: true }], EN_US).map((i) => t.rows[i].cells[0].raw);
    expect(cased).toEqual(['a', 'A', 'b', 'B']);
  });
});

describe('filter operations', () => {
  const t = createTable(
    [{ name: 'Name' }, { name: 'Qty', type: 'number' }],
    [
      ['Apple', '5'],
      ['Banana', '9'],
      ['Cherry', '1'],
      ['Apricot', '5'],
    ],
    EN_US,
  );
  it('begins with, ends with, does not contain', () => {
    expect(filterIndices(t, [{ column: 0, op: 'beginsWith', value: 'ap' }])).toEqual([0, 3]);
    expect(filterIndices(t, [{ column: 0, op: 'endsWith', value: 'y' }])).toEqual([2]);
    expect(filterIndices(t, [{ column: 0, op: 'notContains', value: 'an' }])).toEqual([0, 2, 3]);
  });
  it('top, bottom, above and below average', () => {
    expect(filterIndices(t, [{ column: 1, op: 'top', value: '2' }])).toEqual([0, 1, 3]);
    expect(filterIndices(t, [{ column: 1, op: 'bottom', value: '1' }])).toEqual([2]);
    expect(filterIndices(t, [{ column: 1, op: 'top', value: '25', to: 'percent' }])).toEqual([1]);
    // The mean of 5, 9, 1, 5 is 5.
    expect(filterIndices(t, [{ column: 1, op: 'aboveAverage' }])).toEqual([1]);
    expect(filterIndices(t, [{ column: 1, op: 'belowAverage' }])).toEqual([2]);
  });
  it('filters by fill color', () => {
    const look: LookOf = (row, _c, kind) => (kind === 'fill' && row % 2 === 0 ? 'red' : undefined);
    expect(filterIndices(t, [{ column: 0, op: 'fill', value: 'RED' }], look)).toEqual([0, 2]);
    expect(filterIndices(t, [{ column: 0, op: 'fill', value: '' }], look)).toEqual([1, 3]);
    expect(lookCounts(t, 0, 'fill', look)).toEqual([{ value: 'red', count: 2 }]);
  });
  it('counts the values of a column', () => {
    expect(valueCounts(t, 1)).toEqual([
      { value: '5', count: 2 },
      { value: '9', count: 1 },
      { value: '1', count: 1 },
    ]);
  });
});

describe('remove duplicates and trim', () => {
  it('on columns A and B of 6 rows with 2 duplicates removes 2 and keeps 4', () => {
    const t = createTable(
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      [
        ['x', '1', 'p'],
        ['y', '2', 'q'],
        ['X', '1', 'r'],
        ['z', '3', 's'],
        ['y', '2', 't'],
        ['w', '4', 'u'],
      ],
      EN_US,
    );
    const result = removeDuplicates(t, [0, 1]);
    expect(result.removed).toBe(2);
    expect(result.kept).toBe(4);
    expect(result.table.rows.map((r) => r.cells[2].raw)).toEqual(['p', 'q', 's', 'u']);
    expect(removeDuplicates(t, [0, 1], { caseSensitive: true }).removed).toBe(1);
  });
  it('trims spaces like TRIM', () => {
    const t = createTable([{ name: 'A' }], [['  a   b  '], ['ok']], EN_US);
    const out = trimSpaces(t, EN_US);
    expect(out.changed).toBe(1);
    expect(out.table.rows[0].cells[0].raw).toBe('a b');
  });
});

describe('text to columns', () => {
  it('splits a;b;;c on semicolons, treating consecutive delimiters as one', () => {
    expect(splitText('a;b;;c', { mode: 'delimited', delimiters: [';'], consecutive: true })).toEqual(['a', 'b', 'c']);
    expect(splitText('a;b;;c', { mode: 'delimited', delimiters: [';'] })).toEqual(['a', 'b', '', 'c']);
  });
  it('keeps quoted delimiters together and splits at fixed widths', () => {
    expect(splitText('a,"b,c",d', { mode: 'delimited', delimiters: [','] })).toEqual(['a', 'b,c', 'd']);
    expect(splitText('2026Mar12', { mode: 'fixed', breaks: [4, 7] })).toEqual(['2026', 'Mar', '12']);
  });
});
