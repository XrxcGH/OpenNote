// The fill handle's plan (DESIGN.md section 13.6), worked by hand.
import { describe, expect, it } from 'vitest';
import { planFill, targetOf } from './fill';

const texts = [
  ['1', 'Mon', '=A1*2'],
  ['3', '', ''],
];
const cell = (row: number, column: number) => ({ row, column });
const text = (writes: ReturnType<typeof planFill>['writes']) => writes.map((w) => w.text);

describe('targetOf', () => {
  const source = { top: 1, left: 1, bottom: 1, right: 1 };
  it('picks the axis the pointer is farthest along', () => {
    expect(targetOf(source, cell(4, 2))).toEqual({ box: { ...source, bottom: 4 }, direction: 'down' });
    expect(targetOf(source, cell(1, 5))).toEqual({ box: { ...source, right: 5 }, direction: 'right' });
    expect(targetOf(source, cell(0, 0))?.direction).toBe('up');
  });
  it('is null inside the source', () => {
    expect(targetOf(source, cell(1, 1))).toBeNull();
  });
});

describe('planFill', () => {
  it('continues a column as a series', () => {
    const { writes } = planFill(
      texts,
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 3, right: 0 },
      'down',
      'series',
    );
    expect(text(writes)).toEqual(['5', '7']);
    expect(writes.map((w) => w.at)).toEqual([cell(2, 0), cell(3, 0)]);
  });
  it('moves the references of a formula: =A1*2 down three rows gives =A2*2, =A3*2, =A4*2', () => {
    const { writes } = planFill(
      texts,
      { top: 0, left: 2, bottom: 0, right: 2 },
      { top: 0, left: 2, bottom: 3, right: 2 },
      'down',
      'series',
    );
    expect(text(writes)).toEqual(['=A2*2', '=A3*2', '=A4*2']);
  });
  it('copies on request', () => {
    const { writes } = planFill(
      texts,
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 3, right: 0 },
      'down',
      'copy',
    );
    expect(text(writes)).toEqual(['1', '3']);
    expect(writes[0].from).toEqual(cell(0, 0));
  });
  it('fills to the right with a name series, and upward in reverse', () => {
    const right = planFill(
      [['Mon']],
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 0, bottom: 0, right: 2 },
      'right',
      'series',
    );
    expect(text(right.writes)).toEqual(['Tue', 'Wed']);
    const up = planFill(
      [['', ''], ['3'], ['5']].map((r) => r),
      { top: 1, left: 0, bottom: 2, right: 0 },
      { top: 0, left: 0, bottom: 2, right: 0 },
      'up',
      'series',
    );
    // Dragging up from 3, 5: one cell above 3, which is 1.
    expect(text(up.writes)).toEqual(['1']);
    expect(up.writes[0].at).toEqual(cell(0, 0));
  });
  it('writes only formats for the formats mode, and says so for values', () => {
    const only = planFill(
      texts,
      { top: 0, left: 0, bottom: 0, right: 0 },
      { top: 0, left: 0, bottom: 1, right: 0 },
      'down',
      'formats',
    );
    expect(text(only.writes)).toEqual([null]);
    const values = planFill(
      texts,
      { top: 0, left: 0, bottom: 1, right: 0 },
      { top: 0, left: 0, bottom: 2, right: 0 },
      'down',
      'values',
    );
    expect(values.formats).toBe(false);
  });
});
