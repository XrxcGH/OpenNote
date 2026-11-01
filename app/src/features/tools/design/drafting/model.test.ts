// checks-disable-file modifiability: one describe block per feature
import '../text';

import { describe, expect, it } from 'vitest';
import {
  ALL_SNAPS,
  LINE_TYPES,
  dimLines,
  emptyDoc,
  fallbackText,
  hatchLines,
  intersections,
  lineIntersection,
  measure,
  outline,
  parseScale,
  polygonArea,
  readDoc,
  resolve,
  scaleFactor,
  scaleText,
  snap,
} from './model';
import type { Dim, DraftingDoc, Entity } from './model';

function doc(entities: Entity[], dims: Dim[] = [], patch: Partial<DraftingDoc> = {}): DraftingDoc {
  return { ...emptyDoc('mm'), entities, dims, ...patch };
}
const line = (id: string, a: [number, number], b: [number, number]): Entity => ({ id, k: 'line', a, b, lt: 'visible' });

describe('dimensions measured from geometry', () => {
  const l = line('l1', [0, 0], [30, 40]);
  const dim: Dim = { id: 'd1', k: 'aligned', a: { id: 'l1', at: 'a' }, b: { id: 'l1', at: 'b' }, off: 6 };

  it('a line from (0,0) to (30,40) at 1:1 reads 50.00', () => {
    expect(dimLines(doc([l], [dim]))[0]!.text).toBe('50.00');
  });

  it('the same line at drawing scale 1:2 reads 100.00 (true size)', () => {
    const d = doc([l], [dim], { scale: { drawing: 1, actual: 2 } });
    expect(dimLines(d)[0]!.text).toBe('100.00');
    expect(dimLines(d)[0]!.value).toBeCloseTo(100, 12);
    const bigger = doc([l], [dim], { scale: { drawing: 2, actual: 1 } });
    expect(dimLines(bigger)[0]!.text).toBe('25.00');
  });

  it('two perpendicular lines give an angular dimension of 90.0 degrees', () => {
    const d = doc(
      [line('h', [0, 0], [20, 0]), line('v', [0, 0], [0, 15])],
      [{ id: 'a1', k: 'angular', l1: 'h', l2: 'v', r: 10 }],
    );
    expect(dimLines(d)[0]!.text).toBe('90.0°');
    const m = measure(d.dims[0]!, d);
    if (typeof m === 'string') throw new Error(m);
    expect(m.value).toBeCloseTo(90, 12);
  });

  it('other angles, including two lines that cross', () => {
    const d = doc(
      [line('a', [0, 0], [10, 0]), line('b', [0, 0], [10, 10])],
      [{ id: 'x', k: 'angular', l1: 'a', l2: 'b', r: 5 }],
    );
    expect(dimLines(d)[0]!.value).toBeCloseTo(45, 9);
    // lines crossing in the middle: measured between the rays to the far ends
    const c = doc(
      [line('a', [-10, 0], [10, 0]), line('b', [0, -10], [0, 10])],
      [{ id: 'x', k: 'angular', l1: 'a', l2: 'b', r: 5 }],
    );
    expect(dimLines(c)[0]!.value).toBeCloseTo(90, 9);
  });

  it('crossing lines read the same angle whichever way their endpoints were drawn', () => {
    // The line along x and the line along y = x cross at 45 degrees (and 135 degrees).
    const reads = (a: [[number, number], [number, number]], b: [[number, number], [number, number]], supp = false) => {
      const d = doc(
        [line('a', a[0], a[1]), line('b', b[0], b[1])],
        [{ id: 'x', k: 'angular', l1: 'a', l2: 'b', r: 5, ...(supp ? { supp: true } : {}) }],
      );
      return dimLines(d)[0]!.value;
    };
    const along: [[number, number], [number, number]] = [
      [-10, 0],
      [10, 0],
    ];
    const diag: [[number, number], [number, number]] = [
      [-3, -3],
      [5, 5],
    ];
    expect(reads(along, diag)).toBeCloseTo(45, 9);
    expect(reads([along[1], along[0]], diag)).toBeCloseTo(45, 9);
    expect(reads(along, [diag[1], diag[0]])).toBeCloseTo(45, 9);
    expect(reads([along[1], along[0]], [diag[1], diag[0]])).toBeCloseTo(45, 9);
    expect(reads(along, diag, true)).toBeCloseTo(135, 9);
    expect(reads([along[1], along[0]], diag, true)).toBeCloseTo(135, 9);
  });

  it('a circle of radius 12.5 mm with dual units', () => {
    const c: Entity = { id: 'c1', k: 'circle', c: [50, 50], r: 12.5, lt: 'visible' };
    const d = doc(
      [c],
      [
        { id: 'r', k: 'radius', of: 'c1', ang: 45 },
        { id: 'd', k: 'diameter', of: 'c1', ang: 0 },
      ],
      { dual: true },
    );
    const [r, di] = dimLines(d);
    expect(r!.text).toBe('R12.50 [0.492 in]');
    expect(di!.text).toBe('⌀25.00 [0.984 in]');
  });

  it('inch drawings read in inches and show millimetres as the other unit', () => {
    const d = doc([l], [dim], { units: 'in', decimals: 3, dual: true });
    expect(dimLines(d)[0]!.text).toBe('1.969 [50.00 mm]');
  });

  it('horizontal and vertical linear dimensions', () => {
    const e: Entity = { id: 'r1', k: 'rect', a: [10, 10], b: [60, 40], lt: 'visible' };
    const h: Dim = { id: 'h', k: 'linear', a: { id: 'r1', at: 'bl' }, b: { id: 'r1', at: 'br' }, axis: 'h', off: -8 };
    const v: Dim = { id: 'v', k: 'linear', a: { id: 'r1', at: 'bl' }, b: { id: 'r1', at: 'tl' }, axis: 'v', off: -8 };
    const d = doc([e], [h, v]);
    expect(dimLines(d).map((x) => x.text)).toEqual(['50.00', '30.00']);
    // a linear dimension between two slanted points measures only the chosen axis
    const free: Dim = { id: 'f', k: 'linear', a: { x: 0, y: 0 }, b: { x: 30, y: 40 }, axis: 'v', off: 5 };
    expect(dimLines(doc([], [free]))[0]!.text).toBe('40.00');
  });

  it('tolerances: bilateral, unequal and limits', () => {
    const base = { id: 'd1', k: 'aligned' as const, a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, off: 5 };
    expect(dimLines(doc([], [{ ...base, tol: { mode: 'bilateral', plus: 0.1, minus: 0.1 } }]))[0]!.text).toBe(
      '50.00 ±0.10',
    );
    expect(dimLines(doc([], [{ ...base, tol: { mode: 'bilateral', plus: 0.1, minus: 0.05 } }]))[0]!.text).toBe(
      '50.00 +0.10/-0.05',
    );
    expect(dimLines(doc([], [{ ...base, tol: { mode: 'limits', plus: 0.1, minus: 0.05 } }]))[0]!.text).toBe(
      '50.10 / 49.95',
    );
  });

  it('a dimension follows its geometry when a point moves', () => {
    const moved = line('l1', [0, 0], [60, 80]);
    expect(dimLines(doc([moved], [dim]))[0]!.text).toBe('100.00');
  });

  it('reports why a dimension cannot be measured', () => {
    expect(dimLines(doc([], [dim]))[0]!.problem).toBe('missing');
    const par = doc(
      [line('a', [0, 0], [10, 0]), line('b', [0, 5], [10, 5])],
      [{ id: 'x', k: 'angular', l1: 'a', l2: 'b', r: 5 }],
    );
    expect(dimLines(par)[0]!.problem).toBe('parallel');
    const sq = doc(
      [{ id: 's', k: 'rect', a: [0, 0], b: [5, 5], lt: 'visible' }],
      [{ id: 'x', k: 'radius', of: 's', ang: 0 }],
    );
    expect(dimLines(sq)[0]!.problem).toBe('notRound');
    const notLine = doc(
      [{ id: 's', k: 'rect', a: [0, 0], b: [5, 5], lt: 'visible' }, line('a', [0, 0], [1, 1])],
      [{ id: 'x', k: 'angular', l1: 's', l2: 'a', r: 5 }],
    );
    expect(dimLines(notLine)[0]!.problem).toBe('notLine');
  });

  it('a zero-length dimension reads zero without breaking', () => {
    const z = dimLines(doc([], [{ id: 'z', k: 'aligned', a: { x: 5, y: 5 }, b: { x: 5, y: 5 }, off: 5 }]))[0]!;
    expect(z.text).toBe('0.00');
  });

  it('huge coordinates still measure', () => {
    const z = dimLines(doc([], [{ id: 'z', k: 'aligned', a: { x: 0, y: 0 }, b: { x: 3e4, y: 4e4 }, off: 5 }]))[0]!;
    expect(z.value).toBeCloseTo(5e4, 6);
  });
});

describe('scale', () => {
  it('parses ratios', () => {
    expect(parseScale('1:2')).toEqual({ drawing: 1, actual: 2 });
    expect(parseScale(' 2 : 1 ')).toEqual({ drawing: 2, actual: 1 });
    expect(parseScale('1:0')).toBeNull();
    expect(parseScale('0:1')).toBeNull();
    expect(parseScale('1:5000')).toBeNull();
    expect(parseScale('half')).toBeNull();
    expect(scaleFactor({ drawing: 1, actual: 5 })).toBeCloseTo(0.2, 12);
    expect(scaleText({ drawing: 1, actual: 5 })).toBe('1:5');
  });
});

describe('line types', () => {
  it('thick visible lines, thin dashed hidden lines, long-short center and phantom lines', () => {
    expect(LINE_TYPES.visible.weight).toBeGreaterThan(LINE_TYPES.hidden.weight);
    expect(LINE_TYPES.visible.dash).toEqual([]);
    expect(LINE_TYPES.hidden.dash.length).toBe(2);
    expect(LINE_TYPES.center.dash.length).toBe(4);
    expect(LINE_TYPES.center.dash[0]).toBeGreaterThan(LINE_TYPES.center.dash[2]!);
    expect(LINE_TYPES.phantom.dash.length).toBe(6);
    for (const t of ['dimension', 'extension', 'leader'] as const) {
      expect(LINE_TYPES[t].weight).toBeCloseTo(0.3, 12);
      expect(LINE_TYPES[t].dash).toEqual([]);
    }
  });
});

describe('hatching', () => {
  it('lines at 45 degrees cover a square at the spacing', () => {
    const sq: Entity = { id: 's', k: 'rect', a: [0, 0], b: [20, 20], lt: 'visible' };
    const poly = outline(sq)!;
    const lines = hatchLines(poly, 2, 45);
    const total = lines.reduce((a, [p, q]) => a + Math.hypot(q[0] - p[0], q[1] - p[1]), 0);
    // total length x spacing is the area (400), to within one line's worth
    expect(total * 2).toBeGreaterThan(400 - 2 * 29);
    expect(total * 2).toBeLessThan(400 + 2 * 29);
    for (const [p, q] of lines) {
      expect(Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.PI / 4)).toBeLessThan(1e-9);
      for (const pt of [p, q]) {
        expect(pt[0]).toBeGreaterThanOrEqual(-1e-6);
        expect(pt[0]).toBeLessThanOrEqual(20 + 1e-6);
        expect(pt[1]).toBeGreaterThanOrEqual(-1e-6);
        expect(pt[1]).toBeLessThanOrEqual(20 + 1e-6);
      }
    }
  });
  it('a circle and a polygon with a notch are hatched inside only', () => {
    const c = outline({ id: 'c', k: 'circle', c: [0, 0], r: 10, lt: 'visible' })!;
    expect(polygonArea(c)).toBeCloseTo(Math.PI * 100, 0);
    const lines = hatchLines(c, 1, 0);
    expect(lines.length).toBeGreaterThanOrEqual(19);
    for (const [p, q] of lines) {
      expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(10 + 1e-6);
      expect(Math.hypot(q[0], q[1])).toBeLessThanOrEqual(10 + 1e-6);
    }
    // an L shape: hatch length at spacing 1 and angle 0 equals the horizontal width summed over rows
    const L: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [5, 5],
      [5, 10],
      [0, 10],
    ];
    const rows = hatchLines(L, 1, 0);
    const len = rows.reduce((a, [p, q]) => a + Math.abs(q[0] - p[0]), 0);
    expect(len).toBeCloseTo(polygonArea(L), 0);
  });
  it('refuses silly input', () => {
    expect(
      hatchLines(
        [
          [0, 0],
          [1, 1],
        ],
        1,
        0,
      ),
    ).toEqual([]);
    expect(
      hatchLines(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        0,
        0,
      ),
    ).toEqual([]);
    expect(
      hatchLines(
        [
          [0, 0],
          [1, 0],
          [1, 1e7],
        ],
        1,
        0,
      ),
    ).toEqual([]);
    expect(outline(line('l', [0, 0], [1, 1]))).toBeNull();
    expect(outline(undefined)).toBeNull();
  });
});

describe('snapping', () => {
  const d = doc([
    line('a', [0, 0], [20, 0]),
    line('b', [10, -10], [10, 10]),
    { id: 'c', k: 'circle', c: [40, 40], r: 5, lt: 'visible' },
  ]);
  it('endpoints, midpoints, centers and intersections beat the grid', () => {
    expect(snap(d, [19.5, 0.4], 2)).toEqual({ p: [20, 0], kind: 'endpoint' });
    expect(snap(d, [10.4, 0.3], 2).kind).toBe('intersection');
    expect(snap(d, [10.2, 0.2], 2).p).toEqual([10, 0]);
    expect(snap(d, [40.5, 40.4], 2)).toEqual({ p: [40, 40], kind: 'center' });
    const m = doc([line('a', [0, 0], [30, 0])]);
    expect(snap(m, [15.5, 0.2], 2)).toEqual({ p: [15, 0], kind: 'midpoint' });
  });
  it('falls back to the grid, and to the raw point with no grid', () => {
    expect(snap(d, [33.2, 12.9], 2)).toEqual({ p: [35, 15], kind: 'grid' });
    expect(snap({ ...d, gridMm: 0 }, [33.2, 12.9], 2)).toEqual({ p: [33.2, 12.9], kind: 'grid' });
  });
  it('can turn each kind off', () => {
    const off = { ...ALL_SNAPS, endpoint: false, intersection: false, midpoint: false, center: false };
    expect(snap(d, [19.5, 0.4], 2, off).kind).toBe('grid');
  });
  it('finds line and circle intersections', () => {
    const e = doc([line('a', [0, 0], [20, 0]), { id: 'c', k: 'circle', c: [10, 0], r: 5, lt: 'visible' }]);
    const xs = intersections(e)
      .map((p) => p[0])
      .sort((m, n) => m - n);
    expect(xs).toEqual([5, 15]);
    // segments that do not reach each other do not intersect
    expect(intersections(doc([line('a', [0, 0], [5, 0]), line('b', [10, -5], [10, 5])]))).toEqual([]);
    expect(lineIntersection([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
    expect(lineIntersection([0, 0], [1, 0], [3, -1], [3, 1])).toEqual([3, 0]);
  });
});

describe('saved documents', () => {
  it('round trips', () => {
    const d = doc(
      [line('l1', [0, 0], [30, 40]), { id: 'c1', k: 'circle', c: [5, 5], r: 3, lt: 'hidden' }],
      [
        {
          id: 'd1',
          k: 'aligned',
          a: { id: 'l1', at: 'a' },
          b: { id: 'l1', at: 'b' },
          off: 6,
          tol: { mode: 'bilateral', plus: 0.1, minus: 0.1 },
        },
      ],
    );
    expect(readDoc(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('drops what it cannot understand and never throws', () => {
    expect(readDoc(null)).toEqual(emptyDoc());
    expect(readDoc('nope')).toEqual(emptyDoc());
    const r = readDoc({
      units: 'cubits',
      sheet: 'a0',
      decimals: 99,
      scale: { drawing: -1, actual: 'x' },
      entities: [
        { id: 'a', k: 'line', a: [0, 0], b: [NaN, 1], lt: 'visible' },
        { id: 'b', k: 'line', a: [0, 0], b: [1, 1], lt: 'wavy' },
        { id: 'b', k: 'line', a: [0, 0], b: [2, 2], lt: 'visible' },
        { id: 'c', k: 'circle', c: [0, 0], r: -3 },
        { id: 'd', k: 'spiral' },
        7,
        { id: 'e', k: 'line', a: [1e12, 0], b: [0, -1e12], lt: 'visible' },
      ],
      dims: [
        { id: 'x', k: 'aligned', a: { x: 0, y: 0 }, b: { id: 'zz' }, off: 1 },
        { id: 'y', k: 'radius' },
      ],
    });
    expect(r.units).toBe('mm');
    expect(r.sheet).toBe('a4');
    expect(r.decimals).toBe(5);
    expect(r.scale.drawing).toBe(0.001);
    expect(r.entities.map((e) => e.id)).toEqual(['b', 'e']);
    expect(r.entities[0]).toMatchObject({ lt: 'visible' });
    expect(r.entities[1]).toMatchObject({ a: [100000, 0], b: [0, -100000] });
    expect(r.dims).toEqual([]);
  });
  it('limits how many things it keeps', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      id: `e${i}`,
      k: 'line',
      a: [0, 0],
      b: [1, 1],
      lt: 'visible',
    }));
    expect(readDoc({ entities: many }).entities).toHaveLength(400);
  });
  it('resolves references', () => {
    const d = doc([line('l1', [0, 0], [30, 40])]);
    expect(resolve({ id: 'l1', at: 'mid' }, d)).toEqual([15, 20]);
    expect(resolve({ id: 'l1', at: 'zz' }, d)).toBeNull();
    expect(resolve({ x: 1, y: 2 }, d)).toEqual([1, 2]);
  });
  it('the text fallback lists every dimension', () => {
    const d = doc(
      [line('l1', [0, 0], [30, 40])],
      [{ id: 'd1', k: 'aligned', a: { id: 'l1', at: 'a' }, b: { id: 'l1', at: 'b' }, off: 6 }],
    );
    const labels = {
      head: 'Drafting sheet',
      none: 'no dimensions',
      kinds: { linear: 'Linear', aligned: 'Aligned', angular: 'Angle', radius: 'Radius', diameter: 'Diameter' },
    };
    expect(fallbackText(d, labels)).toBe('Drafting sheet (mm, 1:1):\n- Aligned 50.00');
    expect(fallbackText(doc([]), labels)).toBe('Drafting sheet (mm, 1:1): no dimensions');
  });
});
