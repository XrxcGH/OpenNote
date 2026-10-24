// The hand's intent for the hand-drawn corpus: what it means to draw, in its own units, and the small geometry it
// is built from.

import type { Vec } from '../../types';

export type Rand = () => number;

export const uniform = (r: Rand, a: number, b: number): number => a + (b - a) * r();
export const gauss = (r: Rand): number => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
export const pick = <T>(r: Rand, items: readonly T[]): T => items[Math.floor(r() * items.length)];
export const DEG = Math.PI / 180;
export const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * What the hand means to draw, in its own units. A polyline's vertices are corners the pen turns at; a curve is already
 * dense. A closed intent ends where it starts.
 */
export interface Intent {
  readonly points: Vec[];
  readonly corners: boolean;
  readonly closed: boolean;
}

export const polyline = (points: Vec[], closed = false): Intent => ({
  points: closed ? [...points, points[0]] : points,
  corners: true,
  closed,
});
export const curve = (points: Vec[], closed = false): Intent => ({ points, corners: false, closed });

/** A closed polygon started at corner `from` and drawn either way round. */
export function around(corners: Vec[], from: number, reverse: boolean): Vec[] {
  const turned = [...corners.slice(from), ...corners.slice(0, from)];
  return reverse ? [turned[0], ...turned.slice(1).reverse()] : turned;
}

export function regular(n: number, radius: number, rotation: number): Vec[] {
  return Array.from({ length: n }, (_, i) => ({
    x: radius * Math.cos(rotation + (2 * Math.PI * i) / n),
    y: radius * Math.sin(rotation + (2 * Math.PI * i) / n),
  }));
}

/** Part of a circle, drawn either way. */
export function arcPoints(radius: number, start: number, sweep: number): Vec[] {
  const count = Math.max(8, Math.ceil(Math.abs(sweep) * radius));
  return Array.from({ length: count + 1 }, (_, k) => ({
    x: radius * Math.cos(start + (sweep * k) / count),
    y: radius * Math.sin(start + (sweep * k) / count),
  }));
}

export function rotate(p: Vec, a: number): Vec {
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

export function rotateAll(points: Vec[], a: number): Vec[] {
  return points.map((p) => rotate(p, a));
}

/** Points every unit along a polyline, for joining a polyline to a curve. */
export function densePolyline(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(dist(points[i - 1], points[i])));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push(lerp(points[i - 1], points[i], k / n));
  }
  return out;
}
