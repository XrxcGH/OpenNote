// Keep holding a snapped line or arrow, then move: its far end follows the pen until the pen lifts, so the line can be
// laid to any point. Where the stroke began stays put. Off the paper's lines the end keeps to 15 degree steps near
// level and upright, as a drawn line does; on them the caller snaps the end to the nearest line instead.

import type { Vec } from '../types';
import { dragHandle } from './edit';
import { snapAngle } from './lines';
import type { Shape } from './types';

/** True for the shapes whose far end follows the pen while held: lines and straight arrows. */
export function followsEnd(shape: Shape): boolean {
  return shape.kind === 'line' || shape.kind === 'arrow' || shape.kind === 'doubleArrow';
}

/** Where the shape's far end is: the end of a line, or an arrow's tip. */
export function farEnd(shape: Shape): Vec | null {
  if (shape.kind === 'line' || shape.kind === 'doubleArrow') return shape.to;
  if (shape.kind === 'arrow') return shape.tip;
  return null;
}

/**
 * The held shape with its far end at `to`. With `turnSnap` the end is turned about the start to the nearest 15 degree
 * step when it is near one, keeping its distance. A shape whose end does not follow comes back as it was.
 */
export function followEnd(shape: Shape, to: Vec, turnSnap = true): Shape {
  if (shape.kind !== 'line' && shape.kind !== 'arrow' && shape.kind !== 'doubleArrow') return shape;
  const from = shape.from;
  let end = to;
  if (turnSnap) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = snapAngle(Math.atan2(to.y - from.y, to.x - from.x));
    end = { x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle) };
  }
  if (Math.hypot(end.x - from.x, end.y - from.y) < 1e-6) return shape;
  return dragHandle(shape, 'to', end);
}
