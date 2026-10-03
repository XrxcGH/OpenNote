// Connectors: lines and arrows that join shapes. A connector end that touches a shape's outline is attached to it, and
// follows when the shape moves. Nothing is stored for this: the ends are read back from the strokes' geometry, so a
// note written by an older version still has its connectors attached.

import { pointSegmentDistanceSq } from '../primitives';
import type { Vec } from '../types';
import { dragHandle } from './edit';
import type { Shape } from './types';

export type End = 'start' | 'end';

/** True for the shapes that join other shapes. */
export function isConnector(shape: Shape): boolean {
  return (
    shape.kind === 'line' || shape.kind === 'arrow' || shape.kind === 'doubleArrow' || shape.kind === 'curvedArrow'
  );
}

/** Where a connector starts and ends, or null for a shape that is no connector. */
export function endsOf(shape: Shape): { start: Vec; end: Vec } | null {
  switch (shape.kind) {
    case 'line':
      return { start: shape.from, end: shape.to };
    case 'arrow':
      return { start: shape.from, end: shape.tip };
    case 'doubleArrow':
      return { start: shape.from, end: shape.to };
    case 'curvedArrow': {
      const at = (angle: number): Vec => ({
        x: shape.center.x + shape.radius * Math.cos(angle),
        y: shape.center.y + shape.radius * Math.sin(angle),
      });
      return { start: at(shape.start), end: at(shape.start + shape.sweep) };
    }
    default:
      return null;
  }
}

/** The connector with one end moved to a page point. */
export function moveEnd(shape: Shape, which: End, to: Vec): Shape {
  if (shape.kind === 'curvedArrow') return dragHandle(shape, which, to);
  return dragHandle(shape, which === 'start' ? 'from' : 'to', to);
}

/** The point of an outline nearest `p`, when it lies within `reach`, else null. */
export function nearestOnOutline(outline: readonly Vec[], p: Vec, reach: number): Vec | null {
  let best: Vec | null = null;
  let bestSq = reach * reach;
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i - 1];
    const b = outline[i];
    const d = pointSegmentDistanceSq(p, a, b);
    if (d > bestSq) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    best = { x: a.x + dx * t, y: a.y + dy * t };
    bestSq = d;
  }
  return best;
}

/** A shape's outline as a polyline, for shapes that enclose an area. Connectors and lone arcs have none. */
export function isClosedShape(shape: Shape): boolean {
  return !isConnector(shape) && shape.kind !== 'arc';
}
