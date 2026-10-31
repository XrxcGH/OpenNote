// Orientations as unit vectors (east, north, up). A line has a trend and plunge. A plane has a strike and dip by
// the right-hand rule, or a dip direction and dip. From these come poles, rakes, intersections, angles, apparent
// dips, the three-point problem, true thickness, and rotations. Angles in degrees; azimuths clockwise from north.
import { check } from '../core/problem';

export type Vec = readonly [number, number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const wrap = (azimuth: number): number => ((azimuth % 360) + 360) % 360;
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec): number => Math.sqrt(dot(a, a));
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (a: Vec): Vec => {
  const n = norm(a);
  check(n > 1e-12, 'parallel');
  return [a[0] / n, a[1] / n, a[2] / n];
};

export interface Line {
  trend: number;
  plunge: number;
}

export interface Plane {
  /** Strike by the right-hand rule: the plane dips to the right, 90 degrees clockwise. */
  strike: number;
  dip: number;
}

export const dipDirection = (plane: Plane): number => wrap(plane.strike + 90);
export const fromDipDirection = (direction: number, dip: number): Plane => ({ strike: wrap(direction - 90), dip });

export function checkLine(line: Line): void {
  check(Number.isFinite(line.trend) && line.plunge >= -90 && line.plunge <= 90, 'plunge');
}

export function checkPlane(plane: Plane): void {
  check(Number.isFinite(plane.strike) && plane.dip >= 0 && plane.dip <= 90, 'dip');
}

/** The unit vector of a line; positive plunge points down. */
export function vector(line: Line): Vec {
  checkLine(line);
  const t = line.trend * RAD;
  const p = line.plunge * RAD;
  return [Math.cos(p) * Math.sin(t), Math.cos(p) * Math.cos(t), -Math.sin(p)];
}

/** The trend and plunge of a vector, turned to point down unless `keep` (for directions such as paleomagnetic ones). */
export function lineOf(v: Vec, keep = false): Line {
  const u = unit(v);
  const down: Vec = !keep && u[2] > 1e-12 ? [-u[0], -u[1], -u[2]] : u;
  const plunge = Math.asin(Math.max(-1, Math.min(1, -down[2]))) * DEG;
  const horizontal = Math.hypot(down[0], down[1]);
  const trend = horizontal < 1e-12 ? 0 : wrap(Math.atan2(down[0], down[1]) * DEG);
  return { trend, plunge };
}

/** The pole of a plane: the downward normal, trend = dip direction + 180, plunge = 90 − dip. */
export function pole(plane: Plane): Line {
  checkPlane(plane);
  return { trend: wrap(dipDirection(plane) + 180), plunge: 90 - plane.dip };
}

/** The plane whose pole is a line. */
export function planeOfPole(line: Line): Plane {
  const l = lineOf(vector(line));
  return fromDipDirection(l.trend + 180, 90 - l.plunge);
}

/** The line at a rake (pitch) in a plane, measured from the strike direction toward the dip. */
export function rakeLine(plane: Plane, rake: number): Line {
  checkPlane(plane);
  check(rake >= 0 && rake <= 180, 'rake');
  const s = vector({ trend: plane.strike, plunge: 0 });
  const d = vector({ trend: dipDirection(plane), plunge: plane.dip });
  const r = rake * RAD;
  return lineOf([
    s[0] * Math.cos(r) + d[0] * Math.sin(r),
    s[1] * Math.cos(r) + d[1] * Math.sin(r),
    s[2] * Math.cos(r) + d[2] * Math.sin(r),
  ]);
}

/** The acute angle between two lines (or two poles, which is the angle between their planes). */
export function angle(a: Line, b: Line): number {
  return Math.acos(Math.min(1, Math.abs(dot(vector(a), vector(b))))) * DEG;
}

/** The line where two planes meet: the cross product of their poles. */
export function intersection(a: Plane, b: Plane): Line {
  const v = cross(vector(pole(a)), vector(pole(b)));
  check(norm(v) > 1e-9, 'parallel');
  return lineOf(v);
}

/** The plane that holds two lines. */
export function planeThrough(a: Line, b: Line): Plane {
  const n = cross(vector(a), vector(b));
  check(norm(n) > 1e-9, 'parallel');
  return planeOfPole(lineOf(n));
}

/** Apparent dip in a vertical section along `direction`: tan α = tan δ cos β. */
export function apparentDip(plane: Plane, direction: number): number {
  checkPlane(plane);
  const beta = (direction - dipDirection(plane)) * RAD;
  return Math.atan(Math.tan(plane.dip * RAD) * Math.cos(beta)) * DEG;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** The plane through three points with x east, y north, and z up: its strike, dip, and dip direction. */
export function threePoint(a: Point3, b: Point3, c: Point3): Plane & { direction: number; gradient: [number, number] } {
  const u: Vec = [b.x - a.x, b.y - a.y, b.z - a.z];
  const v: Vec = [c.x - a.x, c.y - a.y, c.z - a.z];
  const n = cross(u, v);
  check(Math.abs(n[2]) > 1e-12 * (norm(u) * norm(v) || 1), 'collinear');
  // z = z_a + gx (x − x_a) + gy (y − y_a) with (gx, gy) = −(n_x, n_y)/n_z.
  const gx = -n[0] / n[2];
  const gy = -n[1] / n[2];
  const slope = Math.hypot(gx, gy);
  const dip = Math.atan(slope) * DEG;
  const direction = slope < 1e-15 ? 0 : wrap(Math.atan2(-gx, -gy) * DEG);
  return { ...fromDipDirection(direction, dip), direction, gradient: [gx, gy] };
}

/**
 * True thickness from the outcrop width measured along a traverse at `traverse` degrees to the strike on ground
 * sloping `slope` degrees, positive when the ground slopes the same way the beds dip.
 */
export function trueThickness(width: number, dip: number, slope: number, traverse = 90): number {
  check(width > 0, 'width');
  check(dip >= 0 && dip <= 90, 'dip');
  check(Math.abs(slope) < 90, 'slope');
  check(traverse > 0 && traverse <= 90, 'traverse');
  // The width perpendicular to strike, then the bed's thickness across that section.
  const across = width * Math.sin(traverse * RAD);
  return Math.abs(across * Math.sin((dip - slope) * RAD));
}

/** Rotates v about a unit axis by `degrees`, clockwise as seen looking down the axis (Rodrigues' formula). */
export function rotate(v: Vec, axis: Line, degrees: number): Vec {
  const k = vector(axis);
  const a = degrees * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const kd = dot(k, v);
  return [
    v[0] * c + kv[0] * s + k[0] * kd * (1 - c),
    v[1] * c + kv[1] * s + k[1] * kd * (1 - c),
    v[2] * c + kv[2] * s + k[2] * kd * (1 - c),
  ];
}

/** Restores bedding to horizontal: rotates about its strike by its dip, and takes a line along with it. */
export function untilt(line: Line, bedding: Plane, keep = false): Line {
  checkPlane(bedding);
  const turned = rotate(vector(line), { trend: bedding.strike, plunge: 0 }, -bedding.dip);
  return lineOf(turned, keep);
}
