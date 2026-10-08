import { describe, expect, it } from 'vitest';
import {
  MAX_SERIES,
  SLOTS,
  buildChartSpec,
  chartConfigFor,
  chartDefaults,
  realizePlot,
  type ChartConfig,
  type PlotMarks,
} from './chart';
import { createTable } from './edit';
import { EN_US, DE_DE } from './locale';
import type { Table } from './model';

/** Four numeric columns over five days, so a chart can have from one to four series. */
function readings(): Table {
  return createTable(
    [
      { name: 'Day', type: 'date' },
      { name: 'Seeds', type: 'number' },
      { name: 'Soil', type: 'number' },
      { name: 'Tools', type: 'number' },
      { name: 'Pots', type: 'number' },
    ],
    [
      ['2026-01-01', '1', '2', '3', '4'],
      ['2026-01-02', '2', '3', '4', '5'],
      ['2026-01-03', '3', '4', '5', '6'],
    ],
    EN_US,
  );
}

const all = (t: Table): number[] => t.rows.map((_, i) => i);
const build = (extra: Partial<ChartConfig>, table = readings(), locale = EN_US) =>
  buildChartSpec(table, all(table), { kind: 'line', x: 0, series: [1], ...extra }, locale);

describe('bar marks', () => {
  it('draws one series as one mark filled with the first palette slot, over a zero rule', () => {
    const spec = build({ kind: 'bar' });
    expect(spec.plot?.marks.map((m) => m.mark)).toEqual(['barY', 'ruleY']);
    expect(spec.plot?.marks[0].options).toMatchObject({ x: 'x', y: 'y', fill: 'var(--chart-s0)' });
    expect(spec.plot?.x).toMatchObject({ type: 'band', label: 'Day' });
    expect(spec.plot?.y).toMatchObject({ label: 'Seeds', grid: true });
  });

  it('groups several series with a facet and a color scale in palette order', () => {
    const spec = build({ kind: 'bar', series: [1, 2, 3] });
    const mark = spec.plot?.marks[0];
    expect(mark?.options).toMatchObject({ fx: 'x', x: 'series', y: 'y', fill: 'series' });
    expect(spec.plot?.color).toEqual({
      domain: ['Seeds', 'Soil', 'Tools'],
      range: ['var(--chart-s0)', 'var(--chart-s1)', 'var(--chart-s2)'],
      legend: false,
    });
    expect(spec.plot?.x).toMatchObject({ axis: null, domain: ['Seeds', 'Soil', 'Tools'] });
    expect(spec.plot?.fx).toMatchObject({ label: 'Day' });
    expect(spec.legend.map((l) => l.name)).toEqual(['Seeds', 'Soil', 'Tools']);
    expect((mark?.data as { series: string }[]).map((r) => r.series)).toHaveLength(9);
  });

  it('stacks on request, and runs horizontal with the axes swapped', () => {
    const stacked = build({ kind: 'bar', series: [1, 2], stacked: true });
    expect(stacked.plot?.marks[0].options).toMatchObject({ x: 'x', y: 'y', fill: 'series' });
    expect(stacked.plot?.marks[0].options.fx).toBeUndefined();
    const horizontal = build({ kind: 'bar', horizontal: true });
    expect(horizontal.plot?.marks.map((m) => m.mark)).toEqual(['barX', 'ruleX']);
    expect(horizontal.plot?.marks[0].options).toMatchObject({ y: 'x', x: 'y' });
    expect(horizontal.plot?.x).toMatchObject({ label: 'Seeds' });
    expect(horizontal.plot?.marginLeft).toBe(96);
  });
});

describe('line, area, and scatter marks', () => {
  it('draws a line per series, with dates as Date objects on a UTC scale', () => {
    const spec = build({ kind: 'line', series: [1, 2] });
    expect(spec.plot?.marks.map((m) => m.mark)).toEqual(['lineY', 'lineY']);
    expect(spec.plot?.x).toMatchObject({ type: 'utc', label: 'Day' });
    const first = spec.plot?.marks[0].data[0] as { x: Date; y: number };
    expect(first.x).toEqual(new Date(Date.UTC(2026, 0, 1)));
    expect(spec.plot?.marks[1].options).toMatchObject({ stroke: 'var(--chart-s1)' });
    expect(spec.plot?.marks[1].options.strokeDasharray).toBeUndefined();
  });

  it('uses a linear scale for a number x', () => {
    const table = createTable(
      [
        { name: 'X', type: 'number' },
        { name: 'Y', type: 'number' },
      ],
      [
        ['1', '2'],
        ['2', '4'],
      ],
      EN_US,
    );
    const spec = build({ kind: 'scatter', x: 0, series: [1] }, table);
    expect(spec.plot?.x).toMatchObject({ type: 'linear' });
    expect(spec.plot?.marks[0]).toMatchObject({ mark: 'dot', options: { symbol: 'circle', r: 3 } });
  });

  it('stacks areas on each other by default, and overlaps them when not stacked', () => {
    const stacked = build({ kind: 'area', series: [1, 2] });
    const [bottom, top] = stacked.plot?.marks.map((m) => m.data as { y1: number; y2: number }[]) ?? [];
    expect(bottom.map((r) => [r.y1, r.y2])).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    expect(top.map((r) => [r.y1, r.y2])).toEqual([
      [1, 3],
      [2, 5],
      [3, 7],
    ]);
    const overlap = build({ kind: 'area', series: [1, 2], stacked: false });
    expect(overlap.plot?.marks.map((m) => m.mark)).toEqual(['areaY', 'lineY', 'areaY', 'lineY']);
    expect(overlap.plot?.marks[0].options).toMatchObject({ fillOpacity: 0.35 });
  });

  it('formats value axis labels in the region, with percent and currency when the column says so', () => {
    const table = createTable(
      [{ name: 'D' }, { name: 'Amount', type: 'currency' }, { name: 'Rate', type: 'percent' }],
      [['a', '1500', '0.5']],
      EN_US,
    );
    const money = build({ kind: 'bar', x: 0, series: [1] }, table);
    expect((money.plot?.y.tickFormat as (n: number) => string)(1500)).toBe('$1.5K');
    const rate = build({ kind: 'bar', x: 0, series: [2] }, table, DE_DE);
    expect((rate.plot?.y.tickFormat as (n: number) => string)(0.5)).toMatch(/^50\s%$/);
  });
});

describe('palette, patterns, and color-blind support', () => {
  it('uses color alone for one to three series', () => {
    const spec = build({ kind: 'line', series: [1, 2, 3] });
    expect(spec.patterns).toBe(false);
    expect(spec.patternDefs).toEqual([]);
    expect(spec.legend.map((l) => l.paint)).toEqual(['var(--chart-s0)', 'var(--chart-s1)', 'var(--chart-s2)']);
    expect(spec.plot?.marks.map((m) => m.mark)).toEqual(['lineY', 'lineY', 'lineY']);
  });

  it('turns on patterns, dashes, and shapes from the fourth series', () => {
    const spec = build({ kind: 'line', series: [1, 2, 3, 4] });
    expect(spec.patterns).toBe(true);
    expect(spec.legend.map((l) => l.paint)).toEqual([
      'var(--chart-s0)',
      'url(#chart-pattern-1)',
      'url(#chart-pattern-2)',
      'url(#chart-pattern-3)',
    ]);
    expect(spec.patternDefs.map((d) => [d.id, d.kind, d.size])).toEqual([
      ['chart-pattern-1', 'diagonal', 8],
      ['chart-pattern-2', 'dots', 8],
      ['chart-pattern-3', 'horizontal', 8],
    ]);
    expect(spec.patternDefs[0]).toMatchObject({ background: 'var(--chart-s1)', line: 'var(--color-surface-page)' });
    const lines = spec.plot?.marks.filter((m) => m.mark === 'lineY') ?? [];
    expect(lines.map((m) => m.options.strokeDasharray)).toEqual([undefined, '6 3', '2 2', '8 3 2 3']);
    const dots = spec.plot?.marks.filter((m) => m.mark === 'dot') ?? [];
    expect(dots.map((m) => m.options.symbol)).toEqual(['circle', 'square', 'triangle', 'diamond']);
  });

  it('forces patterns for a single series on request, and scopes ids to the chart', () => {
    const spec = build({ kind: 'area', patterns: true, series: [1, 2], idPrefix: 'block7' });
    expect(spec.patterns).toBe(true);
    expect(spec.patternDefs.map((d) => d.id)).toEqual(['block7-pattern-1']);
    expect(spec.plot?.marks[1].options).toMatchObject({ fill: 'url(#block7-pattern-1)' });
  });

  it('has seven distinct slots of pens, patterns, dashes, and shapes', () => {
    expect(MAX_SERIES).toBe(7);
    expect(new Set(SLOTS.map((s) => s.pen)).size).toBe(7);
    expect(new Set(SLOTS.map((s) => s.pattern)).size).toBe(7);
    expect(new Set(SLOTS.map((s) => s.dash)).size).toBe(7);
    expect(new Set(SLOTS.map((s) => s.symbol)).size).toBe(7);
    expect(SLOTS.map((s) => s.cssVar)).toEqual(Array.from({ length: 7 }, (_, i) => `--chart-s${i}`));
    expect(SLOTS.every((s) => ['Ink', 'Indigo', 'Brick', 'Fern', 'Plum', 'Amber', 'Walnut'].includes(s.pen))).toBe(
      true,
    );
  });

  it('draws at most seven series, and patterns the pie slices from the fourth', () => {
    const cols = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, type: 'number' as const }));
    const wide = createTable([{ name: 'X' }, ...cols], [['a', ...cols.map((_, i) => String(i))]], EN_US);
    expect(build({ kind: 'bar', x: 0, series: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, wide).data.series).toHaveLength(7);
    const pie = createTable(
      [{ name: 'N' }, { name: 'V', type: 'number' }],
      ['a', 'b', 'c', 'd', 'e'].map((n, i) => [n, String(i + 1)]),
      EN_US,
    );
    const spec = build({ kind: 'pie', x: 0, series: [1] }, pie);
    expect(spec.patterns).toBe(true);
    expect(spec.pie?.[4].style.paint).toBe('url(#chart-pattern-4)');
  });
});

describe('realizing the options', () => {
  it('turns mark data into Plot marks without changing anything else', () => {
    const spec = build({ kind: 'bar' });
    const calls: string[] = [];
    const fake: PlotMarks = new Proxy({} as PlotMarks, {
      get: (_, name: string) => (data: readonly unknown[]) => {
        calls.push(`${name}:${data.length}`);
        return { mark: name };
      },
    });
    const options = realizePlot(fake, spec.plot!);
    expect(calls).toEqual(['barY:3', 'ruleY:1']);
    expect(options.marks).toEqual([{ mark: 'barY' }, { mark: 'ruleY' }]);
    expect(options.width).toBe(640);
    expect(options.style).toMatchObject({ '--plot-background': 'var(--color-surface-page)' });
  });
});

describe('two-click defaults', () => {
  const kindOf = (table: Table) => chartDefaults(table)?.kind;

  it('recommends a line for dates, a pie for a few categories, a bar for many, and a scatter for numbers', () => {
    expect(kindOf(readings())).toBe('line');
    const few = createTable(
      [{ name: 'N' }, { name: 'V', type: 'number' }],
      [
        ['a', '1'],
        ['b', '2'],
        ['c', '3'],
      ],
      EN_US,
    );
    expect(kindOf(few)).toBe('pie');
    const rows = Array.from({ length: 9 }, (_, i) => [`c${i}`, String(i)]);
    expect(kindOf(createTable([{ name: 'N' }, { name: 'V', type: 'number' }], rows, EN_US))).toBe('bar');
    const nums = createTable(
      [
        { name: 'X', type: 'number' },
        { name: 'Y', type: 'number' },
      ],
      [
        ['1', '2'],
        ['2', '3'],
      ],
      EN_US,
    );
    expect(kindOf(nums)).toBe('scatter');
    const two = createTable(
      [{ name: 'N' }, { name: 'A', type: 'number' }, { name: 'B', type: 'number' }],
      [
        ['a', '1', '2'],
        ['b', '3', '4'],
      ],
      EN_US,
    );
    expect(kindOf(two)).toBe('bar');
  });

  it('picks the first date column as x, else text, else number, and the other number columns as series', () => {
    const d = chartDefaults(readings());
    expect([d?.x, d?.series]).toEqual([0, [1, 2, 3, 4]]);
    const mixed = createTable(
      [{ name: 'Qty', type: 'number' }, { name: 'Name' }, { name: 'Price', type: 'currency' }],
      [['1', 'a', '2']],
      EN_US,
    );
    expect(chartDefaults(mixed)).toMatchObject({ x: 1, series: [0, 2] });
  });

  it('adds up rows that repeat an x, and orders the choices with the recommended one first', () => {
    const table = createTable(
      [{ name: 'N' }, { name: 'V', type: 'number' }],
      [
        ['a', '1'],
        ['a', '2'],
        ['b', '3'],
      ],
      EN_US,
    );
    const d = chartDefaults(table);
    expect(d?.aggregate).toBe('sum');
    expect(d?.choices[0]).toMatchObject({ kind: 'pie', recommended: true });
    expect(d?.choices.map((c) => c.kind)).toEqual(['pie', 'bar', 'line', 'area', 'scatter']);
    expect(chartDefaults(readings())?.aggregate).toBe('none');
  });

  it('disables kinds that cannot work, with a reason', () => {
    const text = createTable([{ name: 'A' }, { name: 'B' }], [['x', 'y']], EN_US);
    expect(chartDefaults(text)?.choices.every((c) => c.unavailable === 'needs-number-column')).toBe(true);
    expect(chartConfigFor(text)).toBeNull();
    const labeled = createTable(
      [{ name: 'N' }, { name: 'V', type: 'number' }],
      [
        ['a', '1'],
        ['b', '2'],
      ],
      EN_US,
    );
    expect(chartDefaults(labeled)?.choices.find((c) => c.kind === 'scatter')?.unavailable).toBe('needs-number-x');
    expect(chartConfigFor(labeled, 'scatter')).toBeNull();
    expect(chartDefaults({ columns: [], rows: [] })).toBeNull();
  });

  it('makes a config that builds a chart, using one series for a pie', () => {
    const table = readings();
    const config = chartConfigFor(table);
    expect(config).toMatchObject({ kind: 'line', x: 0, series: [1, 2, 3, 4] });
    expect(buildChartSpec(table, all(table), config!, EN_US).plot).not.toBeNull();
    expect(chartConfigFor(table, 'pie')?.series).toEqual([1]);
  });
});
