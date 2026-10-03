// Keep holding, then move: a snapped shape grows, shrinks, and turns with the pen before it lifts. The pen's distance
// from the shape's center, against where the pen was when the shape snapped, sets the size, and the angle it has
// swept around the center sets the turn. Turns snap to whole steps of 15 degrees when they are within a few degrees.

import type { Vec } from '../types';

const DEGREES = Math.PI / 180;
const TURN_STEP = 15 * DEGREES;
const TURN_SNAP = 3 * DEGREES;
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

export interface Reshape {
  readonly scale: number;
  /** Radians, clockwise on screen. */
  readonly turn: number;
}

/** The size and turn the pen's move from `anchor` to `pen` asks of a shape centered at `pivot`. */
export function reshapeFor(pivot: Vec, anchor: Vec, pen: Vec): Reshape {
  const before = Math.hypot(anchor.x - pivot.x, anchor.y - pivot.y);
  const after = Math.hypot(pen.x - pivot.x, pen.y - pivot.y);
  if (before < 1e-6) return { scale: 1, turn: 0 };
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, after / before));
  let turn = Math.atan2(pen.y - pivot.y, pen.x - pivot.x) - Math.atan2(anchor.y - pivot.y, anchor.x - pivot.x);
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  const nearest = Math.round(turn / TURN_STEP) * TURN_STEP;
  if (Math.abs(turn - nearest) <= TURN_SNAP) turn = nearest;
  return { scale, turn };
}

/** Points scaled and turned about a pivot. */
export function applyReshape(points: readonly Vec[], pivot: Vec, change: Reshape): Vec[] {
  const cos = Math.cos(change.turn) * change.scale;
  const sin = Math.sin(change.turn) * change.scale;
  return points.map((p) => ({
    x: pivot.x + (p.x - pivot.x) * cos - (p.y - pivot.y) * sin,
    y: pivot.y + (p.x - pivot.x) * sin + (p.y - pivot.y) * cos,
  }));
}

/** The middle of a shape's points' box, which it turns and grows about. */
export function pivotOf(points: readonly Vec[]): Vec {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
