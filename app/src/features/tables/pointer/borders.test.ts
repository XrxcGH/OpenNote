// Draw border and Erase border strokes (DESIGN.md section 12).
import { describe, expect, it } from 'vitest';
import { edgesAlong } from './borders';

// Columns A to D are 100 wide, rows 1 to 3 are 30 high, so the lines are at x of 0, 100, 200, 300, and 400, and at y of 0 to 90.
const lines = { xs: [0, 100, 200, 300, 400], ys: [0, 30, 60, 90] };
const sides = (edges: ReturnType<typeof edgesAlong>, side: string) =>
  edges.filter((e) => e.side === side).map((e) => `${e.cell.row},${e.cell.column}`);

describe('edgesAlong', () => {
  it('names the table rows of a virtual table, where the drawn rows start at row 5000', () => {
    const edges = edgesAlong(
      [
        { x: 105, y: 60 },
        { x: 195, y: 60 },
      ],
      { ...lines, rows: [5000, 5001, 5002] },
    );
    expect(sides(edges, 'b')).toEqual(['5001,1']);
    expect(sides(edges, 't')).toEqual(['5002,1']);
  });
  it('sets the bottom of B2, C2, and D2 for a stroke along their bottom edge, and the top of the cells below', () => {
    // Row 2 is index 1, its bottom edge is y = 60; columns B to D are indices 1 to 3.
    const edges = edgesAlong(
      [
        { x: 105, y: 61 },
        { x: 250, y: 59 },
        { x: 395, y: 60 },
      ],
      lines,
    );
    expect(sides(edges, 'b')).toEqual(['1,1', '1,2', '1,3']);
    expect(sides(edges, 't')).toEqual(['2,1', '2,2', '2,3']);
  });
  it('snaps a vertical stroke to the nearest line and writes both neighbors', () => {
    const edges = edgesAlong(
      [
        { x: 198, y: 35 },
        { x: 203, y: 55 },
      ],
      lines,
    );
    expect(sides(edges, 'r')).toEqual(['1,1']);
    expect(sides(edges, 'l')).toEqual(['1,2']);
  });
  it('makes two lines at a corner and ignores a tiny stroke', () => {
    const corner = edgesAlong(
      [
        { x: 100, y: 30 },
        { x: 200, y: 30 },
        { x: 200, y: 60 },
      ],
      lines,
    );
    expect(sides(corner, 'b')).toEqual(['0,1']);
    expect(sides(corner, 'r')).toEqual(['1,1']);
    expect(
      edgesAlong(
        [
          { x: 100, y: 30 },
          { x: 101, y: 31 },
        ],
        lines,
      ),
    ).toEqual([]);
  });
  it('leaves out sides that fall outside the table', () => {
    const top = edgesAlong(
      [
        { x: 5, y: 1 },
        { x: 95, y: 0 },
      ],
      lines,
    );
    expect(top).toEqual([{ cell: { row: 0, column: 0 }, side: 't' }]);
  });
});
