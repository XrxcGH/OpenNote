// Stroke geometry for the ink spike: turns pen points into filled outlines with perfect-freehand.
import { getStroke, type StrokeOptions } from 'perfect-freehand';

/** A pen sample in CSS pixels, with pressure from 0 to 1. */
export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

/** A rectangle in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A filled piece of a stroke and the box that contains it. */
export interface Piece {
  path: Path2D;
  box: Box;
}

/** Ink and paper colors from brand/tokens.json (text.primary and surface.page in the light theme). */
export const INK_COLOR = '#2B2521';
export const PAPER_COLOR = '#FFFCF6';
/** Stroke width in CSS pixels at medium pressure. */
export const INK_SIZE = 10;
/** How much pressure changes the width, as perfect-freehand defines it. */
export const THINNING = 0.5;

// No streamlining, so each piece ends exactly at the pen. Round caps let pieces join without gaps.
const OPTIONS: StrokeOptions = {
  size: INK_SIZE,
  thinning: THINNING,
  smoothing: 0.5,
  streamline: 0,
  simulatePressure: false,
  last: true,
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
};

/** Points kept from before the new ones, so a new piece overlaps the last and curves with it. */
const OVERLAP = 2;

/** The stroke radius at a pressure, matching perfect-freehand's formula with no easing. */
export function radiusAt(pressure: number): number {
  return INK_SIZE * (0.5 - THINNING * (0.5 - pressure));
}

/** The outline of a run of points, as perfect-freehand draws it. */
export function outline(points: readonly InkPoint[]): number[][] {
  return getStroke(
    points.map((point) => [point.x, point.y, point.pressure]),
    OPTIONS,
  );
}

/** The piece that draws the last `added` points of a stroke, joined to the points before them. */
export function newPiece(stroke: readonly InkPoint[], added: number): Piece | null {
  const from = Math.max(0, stroke.length - added - OVERLAP);
  return toPiece(outline(stroke.slice(from)));
}

/** A temporary tail from the end of the stroke through predicted points. */
export function tailPiece(stroke: readonly InkPoint[], predicted: readonly InkPoint[]): Piece | null {
  const last = stroke[stroke.length - 1];
  if (!last || predicted.length === 0) return null;
  return toPiece(outline([last, ...predicted]));
}

/** Turns an outline into a closed path, smoothed with quadratic curves between midpoints. */
export function toPiece(points: readonly number[][]): Piece | null {
  if (points.length < 3) return null;
  const path = new Path2D();
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const [first] = points;
  path.moveTo(first[0], first[1]);
  for (let index = 0; index < points.length; index++) {
    const [x, y] = points[index];
    const [nextX, nextY] = points[(index + 1) % points.length];
    path.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
    box.left = Math.min(box.left, x);
    box.top = Math.min(box.top, y);
    box.right = Math.max(box.right, x);
    box.bottom = Math.max(box.bottom, y);
  }
  path.closePath();
  return { path, box };
}

/** True when two boxes overlap. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}
