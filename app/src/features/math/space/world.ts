// Turns a 3D graph's text into geometry in graph units: faces of surfaces and planes, polylines of curves and lines,
// arrows, and dots, inside one box. Nothing here depends on the camera, so turning the view only projects again.
import type { ExpressionProblem } from '../grapher/evaluate';
import { DEFAULT_T } from '../grapher/curves';
import { contourLevels, levelCurves, type Grid2, type LevelCurve } from './contour';
import { compileMulti, partialDerivative, type MultiExpression } from './multivar';
import { readItem, type SpaceItem, type SpaceSource } from './source3d';
import { add, cross, dot, norm, scale, sub, type Vec3 } from './vec';
import type { Line3, Plane } from './geometry3d';

export interface Box3 {
  readonly min: Vec3;
  readonly max: Vec3;
  /** One scale on every axis (vectors, points, solids), so lengths and angles look true. */
  readonly equal?: boolean;
}

/** What a face or line is, which sets its color. */
export type Role = 'surface' | 'tangent' | 'plane' | 'solid' | 'inner' | 'curve' | 'line' | 'vector' | 'contour';

export interface WorldFace {
  readonly points: readonly Vec3[];
  readonly role: Role;
  /** Which item it belongs to, for its color. */
  readonly series: number;
  /** The height from 0 (lowest) to 1, for the surface's colors. */
  readonly tone: number;
  /** How brightly it is lit, from 0 to 1. */
  readonly light: number;
}

export interface WorldLine {
  readonly points: readonly Vec3[];
  readonly role: Role;
  readonly series: number;
  readonly tone?: number;
}

export interface WorldArrow {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly series: number;
}

export interface WorldDot {
  readonly at: Vec3;
  readonly series: number;
  readonly role: 'point' | 'tangent';
}

export interface Tangent {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly fx: number;
  readonly fy: number;
}

export interface World {
  readonly box: Box3;
  readonly faces: readonly WorldFace[];
  readonly lines: readonly WorldLine[];
  readonly arrows: readonly WorldArrow[];
  readonly dots: readonly WorldDot[];
  /** One entry per item: its problem, or null. */
  readonly problems: readonly (ExpressionProblem | null)[];
  readonly kinds: readonly SpaceItem['kind'][];
  readonly tangent: Tangent | null;
  /** The first surface's level curves and grid, for the contour plot. */
  readonly contours: readonly LevelCurve[];
  readonly grid: Grid2 | null;
}

const VARS = ['x', 'y'];
const DEFAULT_RANGE = [-3, 3, -3, 3] as const;
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.45, -0.55, 0.7];
  return scale(v, 1 / norm(v));
})();

interface Surface {
  index: number;
  expression: MultiExpression;
  grid: Grid2;
}

function sampleSurface(expression: MultiExpression, range: readonly number[], params: object, n: number): Grid2 {
  const xs = Array.from({ length: n + 1 }, (_, i) => range[0] + ((range[1] - range[0]) * i) / n);
  const ys = Array.from({ length: n + 1 }, (_, j) => range[2] + ((range[3] - range[2]) * j) / n);
  const z = ys.map((y) => xs.map((x) => expression.evaluate({ ...params, x, y })));
  return { xs, ys, z };
}

/** A z range that ignores the few points of a spike, such as 1/(x^2 + y^2) near the origin. */
function robustRange(values: number[]): [number, number] | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const pick = (q: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))];
  let [low, high] = [pick(0.02), pick(0.98)];
  if (finite[0] >= low - (high - low) * 0.5) low = finite[0];
  if (finite.at(-1)! <= high + (high - low) * 0.5) high = finite.at(-1)!;
  if (high - low < 1e-9) [low, high] = [low - 1, high + 1];
  return [low, high];
}

/** The slab test: the part of a line inside the box, as two points, or null. */
export function clipLineToBox(line: Line3, box: Box3): [Vec3, Vec3] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const p = line.point[k];
    const d = line.direction[k];
    if (Math.abs(d) < 1e-15) {
      if (p < box.min[k] || p > box.max[k]) return null;
      continue;
    }
    const [a, b] = [(box.min[k] - p) / d, (box.max[k] - p) / d];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t0 < t1)) return null;
  return [add(line.point, scale(line.direction, t0)), add(line.point, scale(line.direction, t1))];
}

/** The polygon where a plane cuts the box, corners in order around it. Empty when it misses. */
export function planeInBox(plane: Plane, box: Box3): Vec3[] {
  const corner = (i: number): Vec3 => [
    i & 1 ? box.max[0] : box.min[0],
    i & 2 ? box.max[1] : box.min[1],
    i & 4 ? box.max[2] : box.min[2],
  ];
  const points: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const [a, b] = [corner(i), corner(i | bit)];
      const [fa, fb] = [dot(plane.normal, a) - plane.d, dot(plane.normal, b) - plane.d];
      if (fa === 0) points.push(a);
      if (fa * fb < 0) points.push(add(a, scale(sub(b, a), fa / (fa - fb))));
    }
  }
  if (points.length < 3) return [];
  const center = scale(points.reduce(add), 1 / points.length);
  const n = plane.normal;
  const u = norm(cross(n, [0, 0, 1])) > 1e-9 ? cross(n, [0, 0, 1]) : cross(n, [0, 1, 0]);
  const v = cross(n, u);
  const angle = (p: Vec3) => Math.atan2(dot(sub(p, center), v), dot(sub(p, center), u));
  return points.sort((p, q) => angle(p) - angle(q));
}

function lightOf(points: readonly Vec3[], box: Box3): number {
  const span = sub(box.max, box.min);
  const unit = (p: Vec3): Vec3 => [p[0] / span[0], p[1] / span[1], p[2] / span[2]];
  const n = cross(sub(unit(points[1]), unit(points[0])), sub(unit(points[2]), unit(points[0])));
  const length = norm(n);
  return length === 0 ? 0.85 : 0.66 + 0.34 * Math.abs(dot(n, LIGHT) / length);
}

/** Surfaces are sampled on an n by n grid: fine enough to look smooth, coarse enough to turn without lag. */
const GRID = 30;

export function buildWorld(space: SpaceSource): World {
  const items = space.items.map(readItem);
  const params = space.params;
  const names = Object.keys(params);
  const range = space.range ?? DEFAULT_RANGE;
  const problems: (ExpressionProblem | null)[] = items.map(() => null);
  const surfaces: Surface[] = [];
  items.forEach((item, index) => {
    if (item.kind !== 'surface') return;
    const read = compileMulti(item.source, VARS, names);
    if (!read.ok) problems[index] = read.error;
    else
      surfaces.push({ index, expression: read.expression, grid: sampleSurface(read.expression, range, params, GRID) });
  });

  // The box: x and y from the range; z from the surfaces, or from everything else when there is none.
  const zs = surfaces.flatMap((s) => s.grid.z.flat());
  const others = objectPoints(items, space);
  for (const p of others) zs.push(p[2]);
  const zRange = space.zRange ?? robustRange(zs) ?? [-3, 3];
  const box: Box3 = fitBox(space, range, zRange, others, surfaces.length > 0);

  const faces: WorldFace[] = [];
  const lines: WorldLine[] = [];
  const arrows: WorldArrow[] = [];
  const dots: WorldDot[] = [];
  const zSpan = box.max[2] - box.min[2];
  const inside = (z: number) => Number.isFinite(z) && z >= box.min[2] - zSpan * 0.02 && z <= box.max[2] + zSpan * 0.02;

  for (const surface of surfaces) {
    const { xs, ys, z } = surface.grid;
    for (let j = 0; j < ys.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        const corners: Vec3[] = [
          [xs[i], ys[j], z[j][i]],
          [xs[i + 1], ys[j], z[j][i + 1]],
          [xs[i + 1], ys[j + 1], z[j + 1][i + 1]],
          [xs[i], ys[j + 1], z[j + 1][i]],
        ];
        if (!corners.every((p) => inside(p[2]))) continue;
        const mean = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4;
        const tone = Math.min(1, Math.max(0, (mean - box.min[2]) / zSpan));
        faces.push({ points: corners, role: 'surface', series: surface.index, tone, light: lightOf(corners, box) });
      }
    }
  }

  const first = surfaces[0] ?? null;
  const contours = first ? levelCurves(first.grid, contourLevels(box.min[2], box.max[2], 10)) : [];
  if (first && space.show === 'both') {
    for (const curve of contours) {
      const tone = (curve.level - box.min[2]) / zSpan;
      for (const [x1, y1, x2, y2] of curve.segments) {
        const points: Vec3[] = [
          [x1, y1, box.min[2]],
          [x2, y2, box.min[2]],
        ];
        lines.push({ points, role: 'contour', series: first.index, tone });
      }
    }
  }

  const tangent = first && space.tangent ? tangentAt(first, space, names) : null;
  if (tangent && first) addTangent(tangent, range, box, faces, dots);

  const t = space.t ?? DEFAULT_T;
  items.forEach((item, index) => {
    if (item.kind === 'curve') {
      const parts = item.parts.map((part) => compileMulti(part, ['t'], names));
      const bad = parts.find((part) => !part.ok);
      if (bad && !bad.ok) return void (problems[index] = bad.error);
      const run: Vec3[] = [];
      for (let k = 0; k <= 400; k++) {
        const tk = t[0] + ((t[1] - t[0]) * k) / 400;
        const p = parts.map((part) => (part.ok ? part.expression.evaluate({ ...params, t: tk }) : NaN));
        if (p.every(Number.isFinite)) run.push([p[0], p[1], p[2]]);
        else if (run.length > 1) lines.push({ points: run.splice(0), role: 'curve', series: index });
        else run.length = 0;
      }
      if (run.length > 1) lines.push({ points: run, role: 'curve', series: index });
    } else if (item.kind === 'vector') {
      arrows.push({ from: item.tail, to: add(item.tail, item.head), series: index });
    } else if (item.kind === 'point') {
      dots.push({ at: item.at, series: index, role: 'point' });
    } else if (item.kind === 'line') {
      const clipped = clipLineToBox(item.line, box);
      if (clipped) lines.push({ points: clipped, role: 'line', series: index });
    } else if (item.kind === 'plane') {
      const polygon = planeInBox(item.plane, box);
      fan(polygon, 'plane', index, box, faces);
    } else if (item.kind === 'invalid') {
      problems[index] = { message: item.message, position: 0, length: space.items[index].length };
    }
  });

  if (space.revolve) addSolid(space, names, box, faces, lines);

  return {
    box,
    faces,
    lines,
    arrows,
    dots,
    problems,
    kinds: items.map((item) => item.kind),
    tangent,
    contours,
    grid: first?.grid ?? null,
  };
}

/** The points of vectors, dots, and solids, so the box holds them. */
function objectPoints(items: readonly SpaceItem[], space: SpaceSource): Vec3[] {
  const out: Vec3[] = [];
  for (const item of items) {
    if (item.kind === 'vector') out.push(item.tail, add(item.tail, item.head));
    if (item.kind === 'point') out.push(item.at);
  }
  if (space.revolve) {
    const { from, to, axis } = space.revolve;
    const r = revolveRadius(space);
    const [low, high] = revolveHeights(space);
    if (axis.kind === 'y') out.push([from, -r, axis.at - r], [to, r, axis.at + r]);
    else out.push([axis.at - r, -r, low], [axis.at + r, r, high]);
  }
  return out;
}

function fitBox(
  space: SpaceSource,
  range: readonly number[],
  zRange: readonly [number, number],
  others: readonly Vec3[],
  hasSurface: boolean,
): Box3 {
  if (hasSurface || space.range) return { min: [range[0], range[2], zRange[0]], max: [range[1], range[3], zRange[1]] };
  // Vectors, points, and solids: one scale on every axis, so lengths and angles look true. Vectors and points keep
  // the origin in view; a solid is framed on its own.
  const points = space.revolve ? [...others] : [[0, 0, 0] as Vec3, ...others];
  if (points.length === 0) return { min: [-3, -3, -3], max: [3, 3, 3], equal: true };
  const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])));
  const half = Math.max(2, ...lo.map((v, k) => (hi[k] - v) / 2)) * 1.15;
  const center = lo.map((v, k) => (v + hi[k]) / 2);
  const round = (v: number) => Math.round(v * 100) / 100;
  const min = center.map((c) => round(c - half)) as unknown as Vec3;
  const max = center.map((c) => round(c + half)) as unknown as Vec3;
  if (space.zRange) return { min: [min[0], min[1], space.zRange[0]], max: [max[0], max[1], space.zRange[1]] };
  return { min, max, equal: true };
}

function tangentAt(surface: Surface, space: SpaceSource, names: string[]): Tangent | null {
  const [x, y] = space.tangent!;
  const values = { ...space.params, x, y };
  const z = surface.expression.evaluate(values);
  const fx = partialDerivative(surface.expression.source, 'x', VARS, names);
  const fy = partialDerivative(surface.expression.source, 'y', VARS, names);
  if (!fx.ok || !fy.ok) return null;
  const [dx, dy] = [fx.expression.evaluate(values), fy.expression.evaluate(values)];
  return [z, dx, dy].every(Number.isFinite) ? { x, y, z, fx: dx, fy: dy } : null;
}

function addTangent(tangent: Tangent, range: readonly number[], box: Box3, faces: WorldFace[], dots: WorldDot[]) {
  const w = Math.min(range[1] - range[0], range[3] - range[2]) * 0.22;
  const n = 4;
  const at = (i: number, j: number): Vec3 => {
    const x = tangent.x - w + (2 * w * i) / n;
    const y = tangent.y - w + (2 * w * j) / n;
    return [x, y, tangent.z + tangent.fx * (x - tangent.x) + tangent.fy * (y - tangent.y)];
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const points = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      faces.push({ points, role: 'tangent', series: -1, tone: 0.5, light: lightOf(points, box) });
    }
  }
  dots.push({ at: [tangent.x, tangent.y, tangent.z], series: -1, role: 'tangent' });
}

/** A convex polygon as triangles from its center, so each piece sorts by its own depth. */
function fan(polygon: readonly Vec3[], role: Role, series: number, box: Box3, faces: WorldFace[]) {
  if (polygon.length < 3) return;
  const center = scale(polygon.reduce(add), 1 / polygon.length);
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const mid = (a: Vec3, b: Vec3) => scale(add(a, b), 0.5);
    // Two triangles per edge, so a big plane does not sort as one piece.
    for (const points of [
      [center, mid(center, p), mid(center, q)],
      [mid(center, p), p, q, mid(center, q)],
    ] as Vec3[][]) {
      faces.push({ points, role, series, tone: 0.5, light: lightOf(points, box) });
    }
  });
}

/** The lowest and highest y of the curves, which is the solid's height when it turns about a vertical line. */
function revolveHeights(space: SpaceSource): [number, number] {
  const spec = space.revolve!;
  const names = Object.keys(space.params);
  let [low, high] = [Infinity, -Infinity];
  for (const source of [spec.outer, spec.inner]) {
    const read = compileMulti(source, ['x'], names);
    if (!read.ok) continue;
    for (let k = 0; k <= 60; k++) {
      const y = read.expression.evaluate({ ...space.params, x: spec.from + ((spec.to - spec.from) * k) / 60 });
      if (Number.isFinite(y)) [low, high] = [Math.min(low, y), Math.max(high, y)];
    }
  }
  return Number.isFinite(low) ? [low, high] : [0, 1];
}

function revolveRadius(space: SpaceSource): number {
  const spec = space.revolve!;
  const names = Object.keys(space.params);
  let r = 0.5;
  for (const source of [spec.outer, spec.inner]) {
    const read = compileMulti(source, ['x'], names);
    if (!read.ok) continue;
    for (let k = 0; k <= 60; k++) {
      const x = spec.from + ((spec.to - spec.from) * k) / 60;
      const y = read.expression.evaluate({ ...space.params, x });
      if (!Number.isFinite(y)) continue;
      r = Math.max(r, spec.axis.kind === 'y' ? Math.abs(y - spec.axis.at) : Math.abs(x - spec.axis.at));
    }
  }
  return r;
}

/** The surfaces a region sweeps when it turns about the axis: the outer and inner curves, and the end walls. */
function addSolid(space: SpaceSource, names: string[], box: Box3, faces: WorldFace[], lines: WorldLine[]) {
  const spec = space.revolve!;
  const M = 36;
  const N = 32;
  const curves = [spec.outer, spec.inner].map((source) => compileMulti(source, ['x'], names));
  const place = (x: number, y: number, angle: number): Vec3 => {
    if (spec.axis.kind === 'y') {
      const r = y - spec.axis.at;
      return [x, r * Math.sin(angle), spec.axis.at + r * Math.cos(angle)];
    }
    const r = x - spec.axis.at;
    return [spec.axis.at + r * Math.cos(angle), r * Math.sin(angle), y];
  };
  curves.forEach((curve, which) => {
    if (!curve.ok) return;
    const ys = Array.from({ length: N + 1 }, (_, k) => {
      const x = spec.from + ((spec.to - spec.from) * k) / N;
      return [x, curve.expression.evaluate({ ...space.params, x })] as const;
    });
    for (let k = 0; k < N; k++) {
      const [[x0, y0], [x1, y1]] = [ys[k], ys[k + 1]];
      if (![y0, y1].every(Number.isFinite)) continue;
      for (let m = 0; m < M; m++) {
        const [a0, a1] = [(2 * Math.PI * m) / M, (2 * Math.PI * (m + 1)) / M];
        const points = [place(x0, y0, a0), place(x1, y1, a0), place(x1, y1, a1), place(x0, y0, a1)];
        if (norm(sub(points[0], points[2])) < 1e-12) continue;
        const role = which === 0 ? 'solid' : 'inner';
        faces.push({ points, role, series: -2, tone: which === 0 ? 0.75 : 0.35, light: lightOf(points, box) });
      }
    }
    // The generating curve itself, drawn on the plane the region lies in.
    lines.push({
      points: ys.filter(([, y]) => Number.isFinite(y)).map(([x, y]) => place(x, y, 0)),
      role: 'curve',
      series: which,
    });
  });
}
