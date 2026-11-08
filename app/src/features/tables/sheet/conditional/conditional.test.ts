// checks-disable-file brand-consistency: the colors here are document data of the file format, not interface styling

// Conditional formats: the five lane tests, then the rule types, dates, formulas, and drawing. Expected values come
// from hand work: OKLab with Ottosson's published constants (written here as matrices, a different shape from
// oklab.ts), percentiles and averages worked on paper, and spreadsheet serial days counted from 2000-01-01 = 36526.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveColor } from '../../../../ui/color/parse';
import { resolve } from '../model/resolve';
import { setLayerScheme } from '../model/rules';
import { intern } from '../model/styles';
import { K, R, range } from '../model/testing';
import type { CellStyle, Sheet, TableLike } from '../model/types';
import { conditionalLayer, drawnLayer, barCss } from './layer';
import { hexToLab, labToHex } from './oklab';
import { setToday } from './match';
import { setFormulaEvaluator } from './formula';
import { ICON_SETS } from './visual';

const COL = K(1);
const rowsOf = (values: (string | number)[], more: Record<string, string>[] = []): TableLike => ({
  header: false,
  columns: [{ id: COL }, ...more.map((_, i) => ({ id: K(i + 2) }))],
  rows: values.map((v, i) => ({
    id: R(i + 1),
    cells: {
      [COL]: { markdown: String(v) },
      ...Object.fromEntries(more.map((m, j) => [K(j + 2), { markdown: m[i] ?? '' }])),
    },
  })),
});
const withRules = (rules: Record<string, object>): Sheet => ({
  conditional: Object.fromEntries(Object.entries(rules).map(([id, r]) => [id, { ranges: [{ col: COL }], ...r }])),
});
const styleRef = (sheet: Sheet, style: CellStyle): string => {
  const id = intern(sheet, style);
  if (!id) throw new Error('empty style');
  return id;
};
const at = (sheet: Sheet, table: TableLike, row: number, col = COL) =>
  resolve(sheet, table, R(row), col, { conditional: conditionalLayer }).style;
const fills = (sheet: Sheet, table: TableLike) => table.rows.map((_, i) => at(sheet, table, i + 1).fill);

const RED: CellStyle = { fill: '#ff0000' };
const BLUE: CellStyle = { fill: '#0000ff' };

beforeEach(() => setLayerScheme('light'));
afterEach(() => {
  setToday(null);
  setFormulaEvaluator();
});

/** OKLab by Ottosson's published matrices, written as matrix products. */
function oklabByMatrix(hex: string): number[] {
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const M1 = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
  ];
  const M2 = [
    [0.2104542553, 0.793617785, -0.0040720468],
    [1.9779984951, -2.428592205, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.808675766],
  ];
  const lms = M1.map((row) => Math.cbrt(row.reduce((s, m, j) => s + m * lin[j], 0)));
  return M2.map((row) => row.reduce((s, m, j) => s + m * lms[j], 0));
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('color scales', () => {
  const brick = resolveColor('brick', 'light') as string;
  const amber = resolveColor('amber', 'light') as string;
  const fern = resolveColor('fern', 'light') as string;
  const stops = [
    { at: 'min', color: 'brick' },
    { at: 'percentile', value: '50', color: 'amber' },
    { at: 'max', color: 'fern' },
  ];
  const sheet = withRules({ c1: { order: 1, type: 'scale', stops } });
  const table = rowsOf([...range(1, 10), 5.5]);

  it('draws the end, middle, and end colors, and OKLab mixes in between', () => {
    expect(at(sheet, table, 1).fill).toBe(brick);
    expect(at(sheet, table, 11).fill).toBe(amber); // 5.5 is the 50th percentile of 1..10 and 5.5
    expect(at(sheet, table, 10).fill).toBe(fern);
    // 3 is (3 - 1) / (5.5 - 1) of the way from brick to amber.
    const t = (3 - 1) / (5.5 - 1);
    const a = oklabByMatrix(brick);
    const b = oklabByMatrix(amber);
    const mixed = a.map((x, i) => x + (b[i] - x) * t);
    const got = hexToLab(at(sheet, table, 3).fill as string) as number[];
    got.forEach((x, i) => expect(x).toBeCloseTo(mixed[i], 2));
    // The byte values agree with the mix of the independent lab values to one step.
    const want = channels(labToHex(mixed as [number, number, number]));
    channels(at(sheet, table, 3).fill as string).forEach((x, i) =>
      expect(Math.abs(x - want[i])).toBeLessThanOrEqual(1),
    );
  });

  it('skips text and blank cells, and the header row', () => {
    const t = rowsOf(['Name', 1, 'x', '', 3]);
    const s = withRules({ c1: { order: 1, type: 'scale', stops: stops.slice(0, 1).concat(stops.slice(2)) } });
    expect(at(s, { ...t, header: true }, 1).fill).toBeUndefined();
    expect(at(s, t, 3).fill).toBeUndefined();
    expect(at(s, t, 4).fill).toBeUndefined();
  });

  it('follows the dark scheme', () => {
    setLayerScheme('dark');
    expect(at(sheet, table, 1).fill).toBe(resolveColor('brick', 'dark'));
  });

  it('known OKLab values: white is 1, 0, 0 and black is 0', () => {
    expect(hexToLab('#ffffff')?.map((x) => Math.round(x * 1000) / 1000)).toEqual([1, 0, 0]);
    expect(hexToLab('#000000')).toEqual([0, 0, 0]);
  });
});

describe('top, bottom, and average', () => {
  it('top 10 percent of 1 to 20 is 19 and 20', () => {
    const sheet = withRules({ c1: { order: 1, type: 'top', rank: 10, percent: true } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    const table = rowsOf(range(1, 20));
    const hit = table.rows.flatMap((_, i) => (at(sheet, table, i + 1).fill ? [i + 1] : []));
    expect(hit).toEqual([19, 20]);
  });

  it('top 3 and bottom 2 items, with ties kept', () => {
    const sheet = withRules({
      c1: { order: 1, type: 'top', rank: 3 },
      c2: { order: 2, type: 'top', rank: 2, bottom: true },
    });
    sheet.styles = {};
    const c = sheet.conditional as Record<string, { style?: string }>;
    c.c1.style = styleRef(sheet, RED);
    c.c2.style = styleRef(sheet, BLUE);
    const table = rowsOf([5, 9, 1, 9, 3, 7, 1]);
    // top 3 of the sorted values 9, 9, 7 is everything at, or above, 7; bottom 2 is everything at or below 1.
    expect(fills(sheet, table)).toEqual([undefined, '#ff0000', '#0000ff', '#ff0000', undefined, '#ff0000', '#0000ff']);
  });

  it('above average of 1, 2, 3, and 10 is 10 only; below average is the three small ones', () => {
    const table = rowsOf([1, 2, 3, 10]);
    const above = withRules({ c1: { order: 1, type: 'average' } });
    above.styles = {};
    (above.conditional as Record<string, { style?: string }>).c1.style = styleRef(above, RED);
    expect(fills(above, table)).toEqual([undefined, undefined, undefined, '#ff0000']);
    const below = withRules({ c1: { order: 1, type: 'average', below: true } });
    below.styles = {};
    (below.conditional as Record<string, { style?: string }>).c1.style = styleRef(below, RED);
    expect(fills(below, table)).toEqual(['#ff0000', '#ff0000', '#ff0000', undefined]);
  });

  it('one standard deviation above the average: 1..9 has sample deviation sqrt(7.5)', () => {
    const sheet = withRules({ c1: { order: 1, type: 'average', stdDev: 1 } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    // average 5, deviation 2.7386, so the edge is 7.7386: only 8 and 9 are over it.
    const table = rowsOf(range(1, 9));
    expect(table.rows.flatMap((_, i) => (at(sheet, table, i + 1).fill ? [i + 1] : []))).toEqual([8, 9]);
  });
});

describe('priority and stop if true', () => {
  const build = (stop: boolean) => {
    const sheet = withRules({
      c1: { order: 1, type: 'formula', a: 'A1>5', stop },
      c2: { order: 2, type: 'cell', op: 'greater', a: '0' },
    });
    sheet.styles = {};
    const c = sheet.conditional as Record<string, { style?: string }>;
    c.c1.style = styleRef(sheet, { font: { bold: true } });
    c.c2.style = styleRef(sheet, BLUE);
    return sheet;
  };
  const table = rowsOf([3, 8]);

  it('a matching rule with stop prevents the fill of a lower rule', () => {
    const sheet = build(true);
    expect(at(sheet, table, 2).font?.bold).toBe(true);
    expect(at(sheet, table, 2).fill).toBeUndefined();
    expect(at(sheet, table, 1).fill).toBe('#0000ff'); // 3 does not match the formula, so the lower rule applies
  });

  it('without stop both apply, and the lower number wins a clash', () => {
    const sheet = build(false);
    expect(at(sheet, table, 2).font?.bold).toBe(true);
    expect(at(sheet, table, 2).fill).toBe('#0000ff');
    sheet.conditional = {
      c1: { ...(sheet.conditional as Record<string, object>).c1, order: 2 },
      c2: { ...(sheet.conditional as Record<string, object>).c2, order: 1 },
    };
    const red = styleRef(sheet, RED);
    (sheet.conditional as Record<string, { style?: string }>).c1.style = red;
    expect(at(sheet, table, 2).fill).toBe('#0000ff'); // order 1 (c2) beats order 2 (c1)
  });
});

describe('data bars', () => {
  const bar = {
    order: 1,
    type: 'bar',
    color: 'indigo',
    min: { at: 'num', value: '0' },
    max: { at: 'num', value: '100' },
  };
  const decorate = (sheet: Sheet, table: TableLike, row: number) =>
    drawnLayer({ row: row - 1, col: 0 }, sheet, table, 'light');

  it('0 to 100 with 25 draws a bar 25 percent wide from the left edge', () => {
    const sheet = withRules({ c1: bar });
    const table = rowsOf([25, 100, 0]);
    const d = decorate(sheet, table, 1);
    expect(d?.data['data-bar']).toBe('right');
    expect(d?.vars['--cell-bar']).toContain('25%');
    expect(decorate(sheet, table, 2)?.vars['--cell-bar']).toContain('100%');
  });

  it('a negative value draws left of the axis', () => {
    const sheet = withRules({ c1: { ...bar, min: { at: 'num', value: '-50' }, max: { at: 'num', value: '50' } } });
    const table = rowsOf([-25, 25]);
    expect(decorate(sheet, table, 1)?.data['data-bar']).toBe('left');
    expect(decorate(sheet, table, 2)?.data['data-bar']).toBe('right');
    expect(decorate(sheet, table, 1)?.vars['--cell-bar']).toContain('to left');
  });

  it('automatic ends include zero; bar only hides the value; border and solid fill', () => {
    const sheet = withRules({
      c1: { order: 1, type: 'bar', color: 'fern', barOnly: true, gradient: false, border: 'ink' },
    });
    const table = rowsOf([2, 4]);
    const d = decorate(sheet, table, 1);
    expect(d?.data['data-bar-only']).toBe('');
    expect(d?.vars['--cell-bar']).toContain('50%');
    expect(decorate(sheet, rowsOf(['text']), 1)).toBeUndefined();
  });

  it('barCss keeps the bar inside the cell', () => {
    const css = barCss({
      left: 40,
      width: 60,
      side: 'right',
      axis: 40,
      color: '#336699',
      gradient: true,
      barOnly: false,
    });
    expect(css).toContain('transparent 0 40%');
  });
});

describe('icon sets', () => {
  it('3 arrows on 1, 50, and 99 give down, side, and up, each with its text', () => {
    const sheet = withRules({ c1: { order: 1, type: 'icons', set: '3Arrows' } });
    const table = rowsOf([1, 50, 99]);
    const d = [1, 2, 3].map((r) => drawnLayer({ row: r - 1, col: 0 }, sheet, table, 'light'));
    expect(d.map((x) => x?.data['data-icon-glyph'])).toEqual(['▼', '▶', '▲']);
    expect(d.map((x) => x?.data['data-icon-text'])).toEqual(['Down arrow', 'Sideways arrow', 'Up arrow']);
    expect(d[0]?.vars['--cell-icon-color']).toBe(resolveColor('brick', 'light'));
  });

  it('reverse, icon only, and numeric thresholds with gte false', () => {
    const sheet = withRules({
      c1: {
        order: 1,
        type: 'icons',
        set: '3Arrows',
        reverse: true,
        iconOnly: true,
        thresholds: [
          { at: 'num', value: '10' },
          { at: 'num', value: '20', gte: false },
        ],
      },
    });
    const table = rowsOf([5, 10, 20, 21]);
    const idx = [1, 2, 3, 4].map(
      (r) => drawnLayer({ row: r - 1, col: 0 }, sheet, table, 'light')?.data['data-icon-index'],
    );
    // Without reverse: 5 -> 0, 10 -> 1, 20 -> 1 (not above 20), 21 -> 2. Reversed: 2, 1, 1, 0.
    expect(idx).toEqual(['2', '1', '1', '0']);
    expect(drawnLayer({ row: 0, col: 0 }, sheet, table, 'light')?.data['data-icon-only']).toBe('');
  });

  it('every set has icons from 3 to 5 with text', () => {
    for (const [name, set] of Object.entries(ICON_SETS)) {
      expect(set.length).toBe(Number(name[0]));
      set.forEach((icon) => expect(icon.text().length).toBeGreaterThan(0));
    }
    expect(Object.keys(ICON_SETS)).toHaveLength(13);
  });

  it('5 quarters have level text', () => {
    expect(ICON_SETS['5Quarters'][2].text()).toBe('Quarter fill 3 of 5');
  });
});

describe('other rule types', () => {
  const run = (rule: object, values: (string | number)[], extra?: Record<string, string>[]): number[] => {
    const sheet = withRules({ c1: { order: 1, ...rule } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    const table = rowsOf(values, extra);
    return table.rows.flatMap((_, i) => (at(sheet, table, i + 1).fill ? [i + 1] : []));
  };

  it('cell value operators', () => {
    const v = [1, 5, 10, 'x', ''];
    expect(run({ type: 'cell', op: 'greater', a: '4' }, v)).toEqual([2, 3, 4]); // text sorts after numbers
    expect(run({ type: 'cell', op: 'between', a: '2', b: '10' }, v)).toEqual([2, 3]);
    expect(run({ type: 'cell', op: 'notBetween', a: '2', b: '10' }, v)).toEqual([1, 4, 5]);
    expect(run({ type: 'cell', op: 'equal', a: '5' }, v)).toEqual([2]);
    expect(run({ type: 'cell', op: 'notEqual', a: '5' }, v)).toEqual([1, 3, 4, 5]);
    expect(run({ type: 'cell', op: 'lessOrEqual', a: '5' }, v)).toEqual([1, 2, 5]);
    expect(run({ type: 'cell', op: 'equal', a: '"X"' }, v)).toEqual([4]); // text compares without case
  });

  it('text rules ignore case and skip blanks', () => {
    const v = ['Apple', 'banana', 'Grape', ''];
    expect(run({ type: 'text', op: 'contains', text: 'AP' }, v)).toEqual([1, 3]);
    expect(run({ type: 'text', op: 'notContains', text: 'ap' }, v)).toEqual([2]);
    expect(run({ type: 'text', op: 'begins', text: 'b' }, v)).toEqual([2]);
    expect(run({ type: 'text', op: 'ends', text: 'E' }, v)).toEqual([1, 3]);
  });

  it('blanks, errors, duplicates, and unique values', () => {
    const v = ['a', '', 'A', '#N/A', 'b', '#DIV/0!'];
    expect(run({ type: 'blank' }, v)).toEqual([2]);
    expect(run({ type: 'noBlank' }, v)).toEqual([1, 3, 4, 5, 6]);
    expect(run({ type: 'error' }, v)).toEqual([4, 6]);
    expect(run({ type: 'noError' }, v)).toEqual([1, 2, 3, 5]);
    expect(run({ type: 'duplicate' }, v)).toEqual([1, 3]);
    expect(run({ type: 'unique' }, v)).toEqual([4, 5, 6]);
  });

  it('a rule on more than one range counts them together', () => {
    const sheet = withRules({ c1: { order: 1, type: 'duplicate', ranges: [{ col: COL }, { col: K(2) }] } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    const table = rowsOf(['a', 'b'], [{ 0: 'b', 1: 'c' }]);
    expect(at(sheet, table, 2).fill).toBe('#ff0000');
    expect(at(sheet, table, 1).fill).toBeUndefined();
    expect(at(sheet, table, 1, K(2)).fill).toBe('#ff0000');
  });

  it('an unknown rule type and a missing style do nothing harmful', () => {
    expect(run({ type: 'future' }, [1, 2])).toEqual([]);
    const sheet = withRules({ c1: { order: 1, type: 'blank' } });
    expect(at(sheet, rowsOf(['']), 1).fill).toBeUndefined();
  });
});

describe('dates', () => {
  // 2026-11-08 is a Sunday. Serial 46334: 2026-01-01 is 36526 + 26 * 365 + 7 leap days = 46023, plus 311 days.
  const TODAY = 46334;
  const day = (offset: number) => {
    const d = new Date(Date.UTC(2026, 10, 8 + offset));
    return d.toISOString().slice(0, 10);
  };
  const dates = [-8, -7, -2, -1, 0, 1, 6, 7, -20, 30].map(day);
  const run = (period: string): number[] => {
    setToday(() => TODAY);
    const sheet = withRules({ c1: { order: 1, type: 'date', period } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    const table = rowsOf(dates);
    return table.rows.flatMap((_, i) => (at(sheet, table, i + 1).fill ? [i + 1] : []));
  };

  it('reads an ISO date as the serial day', () => {
    setToday(() => TODAY);
    const sheet = withRules({ c1: { order: 1, type: 'date', period: 'today' } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    expect(at(sheet, rowsOf(['2026-11-08']), 1).fill).toBe('#ff0000');
  });

  it('days and weeks (weeks start on Sunday)', () => {
    expect(run('today')).toEqual([5]);
    expect(run('yesterday')).toEqual([4]);
    expect(run('tomorrow')).toEqual([6]);
    expect(run('last7Days')).toEqual([3, 4, 5]); // -2, -1, 0; -7 is eight days back counting today as one
    expect(run('thisWeek')).toEqual([5, 6, 7]); // Sunday the 8th to Saturday the 14th
    expect(run('lastWeek')).toEqual([2, 3, 4]); // Sunday the 1st to Saturday the 7th: -7, -2, -1
    expect(run('nextWeek')).toEqual([8]); // Sunday the 15th to Saturday the 21st: +7
  });

  it('months', () => {
    expect(run('thisMonth')).toEqual([2, 3, 4, 5, 6, 7, 8]); // November 1 to 15
    expect(run('lastMonth')).toEqual([1, 9]); // October 31 and October 19
    expect(run('nextMonth')).toEqual([10]); // +30 is December 8
  });
});

describe('formula rules', () => {
  const run = (a: string, table: TableLike): number[] => {
    const sheet = withRules({ c1: { order: 1, type: 'formula', a } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    return table.rows.flatMap((_, i) => (at(sheet, table, i + 1).fill ? [i + 1] : []));
  };

  it('references are relative to the first range top-left cell', () => {
    const table = rowsOf([1, 2, 3, 4], [{ 0: '5', 1: '1', 2: '9', 3: '2' }]);
    expect(run('A1>B1', table)).toEqual([2, 4]); // 2 > 1 and 4 > 2
    expect(run('B1>A1', table)).toEqual([1, 3]);
    expect(run('$B$1>A1', table)).toEqual([1, 2, 3, 4]); // B1 is 5, above every value of the first column
  });

  it('operators, functions, and text', () => {
    const table = rowsOf([1, 2, 3, 4, 5, 6]);
    expect(run('MOD(ROW(),2)=0', table)).toEqual([2, 4, 6]);
    expect(run('AND(A1>2,A1<5)', table)).toEqual([3, 4]);
    expect(run('OR(A1=1,A1=6)', table)).toEqual([1, 6]);
    expect(run('NOT(ISEVEN(A1))', table)).toEqual([1, 3, 5]);
    expect(run('A1*2+1>9', table)).toEqual([5, 6]);
    expect(run('IF(A1>3,TRUE,FALSE)', table)).toEqual([4, 5, 6]);
    expect(run('COUNTIF($A$1:$A$6,A1)>1', rowsOf([1, 2, 1]))).toEqual([1, 3]);
    expect(run('A1>AVERAGE($A$1:$A$6)', table)).toEqual([4, 5, 6]);
    expect(run('LEN(A1)>3', rowsOf(['ab', 'abcd']))).toEqual([2]);
    expect(run('A1&"x"="bx"', rowsOf(['a', 'b']))).toEqual([2]);
    expect(run('ISBLANK(A1)', rowsOf(['a', '']))).toEqual([2]);
  });

  it('a formula it cannot read matches nothing, and the engine can replace the evaluator', () => {
    const table = rowsOf([1, 2]);
    expect(run('SUM(', table)).toEqual([]);
    expect(run('NOSUCH(A1)', table)).toEqual([]);
    setFormulaEvaluator(() => ({ kind: 'bool', b: true }));
    expect(run('anything', table)).toEqual([1, 2]);
  });
});

describe('the rule applies to the right cells', () => {
  it('skips the header row and cells outside the ranges', () => {
    const sheet = withRules({ c1: { order: 1, type: 'cell', op: 'greater', a: '0' } });
    sheet.styles = {};
    (sheet.conditional as Record<string, { style?: string }>).c1.style = styleRef(sheet, RED);
    const table = { ...rowsOf([5, 5]), header: true };
    expect(at(sheet, table, 1).fill).toBeUndefined();
    expect(at(sheet, table, 2).fill).toBe('#ff0000');
  });
});
