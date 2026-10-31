// Drawing on a stereonet: equal-area (Schmidt) or equal-angle (Wulff) projection of the lower or upper hemisphere,
// with a 10-degree grid, great circles for planes, small circles for cones, dots for lines, and density shading.
import type { Figure, Mark, Role } from '../core/figure';
import { pathOf } from '../core/figure';
import { cross, lineOf, rakeLine, rotate, unit, vector } from './geometry';
import type { Line, Plane, Vec } from './geometry';
import { density } from './stats';

export type Net = 'area' | 'angle';
export type Hemisphere = 'lower' | 'upper';

export interface NetSpec {
  net: Net;
  hemisphere: Hemisphere;
  title: string;
  description: string;
  north: string;
  grid?: boolean;
}

const R = 140;
const C = 165;
const RAD = Math.PI / 180;

/** The point of a line on the net; a line pointing the other way from the hemisphere shown is drawn by its opposite. */
export function place(
  line: Line,
  spec: Pick<NetSpec, 'net' | 'hemisphere'>,
): { x: number; y: number; flipped: boolean } {
  let v = vector(line);
  const wantDown = spec.hemisphere === 'lower';
  const flipped = wantDown ? v[2] > 1e-12 : v[2] < -1e-12;
  if (flipped) v = [-v[0], -v[1], -v[2]];
  const theta = Math.acos(Math.min(1, Math.abs(v[2])));
  const r = spec.net === 'area' ? R * Math.SQRT2 * Math.sin(theta / 2) : R * Math.tan(theta / 2);
  const h = Math.hypot(v[0], v[1]);
  const [e, n] = h < 1e-12 ? [0, 0] : [v[0] / h, v[1] / h];
  // Seen from above, the upper hemisphere is drawn as if looked at from below it, so east stays to the right.
  return { x: C + r * e, y: C - r * n, flipped };
}

function curve(lines: readonly Line[], spec: NetSpec): string {
  const points: [number, number][] = [];
  let last: { x: number; y: number } | null = null;
  for (const line of lines) {
    const p = place(line, spec);
    if (last && Math.hypot(p.x - last.x, p.y - last.y) > R) points.push([Number.NaN, Number.NaN]);
    points.push([p.x, p.y]);
    last = p;
  }
  return pathOf(points);
}

/** The great circle of a plane as a path. */
export function greatCircle(plane: Plane, spec: NetSpec): string {
  return curve(
    Array.from({ length: 91 }, (_, k) => rakeLine(plane, k * 2)),
    spec,
  );
}

/** A small circle of half-angle `radius` around an axis, as a path. */
export function smallCircle(axis: Line, radius: number, spec: NetSpec): string {
  const a = vector(axis);
  const helper: Vec = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const start = rotate(a, lineOf(unit(cross(a, helper)), true), radius);
  const lines = Array.from({ length: 121 }, (_, k) => lineOf(rotate(start, axis, k * 3), true));
  return curve(lines, spec);
}

function gridMarks(spec: NetSpec): Mark[] {
  const marks: Mark[] = [];
  for (let dip = 10; dip < 90; dip += 10) {
    marks.push({ kind: 'path', d: greatCircle({ strike: 0, dip }, spec), role: 'grid', width: 0.6 });
    marks.push({ kind: 'path', d: greatCircle({ strike: 180, dip }, spec), role: 'grid', width: 0.6 });
    marks.push({ kind: 'path', d: smallCircle({ trend: 0, plunge: 0 }, dip, spec), role: 'grid', width: 0.6 });
  }
  marks.push({ kind: 'line', x1: C - R, y1: C, x2: C + R, y2: C, role: 'grid', width: 0.6 });
  marks.push({ kind: 'line', x1: C, y1: C - R, x2: C, y2: C + R, role: 'grid', width: 0.6 });
  return marks;
}

export interface NetLayer {
  planes?: readonly Plane[];
  lines?: readonly Line[];
  role?: Role;
  /** Open dots for lines that point into the other hemisphere (upward paleomagnetic directions on a lower net). */
  hollowFlipped?: boolean;
  cones?: readonly { axis: Line; radius: number }[];
  size?: number;
  labels?: readonly string[];
  dash?: boolean;
}

/** The density of lines in counting circles, shaded in bands of 2, 4, 6, and 8 percent and more. */
export function densityMarks(lines: readonly Line[], spec: NetSpec): Mark[] {
  const vs = lines.map((l) => vector(l));
  const marks: Mark[] = [];
  const step = 10;
  for (let x = C - R; x < C + R; x += step) {
    for (let y = C - R; y < C + R; y += step) {
      const cx = x + step / 2 - C;
      const cy = C - (y + step / 2);
      const rr = Math.hypot(cx, cy) / R;
      if (rr > 1) continue;
      // Invert the projection at the cell center.
      const theta = spec.net === 'area' ? 2 * Math.asin(Math.min(1, rr / Math.SQRT2)) : 2 * Math.atan(rr);
      const h = Math.sin(theta);
      const az = Math.atan2(cx, cy);
      const z = spec.hemisphere === 'lower' ? -Math.cos(theta) : Math.cos(theta);
      const pct = density(vs, [h * Math.sin(az), h * Math.cos(az), z]);
      const band = Math.min(4, Math.floor(pct / 2));
      if (band > 0)
        marks.push({ kind: 'rect', x, y, w: step, h: step, role: 's0', fill: true, opacity: 0.12 * band, width: 0 });
    }
  }
  return marks;
}

/** The whole net with its layers. */
export function drawNet(spec: NetSpec, layers: readonly NetLayer[], extra: readonly Mark[] = []): Figure {
  const marks: Mark[] = [];
  marks.push(...extra);
  if (spec.grid !== false) marks.push(...gridMarks(spec));
  marks.push({ kind: 'circle', cx: C, cy: C, r: R, role: 'axis' });
  marks.push({ kind: 'line', x1: C, y1: C - R - 6, x2: C, y2: C - R, role: 'axis' });
  marks.push({ kind: 'text', x: C, y: C - R - 10, text: spec.north, role: 'text', anchor: 'middle', size: 11 });
  marks.push({ kind: 'line', x1: C - 4, y1: C, x2: C + 4, y2: C, role: 'axis' });
  marks.push({ kind: 'line', x1: C, y1: C - 4, x2: C, y2: C + 4, role: 'axis' });
  for (const layer of layers) {
    const role = layer.role ?? 's0';
    for (const plane of layer.planes ?? [])
      marks.push({ kind: 'path', d: greatCircle(plane, spec), role, width: 1.4, dash: layer.dash });
    for (const cone of layer.cones ?? [])
      marks.push({ kind: 'path', d: smallCircle(cone.axis, cone.radius, spec), role, width: 1.2, dash: true });
    (layer.lines ?? []).forEach((line, i) => {
      const p = place(line, spec);
      const hollow = layer.hollowFlipped && p.flipped;
      marks.push({ kind: 'circle', cx: p.x, cy: p.y, r: layer.size ?? 3, role, fill: !hollow });
      const label = layer.labels?.[i];
      if (label) marks.push({ kind: 'text', x: p.x + 6, y: p.y - 5, text: label, role: 'text', size: 10 });
    });
  }
  return { width: 2 * C, height: 2 * C + 6, title: spec.title, description: spec.description, marks };
}

/** A rose diagram of bin counts as petals scaled to the largest bin. */
export function drawRose(bins: readonly number[], title: string, description: string, north: string): Figure {
  const width = 360 / bins.length;
  const top = Math.max(...bins, 1);
  const marks: Mark[] = [
    { kind: 'circle', cx: C, cy: C, r: R, role: 'axis' },
    { kind: 'circle', cx: C, cy: C, r: R / 2, role: 'grid', dash: true },
    { kind: 'text', x: C, y: C - R - 10, text: north, role: 'text', anchor: 'middle', size: 11 },
  ];
  bins.forEach((count, i) => {
    if (!count) return;
    const r = R * Math.sqrt(count / top);
    const a1 = i * width * RAD;
    const a2 = (i + 1) * width * RAD;
    const p = (a: number): [number, number] => [C + r * Math.sin(a), C - r * Math.cos(a)];
    const [x1, y1] = p(a1);
    const [x2, y2] = p(a2);
    marks.push({
      kind: 'path',
      d: `M${C} ${C}L${x1.toFixed(2)} ${y1.toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`,
      role: 's0',
      fill: true,
      opacity: 0.55,
    });
  });
  return { width: 2 * C, height: 2 * C + 6, title, description, marks };
}
