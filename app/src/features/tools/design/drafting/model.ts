// checks-disable-file modifiability: reading a saved sheet checks each field in turn, in one place

// The drafting sheet's document: geometry in millimeters on the sheet (y up), live dimensions that follow the
// geometry, line types after the usual drafting conventions, and the snapping that lets a pen land on exact points.
// Pure TypeScript: the block editor, the SVG export, and the tests all use these functions.

export type Pt = readonly [number, number];

// ---------- line types ----------

export type LineType = 'visible' | 'hidden' | 'center' | 'phantom' | 'dimension' | 'extension' | 'leader';

export interface LineStyle {
  id: LineType;
  /** Stroke width in millimeters: thick lines are 0.6 and thin lines 0.3. */
  weight: number;
  /** Dash and gap lengths in millimeters, empty for a continuous line. */
  dash: readonly number[];
}

/**
 * Written from the conventions rather than copied from art: visible edges are thick and continuous; hidden edges
 * are thin short dashes; center lines are thin long-short-long; phantom lines are thin long-short-short; dimension,
 * extension and leader lines are thin and continuous.
 */
export const LINE_TYPES: Record<LineType, LineStyle> = {
  visible: { id: 'visible', weight: 0.6, dash: [] },
  hidden: { id: 'hidden', weight: 0.3, dash: [3, 1.5] },
  center: { id: 'center', weight: 0.3, dash: [18, 3, 3, 3] },
  phantom: { id: 'phantom', weight: 0.3, dash: [18, 3, 3, 3, 3, 3] },
  dimension: { id: 'dimension', weight: 0.3, dash: [] },
  extension: { id: 'extension', weight: 0.3, dash: [] },
  leader: { id: 'leader', weight: 0.3, dash: [] },
};

export const DRAWN_LINE_TYPES: readonly LineType[] = ['visible', 'hidden', 'center', 'phantom'];

// ---------- entities ----------

export type Entity =
  | { id: string; k: 'line'; a: Pt; b: Pt; lt: LineType }
  | { id: string; k: 'rect'; a: Pt; b: Pt; lt: LineType }
  | { id: string; k: 'circle'; c: Pt; r: number; lt: LineType }
  | { id: string; k: 'arc'; c: Pt; r: number; a0: number; a1: number; lt: LineType }
  | { id: string; k: 'poly'; pts: readonly Pt[]; closed: boolean; lt: LineType }
  | { id: string; k: 'note'; p: Pt; text: string }
  | { id: string; k: 'hatch'; of: string; spacing: number; angle: number };

export type Ref = { id: string; at: string } | { x: number; y: number };

export interface Tol {
  mode: 'bilateral' | 'limits';
  plus: number;
  minus: number;
}

export type Dim =
  | { id: string; k: 'linear'; a: Ref; b: Ref; axis: 'h' | 'v'; off: number; tol?: Tol }
  | { id: string; k: 'aligned'; a: Ref; b: Ref; off: number; tol?: Tol }
  | { id: string; k: 'angular'; l1: string; l2: string; r: number; supp?: boolean }
  | { id: string; k: 'radius' | 'diameter'; of: string; ang: number; tol?: Tol };

export type Units = 'mm' | 'in';

export interface Scale {
  /** Drawing size : true size, so 1:2 is drawing 1, actual 2 (the drawing is half size). */
  drawing: number;
  actual: number;
}

export const TITLE_KEYS = ['title', 'drawnBy', 'date', 'scale', 'sheet', 'material', 'tolerance'] as const;
export type TitleKey = (typeof TITLE_KEYS)[number];

export interface DraftingDoc {
  units: Units;
  scale: Scale;
  decimals: number;
  dual: boolean;
  sheet: SheetId;
  gridMm: number;
  entities: Entity[];
  dims: Dim[];
  title: Record<TitleKey, string>;
}

export type SheetId = 'ansiA' | 'ansiB' | 'a4' | 'a3';

/** Landscape sheet sizes in millimeters. */
export const SHEET_MM: Record<SheetId, readonly [number, number]> = {
  ansiA: [279.4, 215.9],
  ansiB: [431.8, 279.4],
  a4: [297, 210],
  a3: [420, 297],
};

export const MM_PER_IN = 25.4;
export const MAX_ENTITIES = 400;
export const MAX_DIMS = 200;

export function emptyDoc(units: Units = 'mm', sheet: SheetId = units === 'mm' ? 'a4' : 'ansiA'): DraftingDoc {
  return {
    units,
    scale: { drawing: 1, actual: 1 },
    decimals: units === 'mm' ? 2 : 3,
    dual: false,
    sheet,
    gridMm: 5,
    entities: [],
    dims: [],
    title: { title: '', drawnBy: '', date: '', scale: '', sheet: '', material: '', tolerance: '' },
  };
}

/** The drawing-to-true size factor, 0.5 for a 1:2 scale. */
export const scaleFactor = (s: Scale): number => s.drawing / s.actual;

/** Reads "1:2", "2:1" or "1:1" (spaces allowed); null when it is not a positive ratio. */
export function parseScale(text: string): Scale | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const drawing = Number(m[1]);
  const actual = Number(m[2]);
  if (!(drawing > 0) || !(actual > 0) || drawing / actual > 1000 || actual / drawing > 1000) return null;
  return { drawing, actual };
}

export const scaleText = (s: Scale): string => `${s.drawing}:${s.actual}`;

// ---------- geometry ----------

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

/** Normalized rectangle corners: bottom-left, bottom-right, top-right, top-left. */
export function rectCorners(a: Pt, b: Pt): [Pt, Pt, Pt, Pt] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** The named points of an entity that a dimension or a snap can use. */
export function anchors(e: Entity): { at: string; p: Pt }[] {
  switch (e.k) {
    case 'line':
      return [
        { at: 'a', p: e.a },
        { at: 'b', p: e.b },
        { at: 'mid', p: mid(e.a, e.b) },
      ];
    case 'rect': {
      const [bl, br, tr, tl] = rectCorners(e.a, e.b);
      return [
        { at: 'bl', p: bl },
        { at: 'br', p: br },
        { at: 'tr', p: tr },
        { at: 'tl', p: tl },
        { at: 'mid', p: mid(bl, tr) },
      ];
    }
    case 'circle':
      return [
        { at: 'c', p: e.c },
        { at: 'e', p: [e.c[0] + e.r, e.c[1]] },
        { at: 'n', p: [e.c[0], e.c[1] + e.r] },
        { at: 'w', p: [e.c[0] - e.r, e.c[1]] },
        { at: 's', p: [e.c[0], e.c[1] - e.r] },
      ];
    case 'arc':
      return [
        { at: 'c', p: e.c },
        { at: 'start', p: [e.c[0] + e.r * Math.cos(rad(e.a0)), e.c[1] + e.r * Math.sin(rad(e.a0))] },
        { at: 'end', p: [e.c[0] + e.r * Math.cos(rad(e.a1)), e.c[1] + e.r * Math.sin(rad(e.a1))] },
      ];
    case 'poly':
      return e.pts.map((p, i) => ({ at: `p${i}`, p }));
    case 'note':
      return [{ at: 'p', p: e.p }];
    case 'hatch':
      return [];
  }
}

export function findEntity(doc: DraftingDoc, id: string): Entity | undefined {
  return doc.entities.find((e) => e.id === id);
}

/** The point a reference stands for, or null when its entity or anchor is gone. */
export function resolve(ref: Ref, doc: DraftingDoc): Pt | null {
  if ('x' in ref) return [ref.x, ref.y];
  const e = findEntity(doc, ref.id);
  if (!e) return null;
  return anchors(e).find((a) => a.at === ref.at)?.p ?? null;
}

/** The straight pieces of an entity (lines, rectangle sides, polygon edges). */
export function segments(e: Entity): [Pt, Pt][] {
  switch (e.k) {
    case 'line':
      return [[e.a, e.b]];
    case 'rect': {
      const c = rectCorners(e.a, e.b);
      return [
        [c[0], c[1]],
        [c[1], c[2]],
        [c[2], c[3]],
        [c[3], c[0]],
      ];
    }
    case 'poly': {
      const out: [Pt, Pt][] = [];
      for (let i = 0; i + 1 < e.pts.length; i++) out.push([e.pts[i]!, e.pts[i + 1]!]);
      if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1]!, e.pts[0]!]);
      return out;
    }
    default:
      return [];
  }
}

// ---------- dimensions ----------

export interface DimValue {
  /** The measured value in the drawing's units at true size (degrees for an angle). */
  value: number;
  /** The numbers the drawing needs to place the dimension. */
  geom: DimGeometry;
}

export type DimGeometry =
  | { k: 'aligned'; a: Pt; b: Pt; a2: Pt; b2: Pt; text: Pt; angle: number }
  | { k: 'angular'; center: Pt; r: number; from: number; to: number; text: Pt; p1: Pt; p2: Pt }
  | { k: 'radius'; center: Pt; edge: Pt; end: Pt; text: Pt; angle: number }
  | { k: 'diameter'; center: Pt; p: Pt; q: Pt; text: Pt; angle: number };

export type DimProblem = 'missing' | 'parallel' | 'notRound' | 'notLine';

/** Intersection of two infinite lines, or null when they are parallel. */
export function lineIntersection(p: Pt, p2: Pt, q: Pt, q2: Pt): Pt | null {
  const r: Pt = [p2[0] - p[0], p2[1] - p[1]];
  const s: Pt = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  return [p[0] + t * r[0], p[1] + t * r[1]];
}

/** Measures a dimension from the current geometry. Distances are divided by the drawing scale to give true size. */
export function measure(d: Dim, doc: DraftingDoc): DimValue | DimProblem {
  // Geometry is kept in millimeters on the sheet; a dimension reads in the drawing's units at true size.
  const f = scaleFactor(doc.scale) * (doc.units === 'in' ? MM_PER_IN : 1);
  switch (d.k) {
    case 'linear':
    case 'aligned': {
      const a = resolve(d.a, doc);
      const b = resolve(d.b, doc);
      if (!a || !b) return 'missing';
      let a2: Pt;
      let b2: Pt;
      let value: number;
      let angle: number;
      if (d.k === 'aligned') {
        value = dist(a, b) / f;
        const len = dist(a, b) || 1;
        const n: Pt = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        a2 = [a[0] + n[0] * d.off, a[1] + n[1] * d.off];
        b2 = [b[0] + n[0] * d.off, b[1] + n[1] * d.off];
        angle = deg(Math.atan2(b[1] - a[1], b[0] - a[0]));
      } else if (d.axis === 'h') {
        value = Math.abs(b[0] - a[0]) / f;
        const y = d.off >= 0 ? Math.max(a[1], b[1]) + d.off : Math.min(a[1], b[1]) + d.off;
        a2 = [a[0], y];
        b2 = [b[0], y];
        angle = 0;
      } else {
        value = Math.abs(b[1] - a[1]) / f;
        const x = d.off >= 0 ? Math.max(a[0], b[0]) + d.off : Math.min(a[0], b[0]) + d.off;
        a2 = [x, a[1]];
        b2 = [x, b[1]];
        angle = 90;
      }
      return { value, geom: { k: 'aligned', a, b, a2, b2, text: mid(a2, b2), angle } };
    }
    case 'angular': {
      const e1 = findEntity(doc, d.l1);
      const e2 = findEntity(doc, d.l2);
      if (!e1 || !e2) return 'missing';
      if (e1.k !== 'line' || e2.k !== 'line') return 'notLine';
      const x = lineIntersection(e1.a, e1.b, e2.a, e2.b);
      if (!x) return 'parallel';
      const far = (e: { a: Pt; b: Pt }): Pt => (dist(e.a, x) >= dist(e.b, x) ? e.a : e.b);
      const p1 = far(e1);
      let p2 = far(e2);
      const a1 = Math.atan2(p1[1] - x[1], p1[0] - x[0]);
      let a2 = Math.atan2(p2[1] - x[1], p2[0] - x[0]);
      // Two crossing lines make an acute angle and its supplement. Which one is measured must not depend on the order
      // the endpoints were drawn in, so the second ray is turned to the acute side, or to the obtuse one when asked.
      const acute = Math.cos(a1) * Math.cos(a2) + Math.sin(a1) * Math.sin(a2) >= 0;
      if (acute === (d.supp === true)) {
        a2 += Math.PI;
        p2 = [2 * x[0] - p2[0], 2 * x[1] - p2[1]];
      }
      const cross = Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2);
      const dot = Math.cos(a1) * Math.cos(a2) + Math.sin(a1) * Math.sin(a2);
      const between = deg(Math.atan2(Math.abs(cross), dot));
      // Draw the arc counterclockwise from the first ray to the second when that is the short way round.
      const from = cross >= 0 ? deg(a1) : deg(a2);
      const to = from + between;
      const midA = rad(from + between / 2);
      return {
        value: between,
        geom: {
          k: 'angular',
          center: x,
          r: d.r,
          from,
          to,
          text: [x[0] + (d.r + 3) * Math.cos(midA), x[1] + (d.r + 3) * Math.sin(midA)],
          p1,
          p2,
        },
      };
    }
    case 'radius':
    case 'diameter': {
      const e = findEntity(doc, d.of);
      if (!e) return 'missing';
      if (e.k !== 'circle' && e.k !== 'arc') return 'notRound';
      const a = rad(d.ang);
      const dir: Pt = [Math.cos(a), Math.sin(a)];
      if (d.k === 'radius') {
        const edge: Pt = [e.c[0] + e.r * dir[0], e.c[1] + e.r * dir[1]];
        const end: Pt = [e.c[0] + (e.r + 6) * dir[0], e.c[1] + (e.r + 6) * dir[1]];
        return { value: e.r / f, geom: { k: 'radius', center: e.c, edge, end, text: end, angle: d.ang } };
      }
      const p: Pt = [e.c[0] - e.r * dir[0], e.c[1] - e.r * dir[1]];
      const q: Pt = [e.c[0] + e.r * dir[0], e.c[1] + e.r * dir[1]];
      return {
        value: (2 * e.r) / f,
        geom: {
          k: 'diameter',
          center: e.c,
          p,
          q,
          text: [e.c[0] + (e.r + 4) * dir[0], e.c[1] + (e.r + 4) * dir[1]],
          angle: d.ang,
        },
      };
    }
  }
}

const fixed = (x: number, n: number): string => (Math.abs(x) < 0.5 * 10 ** -n ? 0 : x).toFixed(n);

/** Text for a measured value: "50.00", "R12.50 [0.492 in]", "⌀25.00", "90.0°", with the tolerance and the dual units. */
export function dimText(d: Dim, value: number, doc: DraftingDoc): string {
  const n = doc.decimals;
  if (d.k === 'angular') return `${fixed(value, 1)}°`;
  const alt = (x: number): string =>
    doc.units === 'mm' ? ` [${fixed(x / MM_PER_IN, 3)} in]` : ` [${fixed(x * MM_PER_IN, 2)} mm]`;
  const prefix = d.k === 'radius' ? 'R' : d.k === 'diameter' ? '⌀' : '';
  const tol = d.tol;
  let body: string;
  if (tol && tol.mode === 'limits') body = `${fixed(value + tol.plus, n)} / ${fixed(value - tol.minus, n)}`;
  else if (tol && tol.plus === tol.minus) body = `${fixed(value, n)} ±${fixed(tol.plus, n)}`;
  else if (tol) body = `${fixed(value, n)} +${fixed(tol.plus, n)}/-${fixed(tol.minus, n)}`;
  else body = fixed(value, n);
  return `${prefix}${body}${doc.dual ? alt(value) : ''}`;
}

export interface DimLine {
  id: string;
  kind: Dim['k'];
  text: string;
  value: number;
  problem: DimProblem | null;
}

/** Every dimension's current text, in order; a dimension whose geometry is gone reports why. */
export function dimLines(doc: DraftingDoc): DimLine[] {
  return doc.dims.map((d) => {
    const m = measure(d, doc);
    if (typeof m === 'string') return { id: d.id, kind: d.k, text: '', value: NaN, problem: m };
    return { id: d.id, kind: d.k, text: dimText(d, m.value, doc), value: m.value, problem: null };
  });
}

// ---------- hatching ----------

const CIRCLE_SIDES = 72;

/** The outline of a closed entity as a polygon, or null when it is not closed. */
export function outline(e: Entity | undefined): Pt[] | null {
  if (!e) return null;
  if (e.k === 'rect') return rectCorners(e.a, e.b);
  if (e.k === 'poly' && e.closed && e.pts.length >= 3) return [...e.pts];
  if (e.k === 'circle') {
    return Array.from({ length: CIRCLE_SIDES }, (_, i) => {
      const a = (2 * Math.PI * i) / CIRCLE_SIDES;
      return [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)] as Pt;
    });
  }
  return null;
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(a) / 2;
}

/**
 * Parallel hatch lines clipped to a polygon, at `angle` degrees and `spacing` mm apart (even-odd fill, so a shape
 * with a self-crossing is hatched sensibly). Lines sit on multiples of the spacing so neighboring hatches match.
 */
export function hatchLines(poly: readonly Pt[], spacing: number, angle: number): [Pt, Pt][] {
  if (poly.length < 3 || !(spacing > 0.05)) return [];
  const a = rad(angle);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Rotate by -angle so the hatch lines are horizontal.
  const rot = poly.map((p): Pt => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]);
  const ys = rot.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  if ((hi - lo) / spacing > 2000) return [];
  const out: [Pt, Pt][] = [];
  for (let k = Math.ceil(lo / spacing); k * spacing <= hi; k++) {
    // Nudge off a vertex so a line through a corner does not count it twice.
    const y = k * spacing + 1e-9;
    const xs: number[] = [];
    for (let i = 0; i < rot.length; i++) {
      const p = rot[i]!;
      const q = rot[(i + 1) % rot.length]!;
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) {
        xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      out.push([
        [x0 * c - y * s, x0 * s + y * c],
        [x1 * c - y * s, x1 * s + y * c],
      ]);
    }
  }
  return out;
}

// ---------- snapping ----------

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'center' | 'grid';

export interface Snap {
  p: Pt;
  kind: SnapKind;
}

export interface SnapOptions {
  endpoint: boolean;
  midpoint: boolean;
  center: boolean;
  intersection: boolean;
  grid: boolean;
}

export const ALL_SNAPS: SnapOptions = { endpoint: true, midpoint: true, center: true, intersection: true, grid: true };

function segSeg(p: Pt, p2: Pt, q: Pt, q2: Pt): Pt | null {
  const r: Pt = [p2[0] - p[0], p2[1] - p[1]];
  const s: Pt = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
  const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [p[0] + t * r[0], p[1] + t * r[1]];
}

function segCircle(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  const f: Pt = [a[0] - c[0], a[1] - c[1]];
  const A = d[0] * d[0] + d[1] * d[1];
  if (A < 1e-18) return [];
  const B = 2 * (f[0] * d[0] + f[1] * d[1]);
  const C = f[0] * f[0] + f[1] * f[1] - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  const out: Pt[] = [];
  for (const t of disc === 0 ? [-B / (2 * A)] : [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push([a[0] + t * d[0], a[1] + t * d[1]]);
  }
  return out;
}

/** Every intersection between two entities' lines and circles. */
export function intersections(doc: DraftingDoc): Pt[] {
  const out: Pt[] = [];
  const es = doc.entities;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const a = es[i]!;
      const b = es[j]!;
      for (const s of segments(a)) {
        for (const t of segments(b)) {
          const x = segSeg(s[0], s[1], t[0], t[1]);
          if (x) out.push(x);
        }
        if (b.k === 'circle') out.push(...segCircle(s[0], s[1], b.c, b.r));
      }
      if (a.k === 'circle') for (const t of segments(b)) out.push(...segCircle(t[0], t[1], a.c, a.r));
    }
  }
  return out;
}

/**
 * The nearest snap to a point within `reach` mm. Exact geometry wins over the grid: endpoints first, then
 * intersections, midpoints and centers, and the grid only when nothing else is close.
 */
export function snap(doc: DraftingDoc, p: Pt, reach: number, options: SnapOptions = ALL_SNAPS): Snap {
  const found: { s: Snap; rank: number }[] = [];
  const push = (q: Pt, kind: SnapKind, rank: number) => {
    if (dist(p, q) <= reach) found.push({ s: { p: q, kind }, rank });
  };
  for (const e of doc.entities) {
    for (const a of anchors(e)) {
      if (a.at === 'mid' && options.midpoint) push(a.p, 'midpoint', 2);
      else if (a.at === 'c' && options.center) push(a.p, 'center', 3);
      else if (
        ['a', 'b', 'bl', 'br', 'tr', 'tl', 'start', 'end', 'e', 'n', 'w', 's', 'p'].includes(a.at) ||
        a.at.startsWith('p')
      ) {
        if (options.endpoint) push(a.p, 'endpoint', 0);
      }
    }
  }
  if (options.intersection) for (const x of intersections(doc)) push(x, 'intersection', 1);
  if (found.length > 0) {
    found.sort((m, n) => m.rank - n.rank || dist(p, m.s.p) - dist(p, n.s.p));
    // Prefer a closer point of the same or next rank over a far one of a better rank.
    return found[0]!.s;
  }
  if (options.grid && doc.gridMm > 0) {
    const g = doc.gridMm;
    return { p: [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], kind: 'grid' };
  }
  return { p, kind: 'grid' };
}

// ---------- reading a saved block ----------

const finiteNum = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  Math.min(hi, Math.max(lo, finiteNum(v, fallback)));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asPt = (v: unknown): Pt | null =>
  Array.isArray(v) &&
  v.length === 2 &&
  typeof v[0] === 'number' &&
  typeof v[1] === 'number' &&
  Number.isFinite(v[0]) &&
  Number.isFinite(v[1])
    ? [v[0], v[1]]
    : null;
const COORD = 100_000;
const clampPt = (p: Pt): Pt => [Math.min(COORD, Math.max(-COORD, p[0])), Math.min(COORD, Math.max(-COORD, p[1]))];
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const lineType = (v: unknown): LineType => (typeof v === 'string' && v in LINE_TYPES ? (v as LineType) : 'visible');

function readTol(v: unknown): Tol | undefined {
  if (!isRecord(v)) return undefined;
  return {
    mode: v.mode === 'limits' ? 'limits' : 'bilateral',
    plus: Math.max(0, finiteNum(v.plus, 0)),
    minus: Math.max(0, finiteNum(v.minus, 0)),
  };
}

function readRef(v: unknown): Ref | null {
  if (!isRecord(v)) return null;
  if (typeof v.id === 'string' && typeof v.at === 'string') return { id: v.id, at: v.at };
  if (typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y))
    return { x: v.x, y: v.y };
  return null;
}

/** Reads a saved document, dropping anything it cannot understand. Unknown things never throw. */
export function readDoc(raw: unknown): DraftingDoc {
  const base = emptyDoc();
  if (!isRecord(raw)) return base;
  const units: Units = raw.units === 'in' ? 'in' : 'mm';
  const sheet = (typeof raw.sheet === 'string' && raw.sheet in SHEET_MM ? raw.sheet : base.sheet) as SheetId;
  const sc = isRecord(raw.scale) ? raw.scale : {};
  const doc: DraftingDoc = {
    units,
    scale: {
      drawing: num(sc.drawing, 0.001, 1000, 1),
      actual: num(sc.actual, 0.001, 1000, 1),
    },
    decimals: Math.round(num(raw.decimals, 0, 5, units === 'mm' ? 2 : 3)),
    dual: raw.dual === true,
    sheet,
    gridMm: num(raw.gridMm, 0, 50, 5),
    entities: [],
    dims: [],
    title: { ...base.title },
  };
  if (isRecord(raw.title)) for (const k of TITLE_KEYS) doc.title[k] = str(raw.title[k], 80);
  const ids = new Set<string>();
  const newId = (v: unknown): string | null => {
    const id = typeof v === 'string' && v.length > 0 && v.length <= 24 ? v : null;
    if (!id || ids.has(id)) return null;
    ids.add(id);
    return id;
  };
  for (const item of Array.isArray(raw.entities) ? raw.entities.slice(0, MAX_ENTITIES) : []) {
    if (!isRecord(item)) continue;
    const id = newId(item.id);
    if (!id) continue;
    const lt = lineType(item.lt);
    const a = asPt(item.a);
    const b = asPt(item.b);
    const c = asPt(item.c);
    switch (item.k) {
      case 'line':
      case 'rect':
        if (a && b) doc.entities.push({ id, k: item.k, a: clampPt(a), b: clampPt(b), lt });
        break;
      case 'circle':
        if (c && finiteNum(item.r, 0) > 0)
          doc.entities.push({ id, k: 'circle', c: clampPt(c), r: num(item.r, 0.001, COORD, 1), lt });
        break;
      case 'arc':
        if (c && finiteNum(item.r, 0) > 0) {
          doc.entities.push({
            id,
            k: 'arc',
            c: clampPt(c),
            r: num(item.r, 0.001, COORD, 1),
            a0: finiteNum(item.a0, 0),
            a1: finiteNum(item.a1, 90),
            lt,
          });
        }
        break;
      case 'poly': {
        const pts = (Array.isArray(item.pts) ? item.pts : [])
          .slice(0, 200)
          .map(asPt)
          .filter((p): p is Pt => p !== null)
          .map(clampPt);
        if (pts.length >= 2) doc.entities.push({ id, k: 'poly', pts, closed: item.closed === true, lt });
        break;
      }
      case 'note': {
        const p = asPt(item.p);
        if (p) doc.entities.push({ id, k: 'note', p: clampPt(p), text: str(item.text, 200) });
        break;
      }
      case 'hatch':
        if (typeof item.of === 'string') {
          doc.entities.push({
            id,
            k: 'hatch',
            of: item.of,
            spacing: num(item.spacing, 0.5, 50, 3),
            angle: finiteNum(item.angle, 45),
          });
        }
        break;
      default:
        break;
    }
  }
  for (const item of Array.isArray(raw.dims) ? raw.dims.slice(0, MAX_DIMS) : []) {
    if (!isRecord(item)) continue;
    const id = newId(item.id);
    if (!id) continue;
    const tol = readTol(item.tol);
    const withTol = tol ? { tol } : {};
    if (item.k === 'linear' || item.k === 'aligned') {
      const a = readRef(item.a);
      const b = readRef(item.b);
      if (!a || !b) continue;
      const off = num(item.off, -1000, 1000, 8);
      if (item.k === 'linear')
        doc.dims.push({ id, k: 'linear', a, b, axis: item.axis === 'v' ? 'v' : 'h', off, ...withTol });
      else doc.dims.push({ id, k: 'aligned', a, b, off, ...withTol });
    } else if (item.k === 'angular' && typeof item.l1 === 'string' && typeof item.l2 === 'string') {
      doc.dims.push({
        id,
        k: 'angular',
        l1: item.l1,
        l2: item.l2,
        r: num(item.r, 1, 1000, 12),
        ...(item.supp === true ? { supp: true } : {}),
      });
    } else if ((item.k === 'radius' || item.k === 'diameter') && typeof item.of === 'string') {
      doc.dims.push({ id, k: item.k, of: item.of, ang: finiteNum(item.ang, 45), ...withTol });
    }
  }
  return doc;
}

/** The text fallback: one line per dimension, so search and read-aloud keep the numbers. */
export function fallbackText(
  doc: DraftingDoc,
  labels: { head: string; none: string; kinds: Record<Dim['k'], string> },
): string {
  const lines = dimLines(doc).filter((l) => l.problem === null);
  const scale = scaleText(doc.scale);
  const head = `${labels.head} (${doc.units}, ${scale})`;
  if (lines.length === 0) return `${head}: ${labels.none}`;
  return `${head}:\n${lines.map((l) => `- ${labels.kinds[l.kind]} ${l.text}`).join('\n')}`;
}
