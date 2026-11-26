// Shapes back into exact geometry: the polyline a shape stroke stores (design 11.5). Corners are the points, closing to
// the first for closed shapes. Curves are sampled so no segment strays far from the true curve.

import type { Vec } from '../types';
import { splinePoints } from './spline';
import type { Shape } from './types';

/** Points along a circle from `start` by `sweep` radians, enough that no segment strays far from the arc. */
export function sampleArc(center: Vec, radius: number, start: number, sweep: number): Vec[] {
  const step = 2 * Math.acos(Math.max(0, 1 - CURVE_TOLERANCE / Math.max(radius, 1)));
  const count = Math.max(8, Math.ceil(Math.abs(sweep) / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = start + (sweep * i) / count;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

/**
 * The end of an arc and the way it runs there: along the circle, turning the way the arc sweeps. A curved arrow's head
 * points this way, never along a chord back into the arc, which leans the head inward by half the angle it spans.
 */
export function arcEnd(center: Vec, radius: number, start: number, sweep: number): { tip: Vec; direction: Vec } {
  const end = start + sweep;
  const way = Math.sign(sweep) || 1;
  return {
    tip: { x: center.x + radius * Math.cos(end), y: center.y + radius * Math.sin(end) },
    direction: { x: -Math.sin(end) * way, y: Math.cos(end) * way },
  };
}

/**
 * A curved arrow's body: the sampled arc with one more point on it just short of the tip, so the last segment runs
 * along the end tangent within a hundredth of a degree for any radius and the head's two sides meet it alike.
 */
export function curvedArrowBody(center: Vec, radius: number, start: number, sweep: number): Vec[] {
  const body = sampleArc(center, radius, start, sweep);
  const step = Math.abs(sweep) / (body.length - 1);
  const near = Math.min(step / 2, 0.0004);
  const angle = start + sweep - Math.sign(sweep) * near;
  const tip = body.pop()!;
  body.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }, tip);
  return body;
}

/** A regular polygon's corners, closing on the first. */
export function polygonCorners(center: Vec, radius: number, sides: number, rotation: number): Vec[] {
  return Array.from({ length: sides + 1 }, (_, i) => {
    const angle = rotation + ((i % sides) * 2 * Math.PI) / sides;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

/** A star's outline: tips and notches in turn, closing on the first tip. */
export function starCorners(center: Vec, outer: number, inner: number, points: number, rotation: number): Vec[] {
  return Array.from({ length: points * 2 + 1 }, (_, i) => {
    const k = i % (points * 2);
    const radius = k % 2 === 0 ? outer : inner;
    const angle = rotation + (k * Math.PI) / points;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

/** No sampled segment of a circle or ellipse strays farther than this from the true curve, in page units. */
export const CURVE_TOLERANCE = 0.1;
const MIN_CURVE_POINTS = 16;

/** Points around an ellipse, closing on the first, enough that the sagitta of each segment stays in tolerance. */
export function sampleEllipse(center: Vec, rx: number, ry: number, rotation: number): Vec[] {
  const radius = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(0, 1 - CURVE_TOLERANCE / radius));
  // A whole number of points in each quarter, so the ends of both axes are points of the outline: an ellipse snapped
  // to the paper's lines touches them exactly.
  const count = 4 * Math.ceil(Math.max(MIN_CURVE_POINTS, Math.ceil((2 * Math.PI) / step)) / 4);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = (i % count) * ((2 * Math.PI) / count);
    const u = rx * Math.cos(angle);
    const v = ry * Math.sin(angle);
    return { x: center.x + u * cos - v * sin, y: center.y + u * sin + v * cos };
  });
}

export function shapePoints(shape: Shape): Vec[] {
  switch (shape.kind) {
    case 'line':
      return [shape.from, shape.to];
    case 'arrow':
      return [shape.from, shape.tip, shape.barbs[0], shape.tip, shape.barbs[1]];
    case 'rectangle':
      return [...shape.corners, shape.corners[0]];
    case 'triangle':
      return [...shape.corners, shape.corners[0]];
    case 'circle':
      return sampleEllipse(shape.center, shape.radius, shape.radius, 0);
    case 'ellipse':
      return sampleEllipse(shape.center, shape.rx, shape.ry, shape.rotation);
    case 'polygon':
      return polygonCorners(shape.center, shape.radius, shape.sides, shape.rotation);
    case 'freeform':
      return [...shape.corners, shape.corners[0]];
    case 'star':
      return starCorners(shape.center, shape.outer, shape.inner, shape.points, shape.rotation);
    case 'arc':
      return sampleArc(shape.center, shape.radius, shape.start, shape.sweep);
    case 'curvedArrow': {
      const body = curvedArrowBody(shape.center, shape.radius, shape.start, shape.sweep);
      const tip = body[body.length - 1];
      return [...body, shape.barbs[0], tip, shape.barbs[1]];
    }
    case 'doubleArrow':
      return [
        shape.barbsFrom[0],
        shape.from,
        shape.barbsFrom[1],
        shape.from,
        shape.to,
        shape.barbsTo[0],
        shape.to,
        shape.barbsTo[1],
      ];
    case 'spline':
      return splinePoints(shape);
  }
}
