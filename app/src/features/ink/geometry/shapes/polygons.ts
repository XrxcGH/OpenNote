// Triangles and rectangles from a closed stroke (design 11.2): the stroke's corners are fitted, then cleaned up into
// the regular shape they were probably meant to be.

import type { Vec } from '../types';
import { fitPolygon, pickCorners } from './corners';
import type { Candidate, Shape } from './types';

/** A polygon is accepted when its mean error is under this share of the square root of its area. */
export const POLYGON_TOLERANCE = 0.05;

const DEGREES = Math.PI / 180;
const RIGHT_ANGLE_TOLERANCE = 15 * DEGREES;
/** Sides within this of horizontal and vertical make an upright rectangle. */
const UPRIGHT_TOLERANCE = 10 * DEGREES;
/** A rectangle whose sides differ by less than this share is a square. */
const SQUARE_TOLERANCE = 0.08;
/** A triangle angle this close to 60 degrees (all three) or to 90 degrees (one) is regular or right. */
const TRIANGLE_TOLERANCE = 8 * DEGREES;
const MIN_TRIANGLE_ANGLE = 10 * DEGREES;
/** A triangle is dropped when four corners fit this much better, since the stroke is then a four-sided shape. */
const QUAD_OVER_TRIANGLE = 0.6;

/** The interior angle at corner `i` of a polygon. */
function angleAt(corners: readonly Vec[], i: number): number {
  const n = corners.length;
  const c = corners[i];
  const a = corners[(i + n - 1) % n];
  const b = corners[(i + 1) % n];
  const ax = a.x - c.x;
  const ay = a.y - c.y;
  const bx = b.x - c.x;
  const by = b.y - c.y;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)))));
}

function rectangleShape(corners: readonly Vec[]): Shape | null {
  const angles = corners.map((_, i) => angleAt(corners, i));
  if (angles.some((a) => Math.abs(a - Math.PI / 2) > RIGHT_ANGLE_TOLERANCE)) return null;
  const center = { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
  // Side directions repeat every 90 degrees, so averaging four times the angle averages them without wrap-around.
  let sin4 = 0;
  let cos4 = 0;
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % 4];
    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    sin4 += Math.sin(4 * angle);
    cos4 += Math.cos(4 * angle);
  });
  let rotation = Math.atan2(sin4, cos4) / 4;
  if (Math.abs(rotation) <= UPRIGHT_TOLERANCE) rotation = 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let halfW = 0;
  let halfH = 0;
  for (const p of corners) {
    halfW += Math.abs((p.x - center.x) * cos + (p.y - center.y) * sin) / 4;
    halfH += Math.abs(-(p.x - center.x) * sin + (p.y - center.y) * cos) / 4;
  }
  const square = Math.abs(halfW - halfH) / Math.max(halfW, halfH) <= SQUARE_TOLERANCE;
  if (square) halfW = halfH = (halfW + halfH) / 2;
  const at = (u: number, v: number): Vec => ({
    x: center.x + u * cos - v * sin,
    y: center.y + u * sin + v * cos,
  });
  return {
    kind: 'rectangle',
    corners: [at(-halfW, -halfH), at(halfW, -halfH), at(halfW, halfH), at(-halfW, halfH)],
    square,
  };
}

/** A regular triangle around the same center, turned to match the drawn one. */
function equilateral(corners: readonly Vec[]): Shape {
  const cx = (corners[0].x + corners[1].x + corners[2].x) / 3;
  const cy = (corners[0].y + corners[1].y + corners[2].y) / 3;
  const radius = corners.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / 3;
  const start = Math.atan2(corners[0].y - cy, corners[0].x - cx);
  const at = (k: number): Vec => ({
    x: cx + radius * Math.cos(start + (k * 2 * Math.PI) / 3),
    y: cy + radius * Math.sin(start + (k * 2 * Math.PI) / 3),
  });
  return { kind: 'triangle', corners: [at(0), at(1), at(2)], variant: 'equilateral' };
}

/** Makes the angle at corner `v` exactly 90 degrees by turning the leg to its previous corner. */
function rightTriangle(corners: readonly Vec[], v: number): Shape {
  const vertex = corners[v];
  const next = corners[(v + 1) % 3];
  const prev = corners[(v + 2) % 3];
  const legLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
  const ux = (next.x - vertex.x) / legLength;
  const uy = (next.y - vertex.y) / legLength;
  const side = (prev.x - vertex.x) * -uy + (prev.y - vertex.y) * ux >= 0 ? 1 : -1;
  const other = Math.hypot(prev.x - vertex.x, prev.y - vertex.y);
  const fixed: Vec = { x: vertex.x - uy * side * other, y: vertex.y + ux * side * other };
  const result = [...corners];
  result[(v + 2) % 3] = fixed;
  return { kind: 'triangle', corners: [result[0], result[1], result[2]], variant: 'right' };
}

function triangleShape(corners: readonly Vec[]): Shape | null {
  const angles = corners.map((_, i) => angleAt(corners, i));
  if (Math.min(...angles) < MIN_TRIANGLE_ANGLE) return null;
  if (angles.every((a) => Math.abs(a - Math.PI / 3) <= TRIANGLE_TOLERANCE)) return equilateral(corners);
  const right = angles.findIndex((a) => Math.abs(a - Math.PI / 2) <= TRIANGLE_TOLERANCE);
  if (right >= 0) return rightTriangle(corners, right);
  return { kind: 'triangle', corners: [corners[0], corners[1], corners[2]], variant: 'general' };
}

/** The triangle and rectangle candidates for a closed outline of evenly spaced points, each only if it fits. */
export function polygonCandidates(points: readonly Vec[]): Candidate[] {
  const fitFor = (count: number) => {
    const indices = pickCorners(points, count);
    return indices && fitPolygon(points, indices);
  };
  const [triangle, quad] = [fitFor(3), fitFor(4)];
  const found: Candidate[] = [];
  // A four-sided outline cut down to three corners can still fit loosely, so a much better four-corner fit wins.
  const quadWins = triangle && quad && quad.error < QUAD_OVER_TRIANGLE * triangle.error;
  if (triangle && triangle.error < POLYGON_TOLERANCE && !quadWins) {
    const shape = triangleShape(triangle.corners);
    if (shape) found.push({ shape, ratio: triangle.error / POLYGON_TOLERANCE });
  }
  if (quad && quad.error < POLYGON_TOLERANCE) {
    const shape = rectangleShape(quad.corners);
    if (shape) found.push({ shape, ratio: quad.error / POLYGON_TOLERANCE });
  }
  return found;
}
