// Broadcasting and fitting, from Excel's documented array rules. Expected arrays are worked by hand.

import { describe, expect, it } from 'vitest';
import { asArray, collapse, fitTo, itemAt, makeArray, map1, map2, mapN } from '.';
import { applyBinary } from '../formula/operators';
import { err, type Scalar } from '../values';

const grid = (rows: number, cols: number, data: Scalar[]) => makeArray(rows, cols, data);

describe('arrays', () => {
  it('pairs items of equal sizes and stretches a single row, column, or value', () => {
    const add = (a: Scalar, b: Scalar): Scalar => (a as number) + (b as number);
    expect(map2(grid(2, 2, [1, 2, 3, 4]), grid(2, 2, [10, 20, 30, 40]), add).data).toEqual([11, 22, 33, 44]);
    expect(map2(grid(2, 1, [1, 2]), grid(1, 2, [10, 20]), add).data).toEqual([11, 21, 12, 22]);
    expect(map2(grid(1, 3, [1, 2, 3]), 5, add).data).toEqual([6, 7, 8]);
  });

  it('fills #N/A where sizes do not match', () => {
    const r = map2(grid(3, 1, [1, 2, 3]), grid(2, 1, [1, 1]), (a, b) => applyBinary('+', a, b));
    expect(r.data).toEqual([2, 3, err('NA')]);
    expect(itemAt(grid(2, 2, [1, 2, 3, 4]), 2, 0)).toEqual(err('NA'));
  });

  it('maps one or many values, and collapses a single item', () => {
    expect(map1(grid(1, 2, [1, 2]), (v) => (v as number) * 2).data).toEqual([2, 4]);
    expect(
      mapN([grid(2, 1, [1, 2]), 10, grid(1, 1, [100])], (xs) => xs.reduce((a, b) => (a as number) + (b as number), 0))
        .data,
    ).toEqual([111, 112]);
    expect(collapse(grid(1, 1, [7]))).toBe(7);
    expect(asArray('a')).toEqual(grid(1, 1, ['a']));
  });

  it('fits a result into a fixed block as a legacy array formula does', () => {
    expect(fitTo(grid(2, 1, [1, 2]), 3, 1).data).toEqual([1, 2, err('NA')]);
    expect(fitTo(grid(1, 2, [1, 2]), 2, 2).data).toEqual([1, 2, 1, 2]);
    expect(fitTo(5, 2, 1).data).toEqual([5, 5]);
  });
});
