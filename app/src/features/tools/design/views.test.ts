import { describe, expect, it } from 'vitest';
import { inBounds, iso, isoFaces, project, standardViews } from './views';
import type { Cube, Seg, View } from './views';

const cube = (x: number, y: number, z: number): Cube => ({ x, y, z });
const visible = (v: View): Seg[] => v.segments.filter((s) => !s.hidden);
const hidden = (v: View): Seg[] => v.segments.filter((s) => s.hidden);
const len = (s: Seg) => Math.abs(s.b[0] - s.a[0]) + Math.abs(s.b[1] - s.a[1]);
const total = (segs: Seg[]) => segs.reduce((a, s) => a + len(s), 0);

describe('single cube', () => {
  it('has three unit squares and no hidden lines', () => {
    for (const name of ['front', 'top', 'right'] as const) {
      const v = project([cube(0, 0, 0)], name);
      expect(v.width).toBe(1);
      expect(v.height).toBe(1);
      expect(total(visible(v))).toBe(4);
      expect(hidden(v)).toHaveLength(0);
    }
  });
  it('an empty model has empty views', () => {
    expect(project([], 'front')).toEqual({ name: 'front', width: 0, height: 0, segments: [] });
  });
});

describe('L-shape: three cubes in a row and one on top at one end', () => {
  const model = [cube(0, 0, 0), cube(1, 0, 0), cube(2, 0, 0), cube(0, 1, 0)];
  it('front view is an L outline with no lines inside', () => {
    const v = project(model, 'front');
    expect([v.width, v.height]).toEqual([3, 2]);
    // outline of an L of area 4: perimeter 10, no inner line
    expect(total(visible(v))).toBe(10);
    expect(hidden(v)).toHaveLength(0);
  });
  it('top view is a 1 x 3 rectangle with one visible line at the step', () => {
    const v = project(model, 'top');
    expect([v.width, v.height]).toEqual([3, 1]);
    expect(total(visible(v))).toBe(8 + 1);
    const inner = visible(v).filter((s) => s.a[0] === 1 && s.b[0] === 1 && s.a[1] === 0 && s.b[1] === 1);
    expect(inner).toHaveLength(1);
    expect(hidden(v)).toHaveLength(0);
  });
  it('right view is 1 x 2', () => {
    const v = project(model, 'right');
    expect([v.width, v.height]).toEqual([1, 2]);
    expect(hidden(v)).toHaveLength(0);
  });
});

describe('hidden lines', () => {
  // 3 wide, 1 high, 2 deep with the back middle cube removed
  const notch = [cube(0, 0, 0), cube(2, 0, 0), cube(0, 0, 1), cube(1, 0, 1), cube(2, 0, 1)];
  it('the front view shows the notch as dashed lines', () => {
    const v = project(notch, 'front');
    expect([v.width, v.height]).toEqual([3, 1]);
    expect(total(visible(v))).toBe(8);
    expect(
      hidden(v)
        .map((s) => s.a[0])
        .sort(),
    ).toEqual([1, 2]);
    expect(hidden(v).every((s) => s.a[0] === s.b[0])).toBe(true);
  });
  it('the top view shows the notch as a visible outline, not a dashed one', () => {
    const v = project(notch, 'top');
    expect(hidden(v)).toHaveLength(0);
    expect(total(visible(v))).toBe(10 + 2);
  });
  it('the back view sees the notch directly, so its lines are visible', () => {
    const v = project(notch, 'back');
    expect(total(visible(v))).toBeGreaterThan(8);
  });
  it('a hidden step behind level faces is dashed', () => {
    // front plane level, but the right column is one cube shallower at the back
    const m = [cube(0, 0, 0), cube(0, 0, 1), cube(1, 0, 1)];
    const v = project(m, 'front');
    expect(hidden(v)).toHaveLength(1);
    expect(hidden(v)[0]).toMatchObject({ a: [1, 0], b: [1, 1] });
  });
});

describe('view axes', () => {
  // a tall column at the left-front, short at the right-back
  const model = [cube(0, 0, 1), cube(0, 1, 1), cube(1, 0, 0)];
  it('front view puts +x on the right and +y up', () => {
    const v = project(model, 'front');
    expect([v.width, v.height]).toEqual([2, 2]);
    // the tall column is on the left: the left edge reaches the top
    expect(visible(v).some((s) => s.a[0] === 0 && s.b[0] === 0 && s.a[1] === 0 && s.b[1] === 2)).toBe(true);
  });
  it('left and right views are mirror images', () => {
    const l = project(model, 'left');
    const r = project(model, 'right');
    expect([l.width, l.height]).toEqual([r.width, r.height]);
    const mirrored = r.segments
      .map((s) => `${r.width - s.a[0]},${s.a[1]}|${r.width - s.b[0]},${s.b[1]}|${s.hidden}`)
      .sort();
    const left = l.segments.map((s) => `${s.b[0]},${s.b[1]}|${s.a[0]},${s.a[1]}|${s.hidden}`).sort();
    const left2 = l.segments.map((s) => `${s.a[0]},${s.a[1]}|${s.b[0]},${s.b[1]}|${s.hidden}`).sort();
    expect(mirrored.length).toBe(left.length);
    expect(mirrored.every((k) => left.includes(k) || left2.includes(k))).toBe(true);
  });
  it('the top view has the front of the model at the bottom', () => {
    // front cube at z=1 should be in the lower row, back cube at z=0 in the upper row
    const v = project([cube(0, 0, 1), cube(0, 0, 0), cube(1, 0, 0)], 'top');
    // the notch (no cube at x=1, z=1) is at the bottom right: the lower-right unit cell is empty,
    // so the right edge of the lower row is not part of the outline at u=2
    expect([v.width, v.height]).toEqual([2, 2]);
    expect(visible(v).some((s) => s.a[0] === 2 && s.b[0] === 2 && s.a[1] === 1 && s.b[1] === 2)).toBe(true);
    expect(visible(v).some((s) => s.a[0] === 2 && s.b[0] === 2 && s.a[1] === 0 && s.b[1] === 1)).toBe(false);
  });
  it('standardViews returns the three views and the system', () => {
    const s = standardViews([cube(0, 0, 0)], 'first');
    expect(s.system).toBe('first');
    expect(s.front.width).toBe(1);
  });
});

describe('isometric drawing', () => {
  it('a single cube has three visible faces of equal area', () => {
    const faces = isoFaces([cube(0, 0, 0)]);
    expect(faces).toHaveLength(3);
    const area = (pts: [number, number][]) => {
      let a = 0;
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        a += p[0] * q[1] - q[0] * p[1];
      });
      return Math.abs(a) / 2;
    };
    for (const f of faces) expect(area(f.points)).toBeCloseTo(Math.cos(Math.PI / 6), 12);
  });
  it('hides faces that touch another cube', () => {
    expect(isoFaces([cube(0, 0, 0), cube(1, 0, 0)])).toHaveLength(5);
    expect(isoFaces([cube(0, 0, 0), cube(0, 1, 0)])).toHaveLength(5);
  });
  it('iso projects the axes at 30 degrees', () => {
    const [x, y] = iso(1, 0, 0);
    expect(x).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(y).toBeCloseTo(-0.5, 12);
    expect(iso(0, 1, 0)).toEqual([0, 1]);
    // The corner nearest the viewer, (1, 0, 1), is the lowest point on the screen.
    expect(iso(1, 0, 1)[1]).toBeCloseTo(-1, 12);
  });
  it('bounds', () => {
    expect(inBounds(cube(0, 0, 0))).toBe(true);
    expect(inBounds(cube(-1, 0, 0))).toBe(false);
    expect(inBounds(cube(12, 0, 0))).toBe(false);
    expect(inBounds(cube(0.5, 0, 0))).toBe(false);
  });
});
