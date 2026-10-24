// Perspective grids: lines that meet at one, two, or three vanishing points, drawn as SVG. The lines are computed
// as segments first, so a test can check that they really do pass through their vanishing point.

export type PerspectiveKind = 'one' | 'two' | 'three';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Which vanishing point the line runs to (0 is the first), or -1 for the horizon. */
  point: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PerspectiveGrid {
  width: number;
  height: number;
  horizon: number;
  /** The vanishing points, left to right, with the vertical one (if any) last. */
  points: Point[];
  segments: Segment[];
}

export interface PerspectiveOptions {
  kind: PerspectiveKind;
  width: number;
  height: number;
  /** The horizon height as a fraction of the picture from the top (0.5 is the middle). */
  horizon: number;
  /** Lines drawn to each vanishing point. */
  lines: number;
}

/** Evenly spaced positions across a span, not touching the ends. */
const spread = (from: number, to: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 0.5)) / count);

/** A segment from a start point to a vanishing point. */
const toward = (start: Point, point: Point, index: number): Segment => ({
  x1: start.x,
  y1: start.y,
  x2: point.x,
  y2: point.y,
  point: index,
});

export function perspectiveGrid(o: PerspectiveOptions): PerspectiveGrid {
  const { width: w, height: h, lines } = o;
  const horizon = h * o.horizon;
  const points: Point[] =
    o.kind === 'one'
      ? [{ x: w / 2, y: horizon }]
      : [
          { x: w * 0.05, y: horizon },
          { x: w * 0.95, y: horizon },
        ];
  if (o.kind === 'three') points.push({ x: w / 2, y: h * 1.6 });
  const segments: Segment[] = [{ x1: 0, y1: horizon, x2: w, y2: horizon, point: -1 }];
  const edges = [
    ...spread(0, w, lines).map((x) => ({ x, y: 0 })),
    ...spread(0, w, lines).map((x) => ({ x, y: h })),
    ...spread(0, h, lines).map((y) => ({ x: 0, y })),
    ...spread(0, h, lines).map((y) => ({ x: w, y })),
  ];
  if (o.kind === 'one') {
    for (const start of edges) segments.push(toward(start, points[0]!, 0));
    return { width: w, height: h, horizon, points, segments };
  }
  // Two and three point: the receding edges run from verticals spaced along the base line to each side point.
  const base = spread(w * 0.2, w * 0.8, Math.max(2, Math.round(lines / 2)));
  for (const x of base) {
    for (let i = 0; i < 2; i++) segments.push(toward({ x, y: h * 0.9 }, points[i]!, i));
    for (let i = 0; i < 2; i++) segments.push(toward({ x, y: h * 0.55 }, points[i]!, i));
    if (o.kind === 'two') segments.push({ x1: x, y1: h * 0.9, x2: x, y2: h * 0.55, point: -1 });
  }
  if (o.kind === 'three') {
    for (const x of base) segments.push(toward({ x, y: h * 0.9 }, points[2]!, 2));
  }
  return { width: w, height: h, horizon, points, segments };
}

/** Whether three points lie on one straight line, within a small tolerance. */
export function collinear(a: Point, b: Point, c: Point, tolerance = 1e-6): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return (
    Math.abs(cross) <= tolerance * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - a.x, c.y - a.y))
  );
}

const n = (x: number): string => x.toFixed(1);

/** The grid as SVG markup in the page's text color; the horizon is dashed and the vanishing points are marked. */
export function perspectiveSvg(grid: PerspectiveGrid, label: string): string {
  const lines = grid.segments
    .map((s) => {
      const dash = s.point === -1 ? ' stroke-dasharray="6 4" stroke-opacity="0.9"' : ' stroke-opacity="0.5"';
      return `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}"${dash}/>`;
    })
    .join('');
  const marks = grid.points
    .filter((p) => p.y <= grid.height * 1.2)
    .map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="4" fill="currentColor"/>`)
    .join('');
  const low = grid.points.find((p) => p.y > grid.height * 1.2);
  const note = low
    ? `<text x="${n(grid.width / 2)}" y="${n(grid.height - 6)}" font-size="11" text-anchor="middle">↓</text>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.width} ${grid.height}" role="img" aria-label="${label}"` +
    ` stroke="currentColor" stroke-width="1" fill="none"><rect x="0.5" y="0.5" width="${grid.width - 1}" ` +
    `height="${grid.height - 1}" stroke-opacity="0.4"/>${lines}${marks}${note}</svg>`
  );
}
