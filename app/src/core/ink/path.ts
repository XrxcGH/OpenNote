// Ink paths: the curve a pen's samples stand for, and the outline of exact geometry. The page view (the live stroke,
// the tiles, replay) and export (print, PDF, pictures) both draw ink through these, so a stroke has one shape
// everywhere it shows.
//
// A digitizer samples the pen 60 to 240 times a second, so a fast hand leaves samples far apart, and straight lines
// between them show as corners. The function `smoothPath` puts back the curve. It draws a centripetal Catmull-Rom
// spline through the samples: one that passes through every sample, never loops between two, and never overshoots a
// tight turn. First a light filter steadies the jitter of a slow hand. It never moves the newest sample, so the ink
// never lags the pen. A turn too sharp for a smooth hand stays a corner.
//
// `exactOutline` is for shapes and other exact geometry: one even width, mitered corners, and a closed outline when the
// line ends where it starts.

export interface XY {
  readonly x: number;
  readonly y: number;
}

/**
 * Makes the point `t` of the way from `a` to `b` at (x, y): the other channels (pressure, tilt, time) are interpolated
 * and the position is the one given. `smoothPath` calls it with `t` 0 to move a point and keep its channels.
 */
export type Mix<T> = (a: T, b: T, t: number, x: number, y: number) => T;

/**
 * A sample where the path turns more than this (100 degrees) is a corner the pen made, and it stays sharp. A fast
 * hand at 60 Hz turns up to 85 degrees from one sample to the next round the top of a cursive loop, which is a curve.
 */
export const CORNER_TURN = (100 * Math.PI) / 180;
/** The smoothed curve turns about this much (3 degrees) from one piece to the next, at most twice it. */
export const MAX_PIECE_TURN = (3 * Math.PI) / 180;
/** No piece of a smoothed curve is shorter than this, in page units, so a dense slow stroke gains no points. */
const MIN_PIECE = 0.25;
/** Nor longer than this, so a renderer's handling of a corner stays near the corner. */
const MAX_PIECE = 6;
const MAX_PIECES = 64;
/**
 * The filter moves a sample halfway to the midpoint of its neighbors when both are close (the jitter of a slow hand),
 * less as they get farther, and not at all past this distance in page units: far samples are a fast hand, and true.
 */
const FILTER_REACH = 2;
/** A miter longer than this many half widths becomes a round join, as in SVG. */
export const MITER_LIMIT = 4;

const dist = (a: XY, b: XY): number => Math.hypot(b.x - a.x, b.y - a.y);

/** How far the path turns at `b`, from 0 (straight on) to pi (straight back). 0 when a segment has no length. */
export function turnAt(a: XY, b: XY, c: XY): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) return 0;
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

/** The light, zero-lag filter: inner samples only, and the ends stay where they are. */
function steadied<T extends XY>(points: readonly T[], mix: Mix<T>): T[] {
  const out = points.slice();
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const p = points[i];
    const b = points[i + 1];
    const k = 0.5 * Math.max(0, 1 - Math.max(dist(a, p), dist(p, b)) / FILTER_REACH);
    if (k > 0) out[i] = mix(p, p, 0, p.x + k * ((a.x + b.x) / 2 - p.x), p.y + k * ((a.y + b.y) / 2 - p.y));
  }
  return out;
}

/** The point across `from` from `to`: a straight start or end for the spline at a corner. */
const across = (from: XY, to: XY): XY => ({ x: 2 * from.x - to.x, y: 2 * from.y - to.y });

/**
 * A point before the end `end` of a line whose next points are `next` and `after`, where the line would have been if it
 * went on curving as it does there: the chord to `next`, turned back by the turn at `next`. Straight at a corner.
 */
function beyond(end: XY, next: XY, after: XY): XY {
  const turn = turnAt(end, next, after);
  if (turn > CORNER_TURN) return across(end, next);
  const vx = next.x - end.x;
  const vy = next.y - end.y;
  const wx = after.x - next.x;
  const wy = after.y - next.y;
  const signed = Math.sign(vx * wy - vy * wx) * turn;
  const cos = Math.cos(-signed);
  const sin = Math.sin(-signed);
  return { x: end.x - (vx * cos - vy * sin), y: end.y - (vx * sin + vy * cos) };
}

/**
 * The curve through a pen's samples, as points close enough together that straight lines between them read as the
 * curve at any zoom: no piece turns more than 4 degrees from the last, except at a corner the pen made. A stroke of
 * one or two samples comes back as it is.
 */
export function smoothPath<T extends XY>(points: readonly T[], mix: Mix<T>): T[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const p = steadied(points, mix);
  const out: T[] = [p[0]];
  for (let i = 0; i < n - 1; i++) {
    const p1 = p[i];
    const p2 = p[i + 1];
    const d12 = dist(p1, p2);
    if (d12 === 0) {
      out.push(p2);
      continue;
    }
    // The neighbors the spline curves toward. At an end, the line goes on as it curves there; at a corner, straight.
    const p0 = i > 0 ? p[i - 1] : beyond(p1, p2, p[i + 2]);
    const p3 = i < n - 2 ? p[i + 2] : beyond(p2, p1, p[i - 1]);
    const turn1 = turnAt(p0, p1, p2);
    const turn2 = turnAt(p1, p2, p3);
    const smooth1 = turn1 <= CORNER_TURN && dist(p0, p1) > 0;
    const smooth2 = turn2 <= CORNER_TURN && dist(p2, p3) > 0;
    const bend = Math.max(smooth1 ? turn1 : 0, smooth2 ? turn2 : 0);
    const wanted = Math.ceil(Math.max(bend / MAX_PIECE_TURN, d12 / MAX_PIECE));
    const pieces = Math.min(MAX_PIECES, Math.floor(d12 / MIN_PIECE), wanted);
    if (pieces <= 1) {
      out.push(p2);
      continue;
    }
    const q0 = smooth1 ? p0 : across(p1, p2);
    const q3 = smooth2 ? p3 : across(p2, p1);
    // Centripetal knots: the square root of each chord's length.
    const k01 = Math.sqrt(dist(q0, p1));
    const k12 = Math.sqrt(d12);
    const k23 = Math.sqrt(dist(p2, q3));
    // The Hermite tangents of the Catmull-Rom segment from p1 to p2, scaled to its own knot interval.
    const m1x = k12 * ((p1.x - q0.x) / k01 - (p2.x - q0.x) / (k01 + k12) + (p2.x - p1.x) / k12);
    const m1y = k12 * ((p1.y - q0.y) / k01 - (p2.y - q0.y) / (k01 + k12) + (p2.y - p1.y) / k12);
    const m2x = k12 * ((p2.x - p1.x) / k12 - (q3.x - p1.x) / (k12 + k23) + (q3.x - p2.x) / k23);
    const m2y = k12 * ((p2.y - p1.y) / k12 - (q3.y - p1.y) / (k12 + k23) + (q3.y - p2.y) / k23);
    for (let k = 1; k < pieces; k++) {
      const s = k / pieces;
      const s2 = s * s;
      const s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1;
      const h10 = s3 - 2 * s2 + s;
      const h01 = -2 * s3 + 3 * s2;
      const h11 = s3 - s2;
      out.push(
        mix(
          p1,
          p2,
          s,
          h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
          h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
        ),
      );
    }
    out.push(p2);
  }
  return out;
}

/** The ring's signed area: its sign says which way the ring winds. */
function area(ring: readonly XY[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** The ring, wound the one way every piece of an exact outline winds, so the pieces fill as one shape. */
function wound(ring: XY[]): XY[] {
  return area(ring) < 0 ? ring.reverse() : ring;
}

/** A disc of radius `r` at `c`, close enough to round that no edge strays a fiftieth of a unit from the circle. */
export function disc(c: XY, r: number): XY[] {
  const step = 2 * Math.acos(Math.max(0, 1 - 0.02 / Math.max(r, 0.02)));
  const count = Math.min(64, Math.max(12, Math.ceil((2 * Math.PI) / step)));
  return wound(
    Array.from({ length: count }, (_, k) => ({
      x: c.x + r * Math.cos((2 * Math.PI * k) / count),
      y: c.y + r * Math.sin((2 * Math.PI * k) / count),
    })),
  );
}

/** The join at `v` between the segment from `a` and the segment to `b`: a miter, a round join, or none when straight. */
function join(a: XY, v: XY, b: XY, half: number): XY[] | null {
  const l1 = dist(a, v);
  const l2 = dist(v, b);
  const d1 = { x: (v.x - a.x) / l1, y: (v.y - a.y) / l1 };
  const d2 = { x: (b.x - v.x) / l2, y: (b.y - v.y) / l2 };
  const cross = d1.x * d2.y - d1.y * d2.x;
  const dot = d1.x * d2.x + d1.y * d2.y;
  if (Math.abs(cross) < 1e-9 && dot > 0) return null;
  const turn = Math.atan2(Math.abs(cross), dot);
  const ratio = 1 / Math.cos(turn / 2);
  if (!(ratio <= MITER_LIMIT)) return disc(v, half);
  // The outer side of the turn: away from the way the line turns.
  const side = cross > 0 ? -1 : 1;
  const n1 = { x: -d1.y * side, y: d1.x * side };
  const n2 = { x: -d2.y * side, y: d2.x * side };
  const bx = n1.x + n2.x;
  const by = n1.y + n2.y;
  const bl = Math.hypot(bx, by);
  return wound([
    v,
    { x: v.x + n1.x * half, y: v.y + n1.y * half },
    { x: v.x + (bx / bl) * half * ratio, y: v.y + (by / bl) * half * ratio },
    { x: v.x + n2.x * half, y: v.y + n2.y * half },
  ]);
}

/** Points without the ones that repeat the point before. */
function distinct(points: readonly XY[]): XY[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

/**
 * The polygons that fill a line of one even `width` through exact points: a band along each segment, a join at each
 * corner (a miter, or a round join where a miter would reach past four half widths), and round ends. A line that ends
 * where it starts is closed, with a join there instead of ends. Every polygon winds the same way, so filled together
 * with the nonzero rule they make one shape, with no seams and no doubled color where they overlap.
 */
export function exactOutline(points: readonly XY[], width: number): XY[][] {
  const half = width / 2;
  const line = distinct(points);
  if (line.length === 0 || !(half > 0)) return [];
  if (line.length === 1) return [disc(line[0], half)];
  const last = line.length - 1;
  const closed = last >= 3 && dist(line[0], line[last]) <= 1e-6 * (1 + Math.abs(line[0].x) + Math.abs(line[0].y));
  const out: XY[][] = [];
  for (let i = 0; i < last; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = dist(a, b);
    const nx = (-(b.y - a.y) / len) * half;
    const ny = ((b.x - a.x) / len) * half;
    out.push(
      wound([
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny },
      ]),
    );
  }
  for (let i = 1; i < last; i++) {
    const piece = join(line[i - 1], line[i], line[i + 1], half);
    if (piece) out.push(piece);
  }
  if (closed) {
    const piece = join(line[last - 1], line[0], line[1], half);
    if (piece) out.push(piece);
  } else {
    out.push(disc(line[0], half), disc(line[last], half));
  }
  return out;
}
