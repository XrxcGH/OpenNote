// Stratigraphy and classification diagrams: each planning case checks the engine against the answer read by hand
// from the published rules, then the edge cases (empty, zero, negative, contradictions).
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { drawColumns, parseColumns } from './column';
import { buildMatrix, components, parseRelations } from './harris';
import { QAPF, USDA, classify, fieldOutlines, normalize, project } from './ternary';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

/** The area of a polygon of plot points, by the shoelace formula. */
const area = (poly: readonly [number, number][]) =>
  Math.abs(
    poly.reduce((s, [x, y], i) => s + x * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * y, 0),
  ) / 2;

describe('ternary diagrams', () => {
  it('places (20, 30, 50) at x 55, y 43.3013 on a side-100 triangle', () => {
    const [x, y] = project([20, 30, 50]);
    expect(Math.abs(x - 55)).toBeLessThan(1e-9);
    expect(Math.abs(y - 43.30127019)).toBeLessThan(1e-7);
    expect(project([2, 3, 5])).toEqual(project([20, 30, 50]));
  });

  it('names an all-zero or a negative composition', () => {
    expect(problem(() => normalize([0, 0, 0]))).toBe('zero');
    expect(problem(() => normalize([-1, 50, 51]))).toBe('negative');
  });

  it('gives loam, sandy loam, and clay for the planning soils', () => {
    expect(classify(USDA, [40, 40, 20])).toBe('loam');
    expect(classify(USDA, [70, 15, 15])).toBe('sandyLoam');
    expect(classify(USDA, [10, 30, 60])).toBe('clay');
  });

  it('puts every composition on a 1 percent grid in exactly one soil class', () => {
    for (let clay = 0; clay <= 100; clay++)
      for (let silt = 0; silt <= 100 - clay; silt++) {
        const sand = 100 - clay - silt;
        const hits = USDA.fields.filter((f) => classify({ ...USDA, fields: [f] }, [sand, silt, clay]) === f.id);
        expect(hits.length, `${sand} ${silt} ${clay}`).toBe(1);
      }
  });

  it('draws soil fields that tile the triangle', () => {
    const total = fieldOutlines(USDA).reduce((s, f) => s + f.polygons.reduce((t, p) => t + area(p), 0), 0);
    expect(Math.abs(total - (100 * 100 * Math.sqrt(3)) / 4)).toBeLessThan(1e-6);
  });

  it('gives monzogranite for Q 30, A 30, P 40, where P/(A + P) is 57.1 percent', () => {
    expect(classify(QAPF, [30, 40, 30])).toBe('monzogranite');
    expect(classify(QAPF, [5, 85, 10])).toBe('quartzDiorite');
    expect(classify(QAPF, [10, 80, 10])).toBe('quartzMonzodiorite');
    expect(classify(QAPF, [95, 3, 2])).toBe('alkaliSyenite');
    expect(classify(QAPF, [5, 0, 95])).toBe('quartzolite');
  });
});

describe('Harris matrices', () => {
  it('drops 1 above 3 when 1 above 2 and 2 above 3 already say it', () => {
    const m = buildMatrix(parseRelations('1 above 2\n2 above 3\n1 above 3'));
    expect(m.edges).toEqual([
      ['1', '2'],
      ['2', '3'],
    ]);
    expect(m.redundant.map((r) => [r.upper, r.lower])).toEqual([['1', '3']]);
  });

  it('reports 4 and 5 as a cycle', () => {
    let message = '';
    try {
      buildMatrix(parseRelations('4 above 5\n5 above 4'));
    } catch (error) {
      if (error instanceof Problem) message = `${error.code} ${error.vars.list}`;
    }
    expect(message).toBe('cycle 4, 5');
  });

  it('reads below, cuts, cut by, and equal, and merges equal contexts', () => {
    const p = parseRelations('2 below 1\n3 cuts 2\n4 cut by 3\n4 = 7\n7 above 9');
    const m = buildMatrix(p);
    expect(m.nodes.map((n) => n.id)).toContain('4 = 7');
    expect(m.edges).toContainEqual(['4 = 7', '9']);
    expect(m.edges).toContainEqual(['1', '2']);
  });

  it('finds strongly connected parts of a long chain without running out of stack', () => {
    const n = 5000;
    const next = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : [0]));
    expect(components(n, next)).toHaveLength(1);
  });

  it('names a line it cannot read and an empty list', () => {
    expect(problem(() => parseRelations('1 beside 2'))).toBe('relation');
    expect(problem(() => parseRelations('  \n# note'))).toBe('noRelations');
  });
});

describe('stratigraphic columns', () => {
  const words = {
    title: 'Column',
    description: 'd',
    unit: 'm',
    grainLabels: {
      clay: 'cl',
      silt: 's',
      vf: '',
      f: '',
      m: 'm',
      c: '',
      vc: '',
      granule: '',
      pebble: 'p',
      cobble: '',
      boulder: '',
    },
  };

  it('reads units and columns, with defaults for grain and contact', () => {
    const cols = parseColumns('A, 10, sandstone\nB, 5, shale, clay, erosional, ammonites\n---\nA, 8, sand');
    expect(cols).toHaveLength(2);
    expect(cols[0][0]).toMatchObject({ grain: 'm', contact: 'sharp' });
    expect(cols[0][1]).toMatchObject({ contact: 'erosional', note: 'ammonites' });
    expect(cols[1][0].lithology).toBe('sandstone');
    const fig = drawColumns(cols, words);
    expect(fig.marks.some((m) => m.kind === 'line' && m.role === 's0')).toBe(true);
  });

  it('names a zero thickness, an unknown rock, and no units', () => {
    expect(problem(() => parseColumns('A, 0, sandstone'))).toBe('thickness');
    expect(problem(() => parseColumns('A, 3, cheese'))).toBe('lithology');
    expect(problem(() => parseColumns(''))).toBe('noUnits');
  });
});
