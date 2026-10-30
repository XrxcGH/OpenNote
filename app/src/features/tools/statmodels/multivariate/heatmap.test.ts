// The clustered heat map against cases whose order and scaling can be worked out by hand: 2 clear row groups and
// 2 clear column groups, z-scores of a 3-row column, and the key's middle and ends.
import { describe, expect, it } from 'vitest';
import { PAGE } from '../kit/picture';
import { StatError } from '../kit/types';
import { clusteredHeatMap, heatMapDrawing, shade } from './heatmap';

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

// Rows 0 and 2 are alike, and so are rows 1 and 3; columns 0 and 2 are alike, and so are columns 1 and 3.
const X = [
  [10, 0, 11, 1],
  [0, 10, 1, 11],
  [10.5, 0.5, 11.5, 1.5],
  [0.5, 10.5, 1.5, 11.5],
];

const adjacent = (order: number[], a: number, b: number) => Math.abs(order.indexOf(a) - order.indexOf(b)) === 1;

describe('clustered heat map', () => {
  it('puts alike rows and alike columns side by side', () => {
    const map = clusteredHeatMap(X, 'average', 'euclidean', false);
    expect([...map.rowOrder].sort()).toEqual([0, 1, 2, 3]);
    expect(adjacent(map.rowOrder, 0, 2) && adjacent(map.rowOrder, 1, 3)).toBe(true);
    expect(adjacent(map.colOrder, 0, 2) && adjacent(map.colOrder, 1, 3)).toBe(true);
    // Rows 0 and 2 differ by 0.5 in each of 4 columns: distance sqrt(4 × 0.25) = 1, the first merge.
    expect(map.rowMerges[0].height).toBeCloseTo(1, 12);
  });

  it('standardizes each column to z-scores', () => {
    // The column 1, 2, 3 has mean 2 and sample standard deviation 1, so its z-scores are −1, 0, 1.
    const map = clusteredHeatMap(
      [
        [1, 5],
        [2, 9],
        [3, 4],
      ],
      'complete',
      'euclidean',
      true,
    );
    expect(map.values.map((r) => r[0])).toEqual([-1, 0, 1]);
    expect(map.mid).toBe(0);
  });

  it('centers the key of raw values on the middle of their range', () => {
    const map = clusteredHeatMap(X, 'single', 'manhattan', false);
    // The values run from 0 to 11.5, so the middle is 5.75 and the ends are 5.75 away.
    expect(map.mid).toBeCloseTo(5.75, 12);
    expect(map.half).toBeCloseTo(5.75, 12);
    expect(shade(map, 11.5)).toBeCloseTo(1, 12);
    expect(shade(map, 0)).toBeCloseTo(-1, 12);
    expect(shade(map, 5.75)).toBe(0);
  });

  it('says why it cannot draw some inputs', () => {
    expect(code(() => clusteredHeatMap([[1, 2]], 'ward', 'euclidean', false))).toBe('tooFewRows');
    expect(code(() => clusteredHeatMap([[1], [2]], 'ward', 'euclidean', false))).toBe('fewColumns');
    expect(
      code(() =>
        clusteredHeatMap(
          [
            [1, 3],
            [1, 4],
          ],
          'ward',
          'euclidean',
          true,
        ),
      ),
    ).toBe('constantColumn');
  });

  it('copes with huge and negative values', () => {
    const map = clusteredHeatMap(
      [
        [-1e12, 3e12],
        [2e12, -4e12],
        [5e11, 1e12],
      ],
      'ward',
      'euclidean',
      true,
    );
    expect(map.values.flat().every(Number.isFinite)).toBe(true);
  });

  it('draws every cell with its value and a key', () => {
    const map = clusteredHeatMap(X, 'average', 'euclidean', false);
    const svg = heatMapDrawing(
      map,
      ['a', 'b', 'c', 'd'],
      ['w', 'x', 'y', 'z'],
    )({
      palette: PAGE,
      say: (key) => key.split('.').pop() ?? key,
      prefix: 'kitStatModels.multivariate',
    });
    expect(svg.match(/<rect /g)?.length).toBe(1 + 16 + 16);
    expect(svg).toContain('>11.5<');
    expect(svg).toContain('low');
  });
});
