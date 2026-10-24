// Snap tools: the ruler, the protractor, and snap to grid. They are pure geometry on page units, so a Node test drives
// them. A stroke that begins at a ruler's edge runs straight along it. One that begins at a protractor's center turns
// in whole steps of its angle. With the grid on, every point lands on the grid. The page view turns these into the
// widgets on the page and calls them as a pen's samples arrive.
import { PAGE_UNITS_PER_MM } from '../geometry/stabilizer';
import type { Vec } from '../geometry/types';

export interface Ruler {
  /** The center, in page units. */
  readonly cx: number;
  readonly cy: number;
  /** Radians, clockwise on screen. */
  readonly angle: number;
  /** The length along its edge. */
  readonly length: number;
  /** The width across, from one edge to the other. */
  readonly width: number;
}

export interface Protractor {
  readonly cx: number;
  readonly cy: number;
  /** The direction of the zero line, in radians. */
  readonly angle: number;
  /** The radius of the half circle. */
  readonly radius: number;
}

export const DEFAULT_RULER: Ruler = {
  cx: 400,
  cy: 300,
  angle: 0,
  length: 30 * 10 * PAGE_UNITS_PER_MM,
  width: 18 * PAGE_UNITS_PER_MM,
};
export const DEFAULT_PROTRACTOR: Protractor = { cx: 400, cy: 400, angle: 0, radius: 60 * PAGE_UNITS_PER_MM };
/** A protractor turns a line in steps of this many degrees. */
export const ANGLE_STEP_DEGREES = 15;

/** Which long side of the ruler a stroke runs along: the top edge (-1) or the bottom edge (1) of its own axis. */
export type RulerEdge = -1 | 1;

/** A point in the ruler's own axes: `u` along its length from the center, `v` across. */
export function toRulerSpace(ruler: Ruler, p: Vec): { u: number; v: number } {
  const cos = Math.cos(ruler.angle);
  const sin = Math.sin(ruler.angle);
  const dx = p.x - ruler.cx;
  const dy = p.y - ruler.cy;
  return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos };
}

export function fromRulerSpace(ruler: Ruler, u: number, v: number): Vec {
  const cos = Math.cos(ruler.angle);
  const sin = Math.sin(ruler.angle);
  return { x: ruler.cx + u * cos - v * sin, y: ruler.cy + u * sin + v * cos };
}

/** The edge a point is near, within `reach` page units of it and along the ruler's length, or null. */
export function nearRulerEdge(ruler: Ruler, p: Vec, reach: number): RulerEdge | null {
  const { u, v } = toRulerSpace(ruler, p);
  if (Math.abs(u) > ruler.length / 2 + reach) return null;
  const top = Math.abs(v + ruler.width / 2);
  const bottom = Math.abs(v - ruler.width / 2);
  if (Math.min(top, bottom) > reach) return null;
  return top <= bottom ? -1 : 1;
}

/** A point put on the ruler's edge, kept within the ruler's length. */
export function onRulerEdge(ruler: Ruler, edge: RulerEdge, p: Vec): Vec {
  const { u } = toRulerSpace(ruler, p);
  const clamped = Math.max(-ruler.length / 2, Math.min(ruler.length / 2, u));
  return fromRulerSpace(ruler, clamped, (edge * ruler.width) / 2);
}

/** True when a point is at the protractor's center, where a line starts. */
export function atProtractorCenter(protractor: Protractor, p: Vec, reach: number): boolean {
  return Math.hypot(p.x - protractor.cx, p.y - protractor.cy) <= reach;
}

/** The angle of a line from `origin` to `p` against the protractor's zero line, in degrees from 0 up to 360. */
export function protractorAngle(protractor: Protractor, origin: Vec, p: Vec): number {
  const raw = (Math.atan2(p.y - origin.y, p.x - origin.x) - protractor.angle) * (180 / Math.PI);
  return ((raw % 360) + 360) % 360;
}

/** `p` turned about `origin` to the nearest whole step of the protractor, at the same distance. */
export function snapToProtractor(protractor: Protractor, origin: Vec, p: Vec, stepDegrees = ANGLE_STEP_DEGREES): Vec {
  const length = Math.hypot(p.x - origin.x, p.y - origin.y);
  if (length === 0) return p;
  const step = (stepDegrees * Math.PI) / 180;
  const raw = Math.atan2(p.y - origin.y, p.x - origin.x) - protractor.angle;
  const snapped = Math.round(raw / step) * step + protractor.angle;
  return { x: origin.x + length * Math.cos(snapped), y: origin.y + length * Math.sin(snapped) };
}

/** A point on the nearest grid crossing. `size` is the spacing in page units. */
export function snapToGrid(p: Vec, size: number): Vec {
  if (!(size > 0)) return p;
  return { x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size };
}

/** The grid's spacing in page units for a spacing in millimeters. */
export function gridSize(mm: number): number {
  return mm * PAGE_UNITS_PER_MM;
}

/** What a stroke is held to once it begins. */
export type Hold =
  | { readonly kind: 'ruler'; readonly edge: RulerEdge }
  | { readonly kind: 'protractor'; readonly origin: Vec }
  | { readonly kind: 'grid' }
  | { readonly kind: 'none' };

export interface SnapTools {
  readonly ruler: Ruler | null;
  readonly protractor: Protractor | null;
  /** The grid spacing in page units, or 0 for no grid. */
  readonly grid: number;
  /** How near a start must be to an edge or the center, in page units. */
  readonly reach: number;
}

/** What a stroke starting at `p` is held to: a ruler's edge, a protractor's center, the grid, or nothing. */
export function holdFor(tools: SnapTools, p: Vec): Hold {
  if (tools.ruler) {
    const edge = nearRulerEdge(tools.ruler, p, tools.reach);
    if (edge !== null) return { kind: 'ruler', edge };
  }
  if (tools.protractor && atProtractorCenter(tools.protractor, p, tools.reach)) {
    return { kind: 'protractor', origin: { x: tools.protractor.cx, y: tools.protractor.cy } };
  }
  return tools.grid > 0 ? { kind: 'grid' } : { kind: 'none' };
}

/** A sample moved to where its stroke's hold puts it. */
export function applyHold(tools: SnapTools, hold: Hold, p: Vec): Vec {
  switch (hold.kind) {
    case 'ruler':
      return tools.ruler ? onRulerEdge(tools.ruler, hold.edge, p) : p;
    case 'protractor':
      if (!tools.protractor) return p;
      // The line starts at the center, and turns in whole steps once it leaves it.
      return Math.hypot(p.x - hold.origin.x, p.y - hold.origin.y) <= tools.reach
        ? hold.origin
        : snapToProtractor(tools.protractor, hold.origin, p);
    case 'grid':
      return snapToGrid(p, tools.grid);
    case 'none':
      return p;
  }
}
