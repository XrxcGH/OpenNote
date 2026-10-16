import { describe, expect, it } from 'vitest';
import {
  applyHold,
  atProtractorCenter,
  gridSize,
  holdFor,
  nearRulerEdge,
  onRulerEdge,
  protractorAngle,
  snapToGrid,
  snapToProtractor,
  toRulerSpace,
} from './snap';
import type { Protractor, Ruler, SnapTools } from './snap';

const ruler: Ruler = { cx: 100, cy: 100, angle: 0, length: 200, width: 40 };
const turned: Ruler = { ...ruler, angle: Math.PI / 2 };
const protractor: Protractor = { cx: 50, cy: 50, angle: 0, radius: 100 };

describe('the ruler', () => {
  it('knows the edge a point is near, along the length only', () => {
    expect(nearRulerEdge(ruler, { x: 60, y: 82 }, 8)).toBe(-1);
    expect(nearRulerEdge(ruler, { x: 60, y: 121 }, 8)).toBe(1);
    expect(nearRulerEdge(ruler, { x: 60, y: 100 }, 8)).toBeNull();
    expect(nearRulerEdge(ruler, { x: 400, y: 82 }, 8)).toBeNull();
  });

  it('puts points on the edge and keeps them within the length', () => {
    expect(onRulerEdge(ruler, 1, { x: 130, y: 140 })).toEqual({ x: 130, y: 120 });
    const end = onRulerEdge(ruler, -1, { x: 900, y: 70 });
    expect(end.x).toBeCloseTo(200);
    expect(end.y).toBeCloseTo(80);
  });

  it('follows the ruler when it is turned', () => {
    const p = onRulerEdge(turned, -1, { x: 90, y: 150 });
    expect(p.x).toBeCloseTo(120);
    expect(p.y).toBeCloseTo(150);
    expect(toRulerSpace(turned, { x: 100, y: 150 }).u).toBeCloseTo(50);
  });
});

describe('the protractor', () => {
  it('turns a line to whole steps from its zero line', () => {
    const origin = { x: 50, y: 50 };
    const p = snapToProtractor(protractor, origin, { x: 50 + 100 * Math.cos(0.3), y: 50 + 100 * Math.sin(0.3) });
    expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(100);
    expect(protractorAngle(protractor, origin, p)).toBeCloseTo(15);
  });

  it('holds only a stroke that starts at its center', () => {
    expect(atProtractorCenter(protractor, { x: 53, y: 52 }, 6)).toBe(true);
    expect(atProtractorCenter(protractor, { x: 80, y: 80 }, 6)).toBe(false);
  });
});

describe('the grid', () => {
  it('lands points on the crossings', () => {
    const size = gridSize(5);
    const p = snapToGrid({ x: size * 2.2, y: size * 3.7 }, size);
    expect(p.x).toBeCloseTo(size * 2);
    expect(p.y).toBeCloseTo(size * 4);
    expect(snapToGrid({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
  });
});

describe('what a stroke is held to', () => {
  const tools: SnapTools = { ruler, protractor, grid: 20, reach: 8 };

  it('prefers the ruler, then the protractor, then the grid', () => {
    expect(holdFor(tools, { x: 60, y: 82 }).kind).toBe('ruler');
    expect(holdFor({ ...tools, ruler: null }, { x: 51, y: 51 }).kind).toBe('protractor');
    expect(holdFor(tools, { x: 300, y: 300 }).kind).toBe('grid');
    expect(holdFor({ ...tools, grid: 0 }, { x: 300, y: 300 }).kind).toBe('none');
  });

  it('runs a stroke straight along the edge it began on', () => {
    const hold = holdFor(tools, { x: 60, y: 82 });
    expect(applyHold(tools, hold, { x: 150, y: 60 })).toEqual({ x: 150, y: 80 });
  });
});
