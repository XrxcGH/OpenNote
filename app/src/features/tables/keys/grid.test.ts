// The grid's spreadsheet moves, against hand-worked grids. Expected cells follow the documented behavior of
// Ctrl+arrow, Ctrl+End, Ctrl+A, and Enter in a selection (DESIGN.md section 11.2), worked out by hand.
import { describe, expect, it } from 'vitest';
import { address, boxOf, cycle, jump, lastUsed, region, step } from './grid';

// A 5 by 5 grid with data in A1:C3.
const DATA = [
  ['1', '2', '3', '', ''],
  ['4', '5', '6', '', ''],
  ['7', '8', '9', '', ''],
  ['', '', '', '', ''],
  ['', '', '', '', ''],
];

const A1 = { row: 0, column: 0 };

describe('the data edges', () => {
  it('jumps to the end of a run of data, then to the grid edge past it', () => {
    expect(jump(DATA, A1, 1, 0)).toEqual({ row: 2, column: 0 });
    expect(jump(DATA, A1, 0, 1)).toEqual({ row: 0, column: 2 });
    expect(jump(DATA, { row: 2, column: 0 }, 1, 0)).toEqual({ row: 4, column: 0 });
    expect(jump(DATA, { row: 4, column: 4 }, -1, 0)).toEqual({ row: 0, column: 4 });
  });

  it('jumps from an empty cell to the next filled one', () => {
    const gaps = [['a', '', '', 'b', 'c']];
    expect(jump(gaps, { row: 0, column: 0 }, 0, 1)).toEqual({ row: 0, column: 3 });
    expect(jump(gaps, { row: 0, column: 1 }, 0, 1)).toEqual({ row: 0, column: 3 });
    expect(jump(gaps, { row: 0, column: 3 }, 0, 1)).toEqual({ row: 0, column: 4 });
    expect(jump(gaps, { row: 0, column: 4 }, 0, 1)).toEqual({ row: 0, column: 4 });
  });

  it('finds the last used cell and the region around a cell', () => {
    expect(lastUsed(DATA)).toEqual({ row: 2, column: 2 });
    expect(
      lastUsed([
        ['', ''],
        ['', ''],
      ]),
    ).toEqual(A1);
    expect(region(DATA, { row: 1, column: 1 })).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
    expect(region(DATA, { row: 4, column: 4 })).toEqual({ top: 4, left: 4, bottom: 4, right: 4 });
    // A diagonal neighbor joins the region.
    expect(
      region(
        [
          ['a', ''],
          ['', 'b'],
        ],
        A1,
      ),
    ).toEqual({ top: 0, left: 0, bottom: 1, right: 1 });
  });

  it('keeps a step inside the grid', () => {
    expect(step(DATA, A1, -1, 0)).toEqual(A1);
    expect(step(DATA, { row: 4, column: 4 }, 3, 3)).toEqual({ row: 4, column: 4 });
  });
});

describe('a range', () => {
  const box = boxOf({ row: 1, column: 1 }, { row: 2, column: 2 });

  it('goes down each column with Enter, then on to the next column, and wraps', () => {
    const order = [{ row: 1, column: 1 }];
    for (let i = 0; i < 4; i++) order.push(cycle(box, order[order.length - 1], 'column'));
    expect(order.map((at) => address(at, false))).toEqual(['B2', 'B3', 'C2', 'C3', 'B2']);
    expect(address(cycle(box, { row: 1, column: 1 }, 'column', true), false)).toBe('C3');
  });

  it('goes along each row with Tab', () => {
    expect(address(cycle(box, { row: 1, column: 1 }, 'row'), false)).toBe('C2');
    expect(address(cycle(box, { row: 1, column: 2 }, 'row'), false)).toBe('B3');
  });
});

describe('addresses', () => {
  it('numbers rows from 1, under the header row when there is one', () => {
    expect(address({ row: 3, column: 2 }, false)).toBe('C4');
    expect(address({ row: 4, column: 2 }, true)).toBe('C4');
    expect(address({ row: 0, column: 27 }, true)).toBe('AB');
  });
});
