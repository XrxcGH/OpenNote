import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { isSvg, kitFigureData, readKitFigure, svgDataUrl, SVG_LIMIT } from '../figure/model';
import {
  applyLongWide,
  emptyMatrix,
  missingRoles,
  readDataInput,
  readList,
  readMatrix,
  resizeMatrix,
  tableText,
} from './input';
import { rocArea } from './statPlots';
import { formatNumber } from './words';

describe('subject input helpers', () => {
  it('reads a list one value per line, skipping blanks and missing markers', () => {
    expect(readList('1.5\n\n-2\nNA\n3e2\nabc')).toEqual({
      values: [1.5, -2, 300],
      problems: [{ line: 6, text: 'abc' }],
    });
    expect(readList('3,25\n1,5').values).toEqual([3.25, 1.5]);
    expect(readList('')).toEqual({ values: [], problems: [] });
  });

  it('reads a matrix and reports the first cell that is not a number', () => {
    const m = {
      cells: [
        ['1', '2'],
        ['3', 'x'],
      ],
      rowLabels: ['a', 'b'],
      colLabels: ['c', 'd'],
    };
    expect(readMatrix(m)).toEqual({ ok: false, row: 2, column: 2 });
    expect(
      readMatrix({
        ...m,
        cells: [
          ['1', '2'],
          ['3', '-4.5'],
        ],
      }),
    ).toEqual({
      ok: true,
      values: [
        [1, 2],
        [3, -4.5],
      ],
    });
    const grown = resizeMatrix(m, 3, 1);
    expect(grown.cells).toEqual([['1'], ['3'], ['']]);
    expect(grown.rowLabels).toEqual(['a', 'b', 'R3']);
    expect(emptyMatrix(2, 2).colLabels).toEqual(['C1', 'C2']);
  });
});

describe('data, roles, and reshape helpers', () => {
  it('turns a page table into text a data field reads back the same', () => {
    const text = tableText({
      id: 't',
      number: 1,
      header: ['x', 'y'],
      rows: [
        ['1', '2'],
        ['3', '4\tz'],
      ],
    });
    expect(text).toBe('x\ty\n1\t2\n3\t4 z');
    const data = readDataInput({ text, table: 1 });
    expect(data.columns.map((c) => c.name)).toEqual(['x', 'y']);
    expect(data.rows).toBe(2);
    expect(readDataInput({ text: '   ' }).columns).toEqual([]);
  });

  it('lists the required roles still without a column of the right kind', () => {
    const data = readDataInput({ text: 'y\tg\n1\ta\n2\tb\n3\ta' });
    const roles = [
      { role: 'response' as const, kinds: ['number' as const] },
      { role: 'group' as const, kinds: ['category' as const, 'text' as const] },
      { role: 'weight' as const, optional: true },
    ];
    expect(missingRoles(data, roles, {})).toEqual(['response', 'group']);
    expect(missingRoles(data, roles, { response: 'g', group: 'g' })).toEqual(['response']);
    expect(missingRoles(data, roles, { response: 'y', group: 'g' })).toEqual([]);
  });

  it('stacks and spreads through the reshape switch and names a missing column', () => {
    const wide = readDataInput({ text: 'id\tpre\tpost\na\t1\t2\nb\t3\t4' });
    const long = applyLongWide(wide, {
      mode: 'stack',
      ids: ['id'],
      measures: ['pre', 'post'],
      keyName: 'when',
      valueName: 'v',
    });
    expect(long.rows).toBe(4);
    const back = applyLongWide(long, { mode: 'unstack', ids: ['id'], key: 'when', value: 'v' });
    expect(back.columns.map((c) => c.name)).toEqual(['id', 'pre', 'post']);
    expect(applyLongWide(wide, { mode: 'asIs' })).toBe(wide);
    expect(() => applyLongWide(wide, { mode: 'unstack', ids: [], key: 'gone', value: 'pre' })).toThrow(SubjectError);
  });
});

describe('figure and output helpers', () => {
  it('keeps only a real SVG of reasonable size in a figure', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    expect(isSvg(svg)).toBe(true);
    expect(isSvg('<div>no</div>')).toBe(false);
    const big = `<svg>${'x'.repeat(SVG_LIMIT)}</svg>`;
    expect(kitFigureData({ kit: 'k', tool: 't', inputs: 1, svg: big, alt: 'a', summary: 's' }).svg).toBe('');
    const read = readKitFigure({ kit: 3, svg, alt: 'Tree', inputs: { n: 2 } });
    expect(read).toEqual({ kit: '', tool: '', inputs: { n: 2 }, svg, alt: 'Tree', summary: '' });
    expect(svgDataUrl('<svg>#</svg>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%3E%23%3C%2Fsvg%3E');
  });

  it('measures an ROC area by trapezoids and formats numbers for tables', () => {
    expect(
      rocArea([
        [0, 0],
        [0, 1],
        [1, 1],
      ]),
    ).toBe(1);
    expect(
      rocArea([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0.5);
    expect(
      rocArea([
        [0, 0],
        [0.5, 0.75],
        [1, 1],
      ]),
    ).toBeCloseTo(0.625, 12);
    expect(formatNumber(-0.000123456789)).toBe('−0.000123457');
    expect(formatNumber(1.5e12)).toBe('1.50000e+12');
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(0)).toBe('0');
  });
});
