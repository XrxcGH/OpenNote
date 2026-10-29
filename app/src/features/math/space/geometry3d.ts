// Lines and planes in space: distances, intersections, and angles, with the answers a calculus text gives. A line is
// a point and a direction, r(t) = a + t u. A plane is n · p = d. Nearly parallel cases count as parallel.
import { add, angleBetween, cross, dot, norm, scale, sub, tidy, type Vec3, vecText } from './vec';

export interface Line3 {
  readonly point: Vec3;
  readonly direction: Vec3;
}

export interface Plane {
  readonly normal: Vec3;
  readonly d: number;
}

const EPS = 1e-10;

export const lineThrough = (a: Vec3, b: Vec3): Line3 => ({ point: a, direction: sub(b, a) });

/** The plane through a point with a normal vector. */
export const planeFrom = (point: Vec3, normal: Vec3): Plane => ({ normal, d: dot(normal, point) });

/** The plane through three points, or null when they lie on one line. */
export function planeThrough(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const normal = cross(sub(b, a), sub(c, a));
  return norm(normal) < EPS ? null : planeFrom(a, normal);
}

export const distancePoints = (a: Vec3, b: Vec3): number => norm(sub(a, b));

export function distancePointPlane(p: Vec3, plane: Plane): number {
  return Math.abs(dot(plane.normal, p) - plane.d) / norm(plane.normal);
}

export function distancePointLine(p: Vec3, line: Line3): number {
  return norm(cross(sub(p, line.point), line.direction)) / norm(line.direction);
}

export type LinePair =
  | { readonly kind: 'intersect'; readonly point: Vec3; readonly angle: number }
  | { readonly kind: 'parallel'; readonly distance: number }
  | { readonly kind: 'same' }
  | { readonly kind: 'skew'; readonly distance: number; readonly closest: readonly [Vec3, Vec3] };

/** How two lines meet: at a point, never (parallel or skew, with the distance), or everywhere. */
export function compareLines(l1: Line3, l2: Line3): LinePair {
  const u = l1.direction;
  const v = l2.direction;
  const w = sub(l1.point, l2.point);
  const n = cross(u, v);
  if (norm(n) < EPS * norm(u) * norm(v)) {
    const distance = distancePointLine(l2.point, l1);
    return distance < 1e-9 ? { kind: 'same' } : { kind: 'parallel', distance };
  }
  // The closest points: minimize |w + t u - s v|.
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const den = a * c - b * b;
  const t = (b * e - c * d) / den;
  const s = (a * e - b * d) / den;
  const p1 = add(l1.point, scale(u, t));
  const p2 = add(l2.point, scale(v, s));
  const distance = Math.abs(dot(w, n)) / norm(n);
  if (distance < 1e-9) return { kind: 'intersect', point: p1, angle: acute(angleBetween(u, v) ?? 0) };
  return { kind: 'skew', distance, closest: [p1, p2] };
}

const acute = (angle: number) => Math.min(angle, Math.PI - angle);

export type LinePlane =
  | { readonly kind: 'intersect'; readonly point: Vec3; readonly t: number; readonly angle: number }
  | { readonly kind: 'parallel'; readonly distance: number }
  | { readonly kind: 'inPlane' };

/** Where a line meets a plane, with the angle between them (0 when the line lies along the plane). */
export function lineMeetsPlane(line: Line3, plane: Plane): LinePlane {
  const along = dot(plane.normal, line.direction);
  if (Math.abs(along) < EPS * norm(plane.normal) * norm(line.direction)) {
    const distance = distancePointPlane(line.point, plane);
    return distance < 1e-9 ? { kind: 'inPlane' } : { kind: 'parallel', distance };
  }
  const t = (plane.d - dot(plane.normal, line.point)) / along;
  const toNormal = acute(angleBetween(line.direction, plane.normal) ?? 0);
  return { kind: 'intersect', point: add(line.point, scale(line.direction, t)), t, angle: Math.PI / 2 - toNormal };
}

export type PlanePair =
  | { readonly kind: 'intersect'; readonly line: Line3; readonly angle: number }
  | { readonly kind: 'parallel'; readonly distance: number }
  | { readonly kind: 'same' };

/** The line where two planes meet, and the angle between them; or the gap between parallel planes. */
export function planesMeet(p1: Plane, p2: Plane): PlanePair {
  const c = cross(p1.normal, p2.normal);
  const cc = dot(c, c);
  if (Math.sqrt(cc) < EPS * norm(p1.normal) * norm(p2.normal)) {
    // Scale the second plane to the first's normal, then compare the constants.
    const k = norm(p1.normal) / norm(p2.normal) / Math.sign(dot(p1.normal, p2.normal) || 1);
    const distance = Math.abs(p1.d - p2.d * k) / norm(p1.normal);
    return distance < 1e-9 ? { kind: 'same' } : { kind: 'parallel', distance };
  }
  const point = scale(add(scale(cross(p2.normal, c), p1.d), scale(cross(c, p1.normal), p2.d)), 1 / cc);
  return {
    kind: 'intersect',
    line: { point, direction: c },
    angle: acute(angleBetween(p1.normal, p2.normal) ?? 0),
  };
}

/** The point of a plane nearest to `p` (the foot of the perpendicular). */
export function footOnPlane(p: Vec3, plane: Plane): Vec3 {
  const k = (plane.d - dot(plane.normal, p)) / dot(plane.normal, plane.normal);
  return add(p, scale(plane.normal, k));
}

const signed = (value: number, name: string, first: boolean): string => {
  const v = tidy(value, 6);
  if (v === 0) return '';
  const size = Math.abs(v) === 1 ? '' : String(Math.abs(v));
  if (first) return `${v < 0 ? '−' : ''}${size}${name}`;
  return ` ${v < 0 ? '−' : '+'} ${size}${name}`;
};

/** A plane as an equation, such as "2x − y + 3z = 5". */
export function planeText(plane: Plane): string {
  const parts = ['x', 'y', 'z'].map((name, index) => ({ name, value: plane.normal[index] }));
  let text = '';
  for (const part of parts) text += signed(part.value, part.name, text === '');
  return `${text || '0'} = ${tidy(plane.d, 6)}`;
}

/** A line in vector form, such as "r(t) = ⟨1, 2, 0⟩ + t⟨3, -1, 2⟩". */
export function lineText(line: Line3): string {
  return `r(t) = ${vecText(line.point)} + t${vecText(line.direction)}`;
}

/** Reads "2x - y + 3z = 5" as a plane. Null when the text is not a linear equation in x, y, and z. */
export function readPlane(text: string): Plane | null {
  const [left, right, extra] = text.split('=');
  if (left === undefined || right === undefined || extra !== undefined) return null;
  const side = (part: string): [number, number, number, number] | null => {
    const terms = part
      .replace(/\s+/g, '')
      .replace(/−/g, '-')
      .match(/[+-]?[^+-]+/g);
    if (!terms) return null;
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (const term of terms) {
      const match = /^([+-]?)(\d*\.?\d*(?:e[+-]?\d+)?)\*?([xyz]?)$/.exec(term);
      if (!match || (match[2] === '' && match[3] === '')) return null;
      const size = (match[1] === '-' ? -1 : 1) * (match[2] === '' ? 1 : Number(match[2]));
      out[match[3] === '' ? 3 : 'xyz'.indexOf(match[3])] += size;
    }
    return out;
  };
  const a = side(left);
  const b = side(right);
  if (!a || !b) return null;
  const normal: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  if (norm(normal) === 0) return null;
  return { normal, d: b[3] - a[3] };
}
