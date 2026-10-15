// The shapes in handwritten math that are made of geometry and not of letters (A1-28): the bar of a fraction or a
// minus, a root sign, an integral sign, and brackets. Letters and digits are read by the handwriting recognizer; the
// strokes here are told apart by how they bend, so no model is needed and every rule is tested on drawn fixtures.
export type Pt = readonly [number, number];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Shape = 'bar' | 'vbar' | 'radical' | 'integral' | 'open' | 'close' | 'openSquare' | 'closeSquare' | 'other';

export const boxOf = (points: readonly Pt[]): Box => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};

export const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

export const width = (b: Box): number => b.x1 - b.x0;
export const height = (b: Box): number => b.y1 - b.y0;
export const centerX = (b: Box): number => (b.x0 + b.x1) / 2;
export const centerY = (b: Box): number => (b.y0 + b.y1) / 2;

export function pathLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** Points at even spacing along the path, so a slow stretch and a fast one count the same. */
export function resample(points: readonly Pt[], count = 32): Pt[] {
  if (points.length < 2) return [...points];
  const total = pathLength(points);
  if (total === 0) return [points[0]];
  const step = total / (count - 1);
  const out: Pt[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length; i += 1) {
    let [px, py] = points[i - 1];
    const [qx, qy] = points[i];
    let segment = Math.hypot(qx - px, qy - py);
    while (carried + segment >= step && segment > 0) {
      const t = (step - carried) / segment;
      px += (qx - px) * t;
      py += (qy - py) * t;
      out.push([px, py]);
      segment = Math.hypot(qx - px, qy - py);
      carried = 0;
    }
    carried += segment;
  }
  while (out.length < count) out.push(points[points.length - 1]);
  return out.slice(0, count);
}

/** The turn at each point of an even path, in radians, positive when it turns clockwise on screen. */
function turns(path: readonly Pt[]): number[] {
  const out: number[] = [];
  for (let i = 1; i + 1 < path.length; i += 1) {
    const [ax, ay] = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]];
    const [bx, by] = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]];
    out.push(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  return out;
}

/** Sums the turns over a window, which steadies them against the jitter of a hand. */
function smooth(values: readonly number[], span = 3): number[] {
  return values.map((_, i) => {
    let sum = 0;
    for (let k = Math.max(0, i - span); k <= Math.min(values.length - 1, i + span); k += 1) sum += values[k];
    return sum;
  });
}

const RIGHT_ANGLE = Math.PI / 3;

/** How many times the curve changes the way it bends, ignoring wobble. */
function inflections(path: readonly Pt[]): number {
  const bends = smooth(turns(path)).filter((value) => Math.abs(value) > 0.35);
  let count = 0;
  for (let i = 1; i < bends.length; i += 1) if (Math.sign(bends[i]) !== Math.sign(bends[i - 1])) count += 1;
  return count;
}

/** The sharp corners of a path: their index, and the turn. */
function corners(path: readonly Pt[]): { at: number; turn: number }[] {
  const raw = smooth(turns(path), 1);
  const found: { at: number; turn: number }[] = [];
  raw.forEach((turn, i) => {
    if (Math.abs(turn) < RIGHT_ANGLE) return;
    const last = found[found.length - 1];
    if (last && i - last.at <= 2 && Math.sign(last.turn) === Math.sign(turn)) {
      if (Math.abs(turn) > Math.abs(last.turn)) found[found.length - 1] = { at: i + 1, turn };
    } else found.push({ at: i + 1, turn });
  });
  return found;
}

/** Which kind of shape one stroke is, for the strokes that math makes of lines. Everything else is `other`. */
export function shapeOf(points: readonly Pt[]): Shape {
  if (points.length < 2) return 'other';
  const box = boxOf(points);
  const [w, h] = [width(box), height(box)];
  const length = pathLength(points);
  if (length === 0) return 'other';
  const chord = Math.hypot(points[points.length - 1][0] - points[0][0], points[points.length - 1][1] - points[0][1]);
  const straight = chord / length;
  if (h < 0.18 * w && straight > 0.8) return 'bar';
  const path = resample(points);
  if (w < 0.2 * h && straight > 0.85 && h > 0 && Math.abs(bowOf(path)) < 0.06 * h) return 'vbar';
  const sharp = corners(path);
  // A root sign: a small tick down, a long stroke up to the right, then a bar to the right.
  if (w > 0.8 * h && sharp.length >= 2 && endsFlat(path) && dipsThenRises(path)) return 'radical';
  if (h > 1.8 * w && h > 0) {
    // A square bracket has two square corners that turn the same way and a long straight side.
    if (sharp.length === 2 && Math.sign(sharp[0].turn) === Math.sign(sharp[1].turn) && straight > 0.5) {
      return path[0][0] > centerX(box) ? 'openSquare' : 'closeSquare';
    }
    if (inflections(path) >= 1 && straight > 0.55 && length > 1.15 * h) return 'integral';
    if (straight > 0.7) return bulge(path, box);
  }
  return 'other';
}

/** A bracket stroke is a bow: its middle sits left of the ends for `(` and right of them for `)`. */
function bulge(path: readonly Pt[], box: Box): Shape {
  const bow = bowOf(path);
  if (Math.abs(bow) < 0.06 * height(box)) return 'vbar';
  return bow < 0 ? 'open' : 'close';
}

/** How far the middle of the path sits to the right of the line between its ends: negative for `(`. */
function bowOf(path: readonly Pt[]): number {
  const ends = (path[0][0] + path[path.length - 1][0]) / 2;
  return path[Math.floor(path.length / 2)][0] - ends;
}

/** Whether the last stretch of the path runs level, as the roof of a root sign does. */
function endsFlat(path: readonly Pt[]): boolean {
  const tail = path.slice(Math.floor(path.length * 0.75));
  const box = boxOf(tail);
  return width(box) > 0 && height(box) < 0.4 * width(box);
}

/** Whether the path goes down early and then climbs well above where it began. */
function dipsThenRises(path: readonly Pt[]): boolean {
  const lowest = path.reduce((best, p, i) => (p[1] > path[best][1] ? i : best), 0);
  const highest = path.reduce((best, p, i) => (p[1] < path[best][1] ? i : best), 0);
  return lowest > 0 && lowest < path.length * 0.6 && highest > lowest && path[highest][1] < path[0][1];
}
