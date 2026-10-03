import { describe, expect, it } from 'vitest';
import { densify } from '../geometry/simplify';
import type { Vec } from '../geometry/types';
import { circle } from '../input/gestures/corpus';
import { findGrid, linesOf, tableData } from './gridTable';
import type { GridLine } from './gridTable';
import { isUnsure } from './handwriting';
import { classifyEdit, LINE_HEIGHT } from './penEditing';

const line = (a: Vec, b: Vec): Vec[] => densify([a, b], 4);

describe('pen edits of typed text, judged by shape', () => {
  it('reads a flat line across a word as a strike through', () => {
    expect(classifyEdit(line({ x: 100, y: 200 }, { x: 180, y: 202 }))).toBe('strike');
    expect(classifyEdit(line({ x: 100, y: 200 }, { x: 110, y: 202 }))).toBeNull();
  });

  it('reads a short upright line as a space and a long one as a split', () => {
    expect(classifyEdit(line({ x: 100, y: 190 }, { x: 101, y: 190 + LINE_HEIGHT }))).toBe('space');
    expect(classifyEdit(line({ x: 100, y: 190 }, { x: 102, y: 190 + LINE_HEIGHT * 2.6 }))).toBe('split');
  });

  it('reads a loop as a circle and leaves a slanted line alone', () => {
    expect(classifyEdit(circle(3, 40, { x: 200, y: 200 }))).toBe('circle');
    expect(classifyEdit(line({ x: 100, y: 100 }, { x: 160, y: 160 }))).toBeNull();
  });
});

describe('a grid drawn in lines', () => {
  const h = (id: string, y: number): GridLine => ({ id, axis: 'h', at: y, from: 100, to: 400, time: 0 });
  const v = (id: string, x: number): GridLine => ({ id, axis: 'v', at: x, from: 100, to: 300, time: 0 });

  it('is found when three lines cross three lines', () => {
    const grid = findGrid([h('a', 100), h('b', 200), h('c', 300), v('d', 100), v('e', 250), v('f', 400)]);
    expect(grid).toMatchObject({ rows: 2, columns: 2, x: 100, y: 100, width: 300, height: 200 });
    expect(grid?.ids).toHaveLength(6);
  });

  it('is not found from too few lines, or lines that do not cross', () => {
    expect(findGrid([h('a', 100), h('b', 200), v('d', 100), v('e', 250)])).toBeNull();
    const far = (id: string, x: number): GridLine => ({ ...v(id, x), from: 900, to: 1000 });
    expect(findGrid([h('a', 100), h('b', 200), h('c', 300), far('d', 100), far('e', 250), far('f', 400)])).toBeNull();
  });

  it('counts a drawn rectangle as its four sides', () => {
    const box = densify(
      [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 400, y: 300 },
        { x: 100, y: 300 },
        { x: 100, y: 100 },
      ],
      4,
    );
    const lines = linesOf('r', box, 0);
    expect(lines.filter((one) => one.axis === 'h')).toHaveLength(2);
    expect(lines.filter((one) => one.axis === 'v')).toHaveLength(2);
    expect(linesOf('l', line({ x: 0, y: 0 }, { x: 200, y: 200 }), 0)).toEqual([]);
  });
});

describe('the writing pen', () => {
  it('marks a word as unsure when the recognizer has another reading', () => {
    expect(isUnsure({ alternates: ['hello'] })).toBe(true);
    expect(isUnsure({ alternates: [] })).toBe(false);
  });
});

describe('the table a grid becomes', () => {
  it('has the grid rows and columns, each cell empty, at the width the grid drew', () => {
    const data = tableData({ rows: 3, columns: 2, width: 400 });
    expect(data.columns).toHaveLength(2);
    expect(data.columns.every((column) => column.width === 200)).toBe(true);
    expect(data.rows).toHaveLength(3);
    expect(Object.keys(data.rows[0].cells)).toEqual(data.columns.map((column) => column.id));
    expect(data.rows[1].cells[data.columns[0].id]).toEqual({ markdown: '' });
  });
});
