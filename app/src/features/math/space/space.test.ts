// 3D graphs: the text, the geometry, tangent planes, level curves, vectors, and lines and planes, checked against
// worked examples from a calculus text (Stewart, Calculus, chapters 12 and 14).
import { describe, expect, it } from 'vitest';
import { contourLevels, levelCurves } from './contour';
import {
  compareLines,
  distancePointPlane,
  lineMeetsPlane,
  lineThrough,
  planesMeet,
  planeText,
  planeThrough,
  readPlane,
} from './geometry3d';
import { compileMulti, partialDerivative } from './multivar';
import { projector } from './project';
import { exportSpace, tangentEquation } from './render';
import { DEFAULT_CAMERA, is3dGraph, readItem, readSpace, writeSpace } from './source3d';
import {
  angleBetween,
  cross,
  dot,
  norm,
  parallelogramArea,
  projection,
  readVec,
  scalarProjection,
  tripleProduct,
  unit,
  vecText,
} from './vec';
import { buildWorld, clipLineToBox, planeInBox } from './world';

describe('multivariable expressions', () => {
  it('reads z = f(x, y) and its partial derivatives exactly', () => {
    const f = compileMulti('z = x^2 y + sin(xy)', ['x', 'y']);
    if (!f.ok) throw new Error(f.error.message);
    expect(f.expression.evaluate({ x: 2, y: 3 })).toBeCloseTo(12 + Math.sin(6), 12);
    const fx = partialDerivative('x^2 y + sin(xy)', 'x', ['x', 'y']);
    if (!fx.ok) throw new Error(fx.error.message);
    expect(fx.expression.evaluate({ x: 2, y: 3 })).toBeCloseTo(12 + 3 * Math.cos(6), 12);
  });

  it('drops f(x, y) = and reads theta as θ', () => {
    const f = compileMulti('f(x, y) = x + y', ['x', 'y']);
    expect(f.ok && f.expression.evaluate({ x: 1, y: 2 })).toBe(3);
    const r = compileMulti('r = 1 + cos theta', ['θ']);
    expect(r.ok && r.expression.evaluate({ θ: 0 })).toBe(2);
  });
});

describe('vectors', () => {
  it('works the dot and cross products and angles', () => {
    // Stewart 12.4, Example 1: ⟨1, 3, 4⟩ × ⟨2, 7, −5⟩ = ⟨−43, 13, 1⟩.
    expect(cross([1, 3, 4], [2, 7, -5])).toEqual([-43, 13, 1]);
    // Stewart 12.3, Example 3: the angle between ⟨2, 2, −1⟩ and ⟨5, −3, 2⟩ is about 1.46 rad, or 84°.
    expect(dot([2, 2, -1], [5, -3, 2])).toBe(2);
    expect(angleBetween([2, 2, -1], [5, -3, 2])!).toBeCloseTo(Math.acos(2 / (3 * Math.sqrt(38))), 12);
    expect((angleBetween([2, 2, -1], [5, -3, 2])! * 180) / Math.PI).toBeCloseTo(84, 0);
    expect(angleBetween([0, 0, 0], [1, 0, 0])).toBeNull();
  });

  it('projects one vector onto another', () => {
    // Stewart 12.3, Example 6: b = ⟨1, 1, 2⟩ onto a = ⟨−2, 3, 1⟩: comp = 3/√14, proj = (3/14)⟨−2, 3, 1⟩.
    expect(scalarProjection([1, 1, 2], [-2, 3, 1])!).toBeCloseTo(3 / Math.sqrt(14), 12);
    const proj = projection([1, 1, 2], [-2, 3, 1])!;
    [-6 / 14, 9 / 14, 3 / 14].forEach((value, k) => expect(proj[k]).toBeCloseTo(value, 12));
    expect(projection([1, 2, 3], [0, 0, 0])).toBeNull();
  });

  it('finds the triple product, areas, and unit vectors', () => {
    // Stewart 12.4, Example 5: ⟨1, 4, −7⟩, ⟨2, −1, 4⟩, ⟨0, −9, 18⟩ lie in one plane.
    expect(tripleProduct([1, 4, -7], [2, -1, 4], [0, -9, 18])).toBe(0);
    // Stewart 12.4, Example 4: PQ = ⟨−3, 1, −7⟩ and PR = ⟨0, −5, −5⟩ span a parallelogram of area 5√82 (the
    // triangle PQR has half that).
    expect(parallelogramArea([-3, 1, -7], [0, -5, -5])).toBeCloseTo(5 * Math.sqrt(82), 10);
    expect(norm(unit([3, 4, 0])!)).toBeCloseTo(1, 12);
    expect(unit([0, 0, 0])).toBeNull();
  });

  it('reads and writes vectors', () => {
    expect(readVec('<1, -2, 3>')).toEqual([1, -2, 3]);
    expect(readVec('(1 2)')).toEqual([1, 2, 0]);
    expect(readVec('sqrt(4), pi - pi, 1/2')).toEqual([2, 0, 0.5]);
    expect(readVec('1')).toBeNull();
    expect(readVec('a, b')).toBeNull();
    expect(vecText([0.1 + 0.2, -1e-17, 2])).toBe('⟨0.3, 0, 2⟩');
  });
});

describe('lines and planes', () => {
  it('measures the distance from a point to a plane', () => {
    // Stewart 12.5, Example 8 style: from (1, −2, 4) to 3x + 2y + 6z = 5 is 18/7.
    expect(distancePointPlane([1, -2, 4], readPlane('3x + 2y + 6z = 5')!)).toBeCloseTo(18 / 7, 12);
  });

  it('finds the distance between skew lines', () => {
    // Stewart 12.5, Example 10: x = 1 + t, y = −2 + 3t, z = 4 − t and x = 2s, y = 3 + s, z = −3 + 4s are 8/√230 apart.
    const pair = compareLines(
      { point: [1, -2, 4], direction: [1, 3, -1] },
      { point: [0, 3, -3], direction: [2, 1, 4] },
    );
    expect(pair.kind).toBe('skew');
    if (pair.kind === 'skew') expect(pair.distance).toBeCloseTo(8 / Math.sqrt(230), 12);
  });

  it('finds where lines meet, and tells parallel and equal lines apart', () => {
    const meet = compareLines({ point: [0, 0, 0], direction: [1, 1, 0] }, { point: [2, 0, 0], direction: [-1, 1, 0] });
    expect(meet.kind).toBe('intersect');
    if (meet.kind === 'intersect') {
      expect(meet.point.map((v) => Number(v.toFixed(12)))).toEqual([1, 1, 0]);
      expect(meet.angle).toBeCloseTo(Math.PI / 2, 12);
    }
    expect(
      compareLines({ point: [0, 0, 0], direction: [1, 0, 0] }, { point: [0, 1, 0], direction: [2, 0, 0] }),
    ).toEqual({
      kind: 'parallel',
      distance: 1,
    });
    expect(
      compareLines({ point: [0, 0, 0], direction: [1, 0, 0] }, { point: [5, 0, 0], direction: [-3, 0, 0] }).kind,
    ).toBe('same');
  });

  it('finds where a line meets a plane', () => {
    // Stewart 12.5, Example 3: the line through (2, 4, −3) and (3, −1, 1) meets the xy-plane at (11/4, 1/4, 0).
    const hit = lineMeetsPlane(lineThrough([2, 4, -3], [3, -1, 1]), readPlane('z = 0')!);
    expect(hit.kind).toBe('intersect');
    if (hit.kind === 'intersect') {
      expect(hit.point[0]).toBeCloseTo(11 / 4, 12);
      expect(hit.point[1]).toBeCloseTo(1 / 4, 12);
      expect(hit.point[2]).toBeCloseTo(0, 12);
    }
    expect(lineMeetsPlane({ point: [0, 0, 1], direction: [1, 0, 0] }, readPlane('z = 0')!)).toEqual({
      kind: 'parallel',
      distance: 1,
    });
  });

  it('finds the line where two planes meet, and their angle', () => {
    // Stewart 12.5, Example 7: x + y + z = 1 and x − 2y + 3z = 1 meet at about 72°, along a line of direction ⟨5, −2, −3⟩.
    const pair = planesMeet(readPlane('x + y + z = 1')!, readPlane('x - 2y + 3z = 1')!);
    expect(pair.kind).toBe('intersect');
    if (pair.kind !== 'intersect') return;
    expect((pair.angle * 180) / Math.PI).toBeCloseTo(72, 0);
    const d = pair.line.direction;
    expect(d[0] / 5).toBeCloseTo(d[1] / -2, 12);
    expect(d[0] / 5).toBeCloseTo(d[2] / -3, 12);
    const p = pair.line.point;
    expect(p[0] + p[1] + p[2]).toBeCloseTo(1, 12);
    expect(p[0] - 2 * p[1] + 3 * p[2]).toBeCloseTo(1, 12);
    expect(planesMeet(readPlane('x + y + z = 1')!, readPlane('2x + 2y + 2z = 8')!)).toEqual({
      kind: 'parallel',
      distance: 3 / Math.sqrt(3),
    });
  });

  it('builds a plane through three points and writes it', () => {
    // Stewart 12.5, Example 5: through (1, 3, 2), (3, −1, 6), and (5, 2, 0): 12x + 20y + 14z = 100.
    const plane = planeThrough([1, 3, 2], [3, -1, 6], [5, 2, 0])!;
    expect(plane.normal).toEqual([12, 20, 14]);
    expect(plane.d).toBe(100);
    expect(planeText(plane)).toBe('12x + 20y + 14z = 100');
    expect(planeText(readPlane('-x + 2z = 3')!)).toBe('−x + 2z = 3');
    expect(readPlane('x + y')).toBeNull();
  });
});

describe('3D graph text', () => {
  it('reads every kind of line and writes what it reads', () => {
    const text = [
      '@3d',
      'z = x^2 - y^2',
      '(cos t, sin t, t/4)',
      'vector <1, 2, 3> at (0, 0, 1)',
      'point (1, -2, 4)',
      'line (1, -2, 4) + t<1, 3, -1>',
      'plane 3x + 2y + 6z = 5',
      'a = 2',
      '@range -2 2 -2 2',
      '@zrange -4 4',
      '@t 0 12.5664',
      '@tangent 1 0.5',
      '@show both',
      '@revolve sqrt(x); 0; 0; 4; y=0',
      '@angle -40 30 1.5',
    ].join('\n');
    expect(is3dGraph(text)).toBe(true);
    const space = readSpace(text);
    expect(space.items.map((line) => readItem(line).kind)).toEqual([
      'surface',
      'curve',
      'vector',
      'point',
      'line',
      'plane',
    ]);
    expect(space.params).toEqual({ a: 2 });
    expect(space.tangent).toEqual([1, 0.5]);
    expect(space.revolve).toEqual({ outer: 'sqrt(x)', inner: '0', from: 0, to: 4, axis: { kind: 'y', at: 0 } });
    expect(writeSpace(space)).toBe(text);
    expect(readSpace('@3d\n@revolve x; 0; 0; 1; y-axis').revolve!.axis).toEqual({ kind: 'x', at: 0 });
  });

  it('marks a keyword line it cannot read', () => {
    expect(readItem('vector <1>').kind).toBe('invalid');
    expect(readItem('plane x + y').kind).toBe('invalid');
    expect(readItem('line (0,0,0) to (1,1,1)').kind).toBe('line');
  });
});

describe('3D geometry for the screen', () => {
  it('samples a surface into a box and finds its tangent plane', () => {
    // Stewart 14.4, Example 1: the tangent plane to z = 2x² + y² at (1, 1, 3) is z = 3 + 4(x − 1) + 2(y − 1).
    const world = buildWorld(readSpace('@3d\nz = 2x^2 + y^2\n@tangent 1 1'));
    expect(world.faces.filter((face) => face.role === 'surface')).toHaveLength(900);
    expect(world.tangent).toEqual({ x: 1, y: 1, z: 3, fx: 4, fy: 2 });
    expect(tangentEquation(world)).toBe('z = 3 + 4(x − 1) + 2(y − 1)');
    expect(world.box.min[0]).toBe(-3);
    expect(world.problems).toEqual([null]);
  });

  it('draws level curves where the surface has that height', () => {
    const world = buildWorld(readSpace('@3d\nz = x^2 + y^2\n@show both'));
    const levels = contourLevels(0, 18, 9);
    expect(levels).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    const [four] = levelCurves(world.grid!, [4]);
    expect(four.segments.length).toBeGreaterThan(20);
    for (const [x1, y1] of four.segments) expect(Math.hypot(x1, y1)).toBeCloseTo(2, 1);
    expect(world.lines.some((line) => line.role === 'contour')).toBe(true);
  });

  it('reports a bad surface at its item and still draws the rest', () => {
    const world = buildWorld(readSpace('@3d\nz = x +\npoint (1, 2, 3)'));
    expect(world.problems[0]).not.toBeNull();
    expect(world.dots).toHaveLength(1);
  });

  it('clips lines and planes to the box', () => {
    const box = { min: [-1, -1, -1], max: [1, 1, 1] } as const;
    const [a, b] = clipLineToBox({ point: [0, 0, 0], direction: [1, 0, 0] }, box)!;
    expect([a[0], b[0]]).toEqual([-1, 1]);
    expect(clipLineToBox({ point: [0, 5, 0], direction: [1, 0, 0] }, box)).toBeNull();
    expect(planeInBox({ normal: [0, 0, 1], d: 0 }, box)).toHaveLength(4);
    expect(planeInBox({ normal: [0, 0, 1], d: 5 }, box)).toHaveLength(0);
  });

  it('projects the center of the box to the center of the picture', () => {
    const project = projector({ min: [-2, -2, -2], max: [2, 2, 2] }, DEFAULT_CAMERA, { width: 600, height: 400 });
    const center = project([0, 0, 0]);
    expect(center.x).toBeCloseTo(300, 10);
    expect(center.y).toBeCloseTo(200, 10);
  });

  it('exports a picture with a title and description', () => {
    const svg = exportSpace('@3d\nvector <1, 2, 3>\nvector <-2, 1, 0>\npoint (1, 1, 1)')!;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>3D graph</title>');
    expect(svg).toContain('vector &lt;1, 2, 3&gt;');
    expect(svg).toMatchSnapshot();
    expect(exportSpace('@3d')).toBeNull();
    expect(exportSpace('@3d\nz = sin(x) cos(y)\n@show contour')).toContain('<line');
  });
});
