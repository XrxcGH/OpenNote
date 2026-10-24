import { describe, expect, it } from 'vitest';
import { DE_DE } from '../../../tables';
import { SubjectError } from '../errors';
import { stack, unstack } from './longWide';
import { MAX_ROWS, completeRows, levelsOf, numbersOf } from './model';
import type { DataColumn } from './model';
import { gridOf, plainCell, tablesOf } from './page';
import { convertColumn, dataFromGrid, parseDataText, readNumber } from './parse';

const named = (columns: readonly DataColumn[], name: string) => {
  const column = columns.find((c) => c.name === name);
  if (!column) throw new Error(`no column ${name}`);
  return column;
};

describe('reading pasted data', () => {
  it('reads CSV with a header, quoted fields and a doubled quote', () => {
    const data = parseDataText('name,score,group\n"Lee, J",12.5,a\n"say ""hi""",8,b\nKim,10,a\n');
    expect(data.rows).toBe(3);
    expect(data.columns.map((c) => [c.name, c.kind])).toEqual([
      ['name', 'text'],
      ['score', 'number'],
      ['group', 'category'],
    ]);
    expect(named(data.columns, 'name').values).toEqual(['Lee, J', 'say "hi"', 'Kim']);
    expect(numbersOf(named(data.columns, 'score'))).toEqual([12.5, 8, 10]);
    expect(levelsOf(named(data.columns, 'group'))).toEqual(['a', 'b']);
  });

  it('reads TSV with decimal commas and every missing-value token', () => {
    const data = parseDataText('x\ty\n1,5\t2,25\nNA\t3\n.\tn/a\nNaN\t\n4,75\t1');
    expect(named(data.columns, 'x').values).toEqual([1.5, null, null, null, 4.75]);
    expect(named(data.columns, 'y').values).toEqual([2.25, 3, null, null, 1]);
    expect(data.problems).toEqual([]);
  });

  it('keeps the region decimal mark when the vote ties and reads semicolon files', () => {
    const data = parseDataText('a;b\n1,5;2\n3;4,5', { locale: DE_DE });
    expect(named(data.columns, 'a').values).toEqual([1.5, 3]);
    expect(named(data.columns, 'b').values).toEqual([2, 4.5]);
  });

  it('reads a single line as one column of values, and whitespace-separated columns', () => {
    expect(parseDataText('3, 1, 4, 1, 5').columns[0].values).toEqual([3, 1, 4, 1, 5]);
    const spaced = parseDataText('1 2\n3 4\n5 6');
    expect(spaced.columns.map((c) => c.name)).toEqual(['A', 'B']);
    expect(spaced.columns[1].values).toEqual([2, 4, 6]);
  });
});

describe('reading units and dates', () => {
  it('reads units, percents and dates, and reports cells it could not read', () => {
    const text = [
      'mass,share,day',
      '12.5 kg,10%,2024-03-01',
      '13 kg,20%,2024-03-02',
      'lost,5%,2024-03-04',
      '9 kg,1%,x',
      '8 kg,2%,2024-03-09',
    ].join('\n');
    const data = parseDataText(text);
    const mass = named(data.columns, 'mass');
    expect(mass.kind === 'number' && mass.unit).toBe('kg');
    expect(mass.values).toEqual([12.5, 13, null, 9, 8]);
    const share = named(data.columns, 'share');
    expect(share.kind === 'number' && share.unit).toBe('%');
    expect(named(data.columns, 'day').kind).toBe('date');
    expect(data.problems).toEqual([
      { column: 'mass', row: 3, text: 'lost' },
      { column: 'day', row: 4, text: 'x' },
    ]);
  });
});

describe('data set shape', () => {
  it('caps the rows and says so', () => {
    expect(MAX_ROWS).toBe(100_000);
    const text = ['v', ...Array.from({ length: 12 }, (_, i) => String(i))].join('\n');
    const data = parseDataText(text, { maxRows: 10 });
    expect(data.rows).toBe(10);
    expect(data.truncated).toBe(true);
  });

  it('guesses headers only when the first row looks like names', () => {
    expect(parseDataText('1,2\n3,4').columns[0].values).toEqual([1, 3]);
    expect(parseDataText('1,2\n3,4', { header: 'yes' }).columns.map((c) => c.name)).toEqual(['1', '2']);
    const words = dataFromGrid([['species'], ['cat'], ['dog'], ['cat']]);
    expect(words.columns[0].name).toBe('species');
    expect(dataFromGrid([['cat'], ['dog'], ['cat']]).columns[0].name).toBe('A');
    expect(
      dataFromGrid([
        ['x', 'x'],
        ['1', '2'],
      ]).columns.map((c) => c.name),
    ).toEqual(['x', 'x (2)']);
  });

  it('keeps complete rows for paired analyses', () => {
    const data = parseDataText('a,b\n1,2\n,3\n4,\n5,6');
    expect(completeRows(data, ['a', 'b'])).toEqual({ rows: [0, 3], dropped: 2 });
  });

  it('converts a column to another kind', () => {
    const numbers: DataColumn = { name: 'code', kind: 'number', values: [1, 2, null, 1], unit: null };
    expect(convertColumn(numbers, 'category').column.values).toEqual(['1', '2', null, '1']);
    const labels: DataColumn = { name: 'v', kind: 'text', values: ['1.5', 'x', null] };
    const back = convertColumn(labels, 'number');
    expect(back.column.values).toEqual([1.5, null, null]);
    expect(back.problems).toEqual([{ column: 'v', row: 2, text: 'x' }]);
    expect(readNumber('−3.5', { decimal: '.', group: ',' })).toEqual({ value: -3.5, unit: null });
  });
});

const TABLE_BLOCK = {
  id: 't1',
  type: 'table',
  data: {
    header: true,
    columns: [{ id: 'c1' }, { id: 'c2' }],
    rows: [
      { id: 'r0', cells: { c1: { markdown: '**dose**' }, c2: { markdown: 'response' } } },
      { id: 'r1', cells: { c1: { markdown: '1' }, c2: { markdown: '2\\.5' } } },
      { id: 'r2', cells: { c1: { markdown: '2' } } },
    ],
  },
};

describe('tables on the page', () => {
  it('lists table blocks as grids with their header row', () => {
    const tables = tablesOf([{ id: 'p', type: 'text', data: {} }, TABLE_BLOCK]);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ id: 't1', number: 1, header: ['dose', 'response'] });
    const data = dataFromGrid(gridOf(tables[0]), { header: 'yes' });
    expect(named(data.columns, 'response').values).toEqual([2.5, null]);
    expect(plainCell('_a_ `b` \\*c')).toBe('a b *c');
  });
});

describe('long and wide form', () => {
  const wide = parseDataText('subject,pre,post\ns1,10,12\ns2,11,15');
  const names = { key: 'time', value: 'score' };

  it('stacks measures into one value column and back again', () => {
    const long = stack(wide, ['subject'], ['pre', 'post'], names);
    expect(long.rows).toBe(4);
    expect(named(long.columns, 'subject').values).toEqual(['s1', 's2', 's1', 's2']);
    expect(named(long.columns, 'time').values).toEqual(['pre', 'pre', 'post', 'post']);
    expect(named(long.columns, 'score').values).toEqual([10, 11, 12, 15]);
    const again = unstack(long, ['subject'], 'time', 'score');
    expect(again.columns.map((c) => c.name)).toEqual(['subject', 'pre', 'post']);
    expect(named(again.columns, 'post').values).toEqual([12, 15]);
  });

  it('refuses a measure that is not numbers and a duplicated cell', () => {
    expect(() => stack(wide, [], ['subject'], names)).toThrow(SubjectError);
    const doubled = parseDataText('id,k,v\na,x,1\na,x,2');
    expect(() => unstack(doubled, ['id'], 'k', 'v')).toThrow(SubjectError);
  });
});
