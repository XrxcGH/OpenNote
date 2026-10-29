// Rows of handwriting: strokes on one line stay together, tall marks such as a fraction bar or an integral join the
// row they sit in, and rows come out top to bottom.
import { describe, expect, it } from 'vitest';
import { rowsOf } from './rows';

const stroke = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  id,
  startTime: 0,
  points: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
});

describe('rowsOf', () => {
  it('puts strokes on the same line in one row and rows in order from the top', () => {
    const rows = rowsOf([
      stroke('b1', 0, 100, 20, 130),
      stroke('a1', 0, 10, 20, 40),
      stroke('a2', 30, 12, 50, 38),
      stroke('b2', 30, 102, 50, 128),
    ]);
    expect(rows.map((row) => row.strokes.map((s) => s.id).sort())).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
    expect(rows[0].box).toEqual({ x0: 0, y0: 10, x1: 50, y1: 40 });
  });

  it('keeps a small mark that sits inside a row, such as a minus sign, in that row', () => {
    const rows = rowsOf([stroke('x', 0, 10, 20, 40), stroke('minus', 25, 24, 35, 26), stroke('y', 40, 10, 60, 40)]);
    expect(rows).toHaveLength(1);
  });

  it('leaves out strokes with no points and stops at 60 rows', () => {
    const many = Array.from({ length: 80 }, (_, i) => stroke(`s${i}`, 0, i * 100, 10, i * 100 + 20));
    expect(rowsOf([...many, { id: 'empty', startTime: 0, points: [] }])).toHaveLength(60);
  });
});
