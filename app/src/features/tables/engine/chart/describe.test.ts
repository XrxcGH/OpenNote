// Words for a chart: its range, trend, highest and lowest points, the points to step through, and the data table.
import { describe, expect, it } from 'vitest';
import type { ChartData } from './data';
import { dataTable, describeChart, moveStep, stepAt } from './describe';

const data = (...ys: number[]): ChartData => ({
  xKind: 'text',
  xName: 'Month',
  notes: [],
  series: [{ column: 1, name: 'Sales', points: ys.map((y, i) => ({ x: `M${i + 1}`, y })) }],
});

describe('describing a chart', () => {
  it('reports range, extremes, and trend', () => {
    const facts = describeChart('line', data(2, 4, 6, 9, 12))!;
    expect(facts).toMatchObject({ min: 2, max: 12, count: 5, trend: 'rising' });
    expect(facts.highest).toEqual({ series: 'Sales', x: 'M5', y: 12 });
    expect(facts.lowest).toEqual({ series: 'Sales', x: 'M1', y: 2 });
    expect(describeChart('line', data(9, 7, 4, 3))!.trend).toBe('falling');
    expect(describeChart('line', data(5, 5, 5, 5))!.trend).toBe('steady');
    expect(describeChart('line', data(1, 9, 1, 9, 1, 9))!.trend).toBe('mixed');
    expect(describeChart('pie', data(1, 2, 3))!.trend).toBeNull();
    expect(describeChart('bar', data())).toBeNull();
  });
  it('steps through points with the arrow keys and stays inside the chart', () => {
    const two: ChartData = {
      ...data(1, 2, 3),
      series: [
        ...data(1, 2, 3).series,
        {
          column: 2,
          name: 'Costs',
          points: [
            { x: 'M1', y: 7 },
            { x: 'M2', y: 8 },
          ],
        },
      ],
    };
    expect(stepAt(two, 0, 1)).toEqual({ series: 'Sales', seriesIndex: 0, index: 1, x: 'M2', y: 2 });
    expect(moveStep(two, { series: 0, index: 2 }, 'ArrowRight')).toEqual({ series: 0, index: 2 });
    expect(moveStep(two, { series: 0, index: 2 }, 'ArrowDown')).toEqual({ series: 1, index: 1 });
    expect(moveStep(two, { series: 1, index: 0 }, 'ArrowUp')).toEqual({ series: 0, index: 0 });
    expect(moveStep(two, { series: 0, index: 1 }, 'End')).toEqual({ series: 0, index: 2 });
    expect(stepAt(two, 1, 5)).toBeNull();
  });
  it('lays the same data out as a table', () => {
    expect(dataTable(data(3, 4))).toEqual({
      head: ['Month', 'Sales'],
      rows: [
        ['M1', '3'],
        ['M2', '4'],
      ],
    });
  });
});
