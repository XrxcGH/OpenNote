import { describe, expect, it } from 'vitest';
import { buildChartSpec, deriveChartData, lttb, type ChartConfig, type Point } from './chart';
import { createTable } from './edit';
import { viewIndices } from './filter';
import { EN_US } from './locale';
import type { Table } from './model';

const DATE = 0;
const CATEGORY = 1;
const AMOUNT = 2;

/** Sales rows, deliberately out of date order, with a repeated category and a bad amount. */
function sales(): Table {
  return createTable(
    [
      { name: 'Date', type: 'date' },
      { name: 'Category', type: 'text' },
      { name: 'Amount', type: 'currency' },
      { name: 'Qty', type: 'number' },
    ],
    [
      ['2026-03-01', 'Seeds', '30', '3'],
      ['2026-01-01', 'Soil', '10', '1'],
      ['2026-02-01', 'Seeds', '20', '2'],
      ['2026-02-15', 'Tools', 'n/a', '4'],
      ['', 'Tools', '5', '5'],
    ],
    EN_US,
  );
}

const all = (table: Table): number[] => table.rows.map((_, i) => i);
const config = (extra: Partial<ChartConfig> = {}): ChartConfig => ({
  kind: 'bar',
  x: CATEGORY,
  series: [AMOUNT],
  ...extra,
});

function many(n: number, valueOf: (i: number) => number): Table {
  return createTable(
    [
      { name: 'Day', type: 'number' },
      { name: 'Value', type: 'number' },
    ],
    Array.from({ length: n }, (_, i) => [String(i), String(valueOf(i))]),
    EN_US,
  );
}

describe('deriving series', () => {
  it('reads rows in view order, skips empty x and non-numbers, and counts what it skipped', () => {
    const table = sales();
    const data = deriveChartData(
      table,
      all(table),
      { kind: 'bar', x: CATEGORY, series: [AMOUNT], maxBars: 100, maxPoints: 100, otherLabel: 'Other' },
      EN_US,
    );
    expect(data.series[0].points).toEqual([
      { x: 'Seeds', y: 30 },
      { x: 'Soil', y: 10 },
      { x: 'Seeds', y: 20 },
      { x: 'Tools', y: 5 },
    ]);
    expect(data.notes).toEqual([{ code: 'skipped', shown: 0, total: 1 }]);
  });

  it.each([
    [
      'sum',
      [
        { x: 'Seeds', y: 50 },
        { x: 'Soil', y: 10 },
        { x: 'Tools', y: 5 },
      ],
    ],
    [
      'average',
      [
        { x: 'Seeds', y: 25 },
        { x: 'Soil', y: 10 },
        { x: 'Tools', y: 5 },
      ],
    ],
    [
      'count',
      [
        { x: 'Seeds', y: 2 },
        { x: 'Soil', y: 1 },
        { x: 'Tools', y: 1 },
      ],
    ],
    [
      'min',
      [
        { x: 'Seeds', y: 20 },
        { x: 'Soil', y: 10 },
        { x: 'Tools', y: 5 },
      ],
    ],
    [
      'max',
      [
        { x: 'Seeds', y: 30 },
        { x: 'Soil', y: 10 },
        { x: 'Tools', y: 5 },
      ],
    ],
  ] as const)('combines repeated x values with %s, in order of first appearance', (aggregate, expected) => {
    const table = sales();
    const spec = buildChartSpec(table, all(table), config({ aggregate }), EN_US);
    expect(spec.data.series[0].points).toEqual(expected);
  });

  it('sorts line and area charts by a date or number x, and keeps bars in table order', () => {
    const table = sales();
    const line = buildChartSpec(table, all(table), config({ kind: 'line', x: DATE }), EN_US);
    const days = line.data.series[0].points.map((p) => p.x as number);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(line.data.xKind).toBe('date');
    const bar = buildChartSpec(table, all(table), config({ x: DATE }), EN_US);
    expect(bar.data.xKind).toBe('text');
    expect(bar.data.series[0].points.map((p) => p.x)).toEqual(['Mar 1, 2026', 'Jan 1, 2026', 'Feb 1, 2026']);
  });

  it('follows the rows a table shows, so sorting ranks the bars and a filter removes them', () => {
    const table = sales();
    const ranked = viewIndices(table, { sort: [{ column: AMOUNT, desc: true }] }, EN_US);
    const bars = buildChartSpec(table, ranked, config(), EN_US).data.series[0].points.map((p) => p.y);
    expect(bars).toEqual([30, 20, 10, 5]);
    const filtered = viewIndices(table, { filters: [{ column: CATEGORY, op: 'eq', value: 'Seeds' }] }, EN_US);
    expect(buildChartSpec(table, filtered, config(), EN_US).data.series[0].points).toHaveLength(2);
  });

  it('gives equal data after sorting a table under a line chart, so the chart can skip the redraw', () => {
    const table = sales();
    const line = config({ kind: 'line', x: DATE });
    const before = buildChartSpec(table, all(table), line, EN_US).data;
    const sorted = viewIndices(table, { sort: [{ column: CATEGORY, desc: true }] }, EN_US);
    expect(buildChartSpec(table, sorted, line, EN_US).data).toEqual(before);
  });
});

describe('caps', () => {
  it('shows one bar per 3 units of plot width, and says how many were left out', () => {
    const table = many(1000, (i) => i);
    const spec = buildChartSpec(table, all(table), config({ x: 0, series: [1] }), EN_US);
    expect(spec.data.series[0].points).toHaveLength(186);
    expect(spec.notes).toContainEqual({ code: 'capped', shown: 186, total: 1000 });
    const narrow = buildChartSpec(table, all(table), config({ x: 0, series: [1], width: 340 }), EN_US);
    expect(narrow.data.series[0].points).toHaveLength(86);
    const horizontal = buildChartSpec(table, all(table), config({ x: 0, series: [1], horizontal: true }), EN_US);
    expect(horizontal.data.series[0].points).toHaveLength(98);
  });

  it('keeps every point of a scatter chart', () => {
    const table = many(1000, (i) => i * 2);
    const spec = buildChartSpec(table, all(table), config({ kind: 'scatter', x: 0, series: [1] }), EN_US);
    expect(spec.data.series[0].points).toHaveLength(1000);
    expect(spec.notes).toEqual([]);
  });

  it('reduces long lines to one point per unit of width and keeps the peak', () => {
    const table = many(10_000, (i) => (i === 4321 ? 1000 : Math.sin(i / 50)));
    const spec = buildChartSpec(table, all(table), config({ kind: 'line', x: 0, series: [1] }), EN_US);
    const points = spec.data.series[0].points;
    expect(points.length).toBeLessThanOrEqual(558);
    expect(points[0].x).toBe(0);
    expect(points[points.length - 1].x).toBe(9999);
    expect(points.some((p) => p.y === 1000)).toBe(true);
    expect(spec.notes).toContainEqual({ code: 'reduced', shown: 558, total: 10_000 });
  });

  it('leaves short series alone', () => {
    const points: Point[] = [1, 3, 2, 5, 4].map((y, x) => ({ x, y }));
    expect(lttb(points, 10)).toEqual(points);
    expect(lttb(points, 2)).toEqual(points);
  });
});

describe('pie', () => {
  function categories(n: number): Table {
    return createTable(
      [{ name: 'Name' }, { name: 'Share', type: 'number' }],
      Array.from({ length: n }, (_, i) => [`N${i}`, String(i % 2 === 0 ? 100 - i : 1 + i)]),
      EN_US,
    );
  }

  it('shows the largest six in table order, then the rest as Other', () => {
    const table = categories(10);
    const spec = buildChartSpec(table, all(table), config({ kind: 'pie', x: 0, series: [1] }), EN_US);
    const slices = spec.pie ?? [];
    expect(slices).toHaveLength(7);
    expect(slices[6].label).toBe('Other');
    expect(slices.map((s) => s.label).slice(0, 6)).toEqual(['N0', 'N2', 'N4', 'N6', 'N8', 'N9']);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(slices[0].startAngle).toBe(0);
    expect(slices[6].endAngle).toBeCloseTo(Math.PI * 2);
    expect(spec.plot).toBeNull();
    expect(spec.notes).toContainEqual({ code: 'other', shown: 6, total: 10 });
  });

  it('names the gathering slice from the interface, and drops values that are not positive', () => {
    const table = createTable(
      [{ name: 'N' }, { name: 'V', type: 'number' }],
      [
        ['a', '5'],
        ['b', '-2'],
        ['c', '0'],
        ['d', '5'],
      ],
      EN_US,
    );
    const spec = buildChartSpec(
      table,
      all(table),
      config({ kind: 'pie', x: 0, series: [1], otherLabel: 'Autre' }),
      EN_US,
    );
    expect(spec.pie?.map((s) => [s.label, s.share])).toEqual([
      ['a', 0.5],
      ['d', 0.5],
    ]);
    expect(spec.notes).toContainEqual({ code: 'skipped', shown: 0, total: 2 });
    const big = categories(12);
    const folded = buildChartSpec(
      big,
      all(big),
      config({ kind: 'pie', x: 0, series: [1], otherLabel: 'Autre' }),
      EN_US,
    );
    expect(folded.pie?.[6].label).toBe('Autre');
  });

  it('uses one series only, with a legend of names and shares', () => {
    const table = categories(3);
    const spec = buildChartSpec(table, all(table), config({ kind: 'pie', x: 0, series: [1, 1] }), EN_US);
    expect(spec.data.series).toHaveLength(1);
    expect(spec.legend.map((l) => l.name)).toEqual(['N0', 'N1', 'N2']);
    expect(spec.legend.every((l) => typeof l.share === 'number')).toBe(true);
  });
});
