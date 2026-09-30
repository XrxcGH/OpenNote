// Shapes back into exact geometry: the polyline a shape stroke stores (design 11.5). Corners are the points, closing to
// the first for closed shapes. Curves are sampled so no segment strays far from the true curve.

import type { Vec } from '../types';
import type { Shape } from './types';

/** No sampled segment of a circle or ellipse strays farther than this from the true curve, in page units. */
export const CURVE_TOLERANCE = 0.1;
const MIN_CURVE_POINTS = 16;

/** Points around an ellipse, closing on the first, enough that the sagitta of each segment stays in tolerance. */
export function sampleEllipse(center: Vec, rx: number, ry: number, rotation: number): Vec[] {
  const radius = Math.max(rx, ry);
  const step = 2 * Math.acos(Math.max(0, 1 - CURVE_TOLERANCE / radius));
  const count = Math.max(MIN_CURVE_POINTS, Math.ceil((2 * Math.PI) / step));
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
  }
}
