// Graph view layout: pages as dots, links as springs. A plain force layout (Fruchterman and Reingold) with a fixed
// start and a fixed number of steps, so the same notebook always draws the same picture and nothing moves while it
// is read. It is quick for the few hundred pages a view draws; a bigger graph is cut down to its best connected
// pages first (see `limitNodes`).

export interface Point {
  x: number;
  y: number;
}

/** The most pages one view draws. */
export const MAX_NODES = 400;

/** A small repeatable pseudo-random sequence, so the starting positions never change between runs. */
function sequence(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** How far a page's title starts from its node's center, past the largest (selected) dot. */
export const LABEL_GAP = 11;

/** About how wide one character of a title is drawn: titles are 11 px (graph.module.css), about 0.6 em a character. */
export const TITLE_CHAR = 0.6 * 11;

/**
 * Where a node's title goes: to the right of its node, or to the left when it would run past the picture's right
 * edge there and has more room on the left, so a node pushed against the side keeps its title inside the picture.
 */
export function labelAt(point: Point, width: number, title: string): { x: number; y: number; anchor: 'start' | 'end' } {
  const room = title.length * TITLE_CHAR + LABEL_GAP;
  const right = point.x + room <= width || point.x <= width / 2;
  return { x: point.x + (right ? LABEL_GAP : -LABEL_GAP), y: point.y + 4, anchor: right ? 'start' : 'end' };
}

/** Places `count` nodes in a `width` by `height` box. `edges` are pairs of node numbers. */
export function layoutGraph(
  count: number,
  edges: readonly (readonly [number, number])[],
  width: number,
  height: number,
): Point[] {
  if (count === 0) return [];
  const random = sequence(count * 7919 + edges.length);
  const points: Point[] = Array.from({ length: count }, () =>
    count === 1
      ? { x: width / 2, y: height / 2 }
      : { x: width * (0.1 + 0.8 * random()), y: height * (0.1 + 0.8 * random()) },
  );
  if (count === 1) return points;
  const area = width * height;
  const k = Math.sqrt(area / count);
  const steps = count > 250 ? 90 : 160;
  let heat = Math.min(width, height) / 8;
  const shift = Array.from({ length: count }, () => ({ x: 0, y: 0 }));
  for (let step = 0; step < steps; step += 1) {
    for (const s of shift) {
      s.x = 0;
      s.y = 0;
    }
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        let dx = points[a].x - points[b].x;
        let dy = points[a].y - points[b].y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distance = 0.5;
        }
        const push = (k * k) / distance / distance;
        shift[a].x += dx * push;
        shift[a].y += dy * push;
        shift[b].x -= dx * push;
        shift[b].y -= dy * push;
      }
    }
    for (const [a, b] of edges) {
      const dx = points[a].x - points[b].x;
      const dy = points[a].y - points[b].y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const pull = distance / k;
      shift[a].x -= dx * pull;
      shift[a].y -= dy * pull;
      shift[b].x += dx * pull;
      shift[b].y += dy * pull;
    }
    for (let i = 0; i < count; i += 1) {
      const length = Math.hypot(shift[i].x, shift[i].y) || 0.01;
      const move = Math.min(length, heat);
      // A pull to the middle keeps pages with no links in view.
      points[i].x += (shift[i].x / length) * move + (width / 2 - points[i].x) * 0.01;
      points[i].y += (shift[i].y / length) * move + (height / 2 - points[i].y) * 0.01;
      points[i].x = Math.min(width - 12, Math.max(12, points[i].x));
      points[i].y = Math.min(height - 12, Math.max(12, points[i].y));
    }
    heat *= 0.96;
  }
  return fill(points, width, height);
}

/** How far the nodes keep from the picture's sides once spread out, and the most the layout is enlarged. */
const FILL = { margin: 24, most: 2 } as const;

/**
 * The pull toward the center leaves the settled nodes in about the middle half of the box, crowded together with
 * their titles on top of each other. This enlarges the layout evenly about its own center, up to FILL.most times, so
 * it spreads over the box with FILL.margin to spare, then centers it.
 */
function fill(points: readonly Point[], width: number, height: number): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const room = (span: number, size: number) => (span > 0 ? (size - 2 * FILL.margin) / span : FILL.most);
  const scale = Math.max(1, Math.min(FILL.most, room(right - left, width), room(bottom - top, height)));
  const [cx, cy] = [(left + right) / 2, (top + bottom) / 2];
  return points.map(({ x, y }) => ({ x: width / 2 + (x - cx) * scale, y: height / 2 + (y - cy) * scale }));
}

/** Keeps the best connected pages when there are more than the view can draw. Returns the kept node numbers. */
export function limitNodes(count: number, edges: readonly (readonly [number, number])[], keep = MAX_NODES): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (count <= keep) return all;
  const degree = new Array<number>(count).fill(0);
  for (const [a, b] of edges) {
    degree[a] += 1;
    degree[b] += 1;
  }
  return all
    .sort((a, b) => degree[b] - degree[a] || a - b)
    .slice(0, keep)
    .sort((a, b) => a - b);
}
