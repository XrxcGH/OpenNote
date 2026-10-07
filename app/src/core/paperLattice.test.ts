// The paper lattice's arithmetic: which line a point snaps to on each kind of paper, how far it reaches at each zoom,
// the header above the first sheet's lines, and the sheets of a paginated page.
import { describe, expect, it } from 'vitest';
import {
  linesArea,
  nearestLine,
  nearestRow,
  sheetIndex,
  snapReach,
  snapToLattice,
  stepToLine,
  UNBOUNDED,
} from './paperLattice';
import type { PaperLattice } from './paperLattice';

const H = 1056;
const grid: PaperLattice = {
  kind: 'grid',
  step: 20,
  origin: { x: 96, y: 72 },
  area: { x: 96, y: 72, w: 620, h: 900 },
  sheet: H,
  margin: null,
};
const dots: PaperLattice = { ...grid, kind: 'dots' };
const ruled: PaperLattice = {
  kind: 'ruled',
  step: 26,
  origin: { x: 96, y: 72 },
  area: { x: 0, y: 98, w: 816, h: 886 },
  sheet: H,
  margin: 96,
};
const infinite: PaperLattice = { ...grid, area: UNBOUNDED, sheet: null };

describe('snapReach', () => {
  it('is a third of the spacing, at least a few screen pixels, at most half the spacing', () => {
    expect(snapReach(30, 1)).toBe(10);
    expect(snapReach(30, 2)).toBe(10);
    expect(snapReach(30, 0.5)).toBe(12);
    expect(snapReach(9, 1)).toBe(4.5);
    expect(snapReach(12, 0.1)).toBe(6);
  });

  it('reaches the same distance on the screen at 50, 100, and 200 percent for fine paper', () => {
    for (const zoom of [0.5, 1, 2]) expect(snapReach(8, zoom) * zoom).toBeGreaterThanOrEqual(Math.min(6, 4 * zoom));
  });
});

describe('snapToLattice on grid paper', () => {
  it('snaps each coordinate to its nearest line, so a point near a crossing lands on it', () => {
    expect(snapToLattice(grid, { x: 118, y: 95 }, 7)).toEqual({ point: { x: 116, y: 92 }, x: true, y: true });
  });

  it('snaps one coordinate when only that one is within reach', () => {
    expect(snapToLattice(grid, { x: 106, y: 93 }, 6)).toEqual({ point: { x: 106, y: 92 }, x: false, y: true });
  });

  it('snaps at exactly the reach and not beyond it', () => {
    expect(snapToLattice(grid, { x: 122, y: 400 }, 6).x).toBe(true);
    expect(snapToLattice(grid, { x: 122.01, y: 400 }, 6).x).toBe(false);
  });

  it('leaves a point in the margin, away from the lines, where it is', () => {
    expect(snapToLattice(grid, { x: 30, y: 30 }, 6)).toEqual({ point: { x: 30, y: 30 }, x: false, y: false });
  });

  it('snaps to the lines of the sheet the point is on, which start again at its own top margin', () => {
    const hit = snapToLattice(grid, { x: 117, y: H + 73 }, 6);
    expect(hit.point).toEqual({ x: 116, y: H + 72 });
    expect(snapToLattice(grid, { x: 117, y: 2 * H + 72 + 19 }, 6).point).toEqual({ x: 116, y: 2 * H + 72 + 20 });
  });

  it('never snaps to a line that is not drawn above the header', () => {
    const headed = { ...grid, from: 172 };
    expect(snapToLattice(headed, { x: 300, y: 151 }, 6).y).toBe(false);
    expect(snapToLattice(headed, { x: 300, y: 168 }, 6).point.y).toBe(172);
    // The column ends at the header too: a point above it keeps its x.
    expect(snapToLattice(headed, { x: 117, y: 140 }, 6).x).toBe(false);
  });

  it('runs every line on and on with no sheets', () => {
    expect(snapToLattice(infinite, { x: 5017, y: 8994 }, 6).point).toEqual({ x: 5016, y: 8992 });
  });
});

describe('snapToLattice on dot paper', () => {
  it('snaps to a dot when both coordinates are near it', () => {
    expect(snapToLattice(dots, { x: 118, y: 95 }, 7)).toEqual({ point: { x: 116, y: 92 }, x: true, y: true });
  });

  it('leaves a point between the dots where it is, even near a row', () => {
    expect(snapToLattice(dots, { x: 106, y: 93 }, 6)).toEqual({ point: { x: 106, y: 93 }, x: false, y: false });
  });
});

describe('snapToLattice on ruled paper', () => {
  it('snaps y to the nearest rule and x to the margin line', () => {
    expect(snapToLattice(ruled, { x: 99, y: 128 }, 8)).toEqual({ point: { x: 96, y: 124 }, x: true, y: true });
    expect(snapToLattice(ruled, { x: 300, y: 128 }, 8)).toEqual({ point: { x: 300, y: 124 }, x: false, y: true });
  });

  it('has no rule in the top margin, where the first rule is a step below it', () => {
    expect(snapToLattice(ruled, { x: 300, y: 74 }, 8).y).toBe(false);
    expect(snapToLattice(ruled, { x: 300, y: 92 }, 8).point.y).toBe(98);
  });

  it('snaps x only to the margin line it draws', () => {
    expect(snapToLattice({ ...ruled, margin: null }, { x: 97, y: 124 }, 8).x).toBe(false);
  });
});

describe('the lattice helpers', () => {
  it('finds the nearest drawn line within a range, like the renderer', () => {
    expect(nearestLine(31, 0, 10, 0, 100)).toBe(30);
    expect(nearestLine(-30, 0, 10, 0, 100)).toBe(0);
    expect(nearestLine(500, 0, 10, 0, 100)).toBe(100);
    expect(nearestLine(5, 0, 10, 12, 18)).toBeNull();
  });

  it('cuts the first sheet at the header only', () => {
    const headed = { ...ruled, from: 202 };
    expect(linesArea(headed, 0).y).toBe(202);
    expect(linesArea(headed, 1).y).toBe(H + 98);
    expect(sheetIndex(headed, H - 0.001)).toBe(1);
    expect(sheetIndex(headed, H - 1)).toBe(0);
  });

  it('finds the rule under a point at any distance', () => {
    expect(nearestRow(ruled, { x: 300, y: 136 })).toBe(124);
    expect(nearestRow(ruled, { x: 300, y: 138 })).toBe(150);
  });

  it('steps to the next line, or to the one a point between two is moving toward', () => {
    expect(stepToLine(grid, 116, 'x', 1, 0)).toBe(20);
    expect(stepToLine(grid, 110, 'x', 1, 0)).toBe(6);
    expect(stepToLine(grid, 110, 'x', -1, 0)).toBe(-14);
    expect(stepToLine(grid, H + 92, 'y', -1, H + 92)).toBe(-20);
    expect(stepToLine(ruled, 300, 'x', 1, 0)).toBe(26);
    expect(stepToLine(ruled, 130, 'y', 1, 130)).toBe(20);
  });
});
