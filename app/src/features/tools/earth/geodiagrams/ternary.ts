// Ternary diagrams: normalizing three parts to 100, placing them on a triangle of side 100, and classification
// fields as sets of linear inequalities, so a lookup follows the published rules exactly and each field's outline
// is the triangle clipped by its own boundary lines. The first part sits at the lower left, the second at the
// lower right, and the third at the top.
import { check } from '../core/problem';

export type Parts = readonly [number, number, number];

/** The three parts scaled to sum to 100. */
export function normalize(parts: Parts): [number, number, number] {
  check(
    parts.every((p) => Number.isFinite(p) && p >= 0),
    'negative',
  );
  const total = parts[0] + parts[1] + parts[2];
  check(total > 0, 'zero');
  return [(100 * parts[0]) / total, (100 * parts[1]) / total, (100 * parts[2]) / total];
}

/** The plot point on a side-100 triangle: x = b + c/2, y = c √3/2. */
export function project(parts: Parts): [number, number] {
  const [, b, c] = normalize(parts);
  return [b + c / 2, (c * Math.sqrt(3)) / 2];
}

/** A half-plane k·(a, b, c) ≥ k₀ (or > k₀ when strict). */
export interface Bound {
  k: Parts;
  min: number;
  strict?: boolean;
}

export interface Field {
  id: string;
  /** Convex pieces; a composition is in the field when it is inside any piece. */
  pieces: readonly (readonly Bound[])[];
}

export interface Scheme {
  id: string;
  /** Which part is a, b, and c, as message ids. */
  parts: readonly [string, string, string];
  fields: readonly Field[];
  /** Only part of the triangle is classified, such as the upper QAPF triangle. */
  region?: readonly Bound[];
  source: string;
}

const holds = (p: Parts, bound: Bound): boolean => {
  const value = bound.k[0] * p[0] + bound.k[1] * p[1] + bound.k[2] * p[2];
  return bound.strict ? value > bound.min + 1e-9 : value >= bound.min - 1e-9;
};

/** The field a composition falls in, or null when it falls outside every field. */
export function classify(scheme: Scheme, parts: Parts): string | null {
  const p = normalize(parts);
  if (scheme.region && !scheme.region.every((b) => holds(p, b))) return null;
  return scheme.fields.find((f) => f.pieces.some((piece) => piece.every((b) => holds(p, b))))?.id ?? null;
}

/** Clips a convex polygon of compositions by one half-plane (Sutherland-Hodgman). */
function clip(polygon: Parts[], bound: Bound): Parts[] {
  const value = (p: Parts) => bound.k[0] * p[0] + bound.k[1] * p[1] + bound.k[2] * p[2] - bound.min;
  const out: Parts[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const vp = value(p);
    const vq = value(q);
    if (vp >= 0) out.push(p);
    if (vp >= 0 !== vq >= 0) {
      const s = vp / (vp - vq);
      out.push([p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1]), p[2] + s * (q[2] - p[2])]);
    }
  });
  return out;
}

const TRIANGLE: Parts[] = [
  [100, 0, 0],
  [0, 100, 0],
  [0, 0, 100],
];

/** Each field's outline as plot points, one polygon per convex piece. */
export function fieldOutlines(scheme: Scheme): { id: string; polygons: [number, number][][] }[] {
  return scheme.fields.map((field) => ({
    id: field.id,
    polygons: field.pieces
      .map((piece) =>
        [...(scheme.region ?? []), ...piece].reduce(
          (poly, bound) => (poly.length ? clip(poly, bound) : poly),
          TRIANGLE,
        ),
      )
      .filter((poly) => poly.length >= 3)
      .map((poly) => poly.map((p) => project(p))),
  }));
}

// Bounds on single parts, written as k·(a, b, c) ≥ min.
const at = (i: 0 | 1 | 2, sign: 1 | -1, min: number, strict = false): Bound => ({
  k: [i === 0 ? sign : 0, i === 1 ? sign : 0, i === 2 ? sign : 0] as Parts,
  min: sign * min,
  strict,
});
const atLeast = (i: 0 | 1 | 2, min: number) => at(i, 1, min);
const above = (i: 0 | 1 | 2, min: number) => at(i, 1, min, true);
const below = (i: 0 | 1 | 2, max: number) => at(i, -1, max, true);
const atMost = (i: 0 | 1 | 2, max: number) => at(i, -1, max);
const SAND = 0;
const SILT = 1;
const CLAY = 2;

/**
 * The USDA soil texture triangle, from the class rules of the USDA Natural Resources Conservation Service soil
 * texture calculator (public domain). a = sand, b = silt, c = clay.
 */
export const USDA: Scheme = {
  id: 'usda',
  parts: ['sand', 'silt', 'clay'],
  source: 'USDA Natural Resources Conservation Service, soil texture classes (public domain)',
  fields: [
    { id: 'sand', pieces: [[{ k: [0, -1, -1.5], min: -15, strict: true }]] },
    {
      id: 'loamySand',
      pieces: [
        [
          { k: [0, 1, 1.5], min: 15 },
          { k: [0, -1, -2], min: -30, strict: true },
        ],
      ],
    },
    {
      id: 'sandyLoam',
      pieces: [
        [atLeast(CLAY, 7), below(CLAY, 20), above(SAND, 52), { k: [0, 1, 2], min: 30 }],
        [below(CLAY, 7), below(SILT, 50), { k: [0, 1, 2], min: 30 }],
      ],
    },
    { id: 'loam', pieces: [[atLeast(CLAY, 7), below(CLAY, 27), atLeast(SILT, 28), below(SILT, 50), atMost(SAND, 52)]] },
    {
      id: 'siltLoam',
      pieces: [
        [atLeast(SILT, 50), atLeast(CLAY, 12), below(CLAY, 27)],
        [atLeast(SILT, 50), below(SILT, 80), below(CLAY, 12)],
      ],
    },
    { id: 'silt', pieces: [[atLeast(SILT, 80), below(CLAY, 12)]] },
    { id: 'sandyClayLoam', pieces: [[atLeast(CLAY, 20), below(CLAY, 35), below(SILT, 28), above(SAND, 45)]] },
    { id: 'clayLoam', pieces: [[atLeast(CLAY, 27), below(CLAY, 40), above(SAND, 20), atMost(SAND, 45)]] },
    { id: 'siltyClayLoam', pieces: [[atLeast(CLAY, 27), below(CLAY, 40), atMost(SAND, 20)]] },
    { id: 'sandyClay', pieces: [[atLeast(CLAY, 35), above(SAND, 45)]] },
    { id: 'siltyClay', pieces: [[atLeast(CLAY, 40), atLeast(SILT, 40)]] },
    { id: 'clay', pieces: [[atLeast(CLAY, 40), atMost(SAND, 45), below(SILT, 40)]] },
  ],
};

const Q = 2;

/** P/(A + P) ≥ r (as a fraction), which is −r·A + (1 − r)·P ≥ 0. */
const ratioAtLeast = (r: number): Bound => ({ k: [-r, 1 - r, 0], min: 0 });
const ratioBelow = (r: number): Bound => ({ k: [r, r - 1, 0], min: 0, strict: true });

const QAPF_ROWS: readonly { id: string; q: readonly [number, number] }[] = [
  { id: 'q20', q: [20, 60] },
  { id: 'q5', q: [5, 20] },
  { id: 'q0', q: [0, 5] },
];

const QAPF_NAMES: Record<string, readonly string[]> = {
  q20: ['alkaliGranite', 'syenogranite', 'monzogranite', 'granodiorite', 'tonalite'],
  q5: ['quartzAlkaliSyenite', 'quartzSyenite', 'quartzMonzonite', 'quartzMonzodiorite', 'quartzDiorite'],
  q0: ['alkaliSyenite', 'syenite', 'monzonite', 'monzodiorite', 'diorite'],
};

const RATIOS = [0, 0.1, 0.35, 0.65, 0.9, 1];

/**
 * The upper (quartz) triangle of the IUGS QAPF diagram for plutonic rocks (Streckeisen 1976), with its boundaries
 * as published numbers: Q at 5, 20, 60, and 90 percent of Q + A + P, and P/(A + P) at 10, 35, 65, and 90 percent.
 * a = A (alkali feldspar), b = P (plagioclase), c = Q (quartz).
 */
export const QAPF: Scheme = {
  id: 'qapf',
  parts: ['alkali', 'plagioclase', 'quartz'],
  source: 'Streckeisen (1976), IUGS classification of plutonic rocks: field boundaries as published numbers',
  fields: [
    { id: 'quartzolite', pieces: [[above(Q, 90)]] },
    { id: 'quartzRich', pieces: [[above(Q, 60), atMost(Q, 90)]] },
    ...QAPF_ROWS.flatMap((row) =>
      QAPF_NAMES[row.id].map((id, i) => ({
        id,
        pieces: [
          [
            row.id === 'q0' ? atLeast(Q, 0) : above(Q, row.q[0]),
            atMost(Q, row.q[1]),
            ...(i > 0 ? [ratioAtLeast(RATIOS[i])] : []),
            ...(i < 4 ? [ratioBelow(RATIOS[i + 1])] : []),
          ],
        ],
      })),
    ),
  ],
};

export const SCHEMES = { usda: USDA, qapf: QAPF } as const;
