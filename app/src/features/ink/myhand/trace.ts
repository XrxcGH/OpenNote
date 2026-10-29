// From pictures of ink to pen strokes. Two inputs need it: a PDF that holds handwriting as filled outlines (as
// OneNote exports ink), and a scan or photo of a page. Both go through the same steps:
// 1. Fill the shape on a grid of pixels.
// 2. Thin it to a line one pixel wide (Zhang-Suen).
// 3. Follow that line through its crossings the way a pen would: straight on, not round the corner.
// 4. Read the width at each point from the distance to the edge, which gives the pressure.
// Every size is capped, and nothing here throws on odd input: a shape it can't follow gives no stroke.

/** A point of a traced stroke, in the input's units, with the ink's width there. */
export interface TracedPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export type Traced = TracedPoint[];

/** A one-bit picture: 1 for ink. */
export interface Bitmap {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
}

/** The most pixels one bitmap may have. */
export const MAX_PIXELS = 16_000_000;
/** The most points one outline may have, after its curves are flattened. */
export const MAX_OUTLINE_POINTS = 200_000;

/** A closed outline as flat x, y pairs. */
export type Ring = number[];

/** The area of a ring (positive or negative by its direction). */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i + 1 < n; i += 2) {
    const j = (i + 2) % n;
    sum += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return sum / 2;
}

export function ringLength(ring: Ring): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i + 1 < n; i += 2) {
    const j = (i + 2) % n;
    sum += Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
  }
  return sum;
}

/** Fills rings on a grid, `scale` pixels a unit, by the nonzero rule, as PDF fills them. */
export function fillRings(rings: readonly Ring[], scale: number): { bitmap: Bitmap; x0: number; y0: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minY = Math.min(minY, ring[i + 1]);
      maxY = Math.max(maxY, ring[i + 1]);
    }
  }
  if (!(minX <= maxX) || !(scale > 0)) return null;
  const pad = 2;
  const w = Math.ceil((maxX - minX) * scale) + pad * 2 + 1;
  const h = Math.ceil((maxY - minY) * scale) + pad * 2 + 1;
  if (w * h > MAX_PIXELS || w < 1 || h < 1) return null;
  const x0 = minX - pad / scale;
  const y0 = minY - pad / scale;
  const data = new Uint8Array(w * h);
  // Each edge in pixel space.
  const edges: [number, number, number, number][] = [];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i + 1 < n; i += 2) {
      const j = (i + 2) % n;
      const ax = (ring[i] - x0) * scale;
      const ay = (ring[i + 1] - y0) * scale;
      const bx = (ring[j] - x0) * scale;
      const by = (ring[j + 1] - y0) * scale;
      if (ay !== by) edges.push([ax, ay, bx, by]);
    }
  }
  // Edges bucketed by the first row they cross, then kept in an active list while the rows pass them.
  const starts: number[][] = Array.from({ length: h }, () => []);
  edges.forEach(([, ay, , by], k) => {
    const first = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5));
    if (first < h) starts[first].push(k);
  });
  let active: number[] = [];
  const xs: number[] = [];
  const dirs: number[] = [];
  const order: number[] = [];
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    active.push(...starts[y]);
    active = active.filter((k) => Math.max(edges[k][1], edges[k][3]) > cy);
    xs.length = 0;
    dirs.length = 0;
    for (const k of active) {
      const [ax, ay, bx, by] = edges[k];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
        dirs.push(by > ay ? 1 : -1);
      }
    }
    if (xs.length < 2) continue;
    order.length = 0;
    for (let k = 0; k < xs.length; k++) order.push(k);
    order.sort((a, b) => xs[a] - xs[b]);
    let winding = 0;
    for (let k = 0; k < order.length - 1; k++) {
      winding += dirs[order[k]];
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil(xs[order[k]] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[order[k + 1]] - 0.5));
      for (let x = from; x <= to; x++) data[y * w + x] = 1;
    }
  }
  return { bitmap: { w, h, data }, x0, y0 };
}

/** Thins ink to lines one pixel wide (Zhang-Suen), in place. */
export function thin(bitmap: Bitmap): Bitmap {
  const { w, h, data } = bitmap;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  // The border is cleared, so every neighbor is inside. Only ink pixels are visited, and the list shrinks as the
  // ink thins.
  for (let x = 0; x < w; x++) data[x] = data[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) data[y * w] = data[y * w + w - 1] = 0;
  let live: number[] = [];
  for (let i = 0; i < w * h; i++) if (data[i]) live.push(i);
  const remove: number[] = [];
  let changed = true;
  let rounds = 0;
  while (changed && rounds++ < 500) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      remove.length = 0;
      for (const i of live) {
        const p2 = data[i - w];
        const p3 = data[i - w + 1];
        const p4 = data[i + 1];
        const p5 = data[i + w + 1];
        const p6 = data[i + w];
        const p7 = data[i + w - 1];
        const p8 = data[i - 1];
        const p9 = data[i - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (p2 === 0 && p3 === 1 ? 1 : 0) +
          (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) +
          (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) +
          (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) +
          (p9 === 0 && p2 === 1 ? 1 : 0);
        if (a !== 1) continue;
        if (pass === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0)
          remove.push(i);
      }
      if (remove.length > 0) {
        changed = true;
        for (const i of remove) data[i] = 0;
        live = live.filter((i) => data[i] === 1);
      }
    }
  }
  // Corner pixels that only make a staircase thicker go too, so every line pixel has two neighbors.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      const n = at(x, y - 1);
      const e = at(x + 1, y);
      const s = at(x, y + 1);
      const west = at(x - 1, y);
      if (
        (n && e && !at(x - 1, y + 1)) ||
        (e && s && !at(x - 1, y - 1)) ||
        (s && west && !at(x + 1, y - 1)) ||
        (west && n && !at(x + 1, y + 1))
      ) {
        const count = n + e + s + west + at(x + 1, y - 1) + at(x + 1, y + 1) + at(x - 1, y + 1) + at(x - 1, y - 1);
        if (count === 2) data[y * w + x] = 0;
      }
    }
  }
  return bitmap;
}

/** The distance from each ink pixel to the nearest pixel without ink (3-4 chamfer), in pixels. */
export function distances(bitmap: Bitmap): Float32Array {
  const { w, h, data } = bitmap;
  const big = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = data[i] ? big : 0;
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x - 1, y) + 3, get(x, y - 1) + 3, get(x - 1, y - 1) + 4, get(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x + 1, y) + 3, get(x, y + 1) + 3, get(x + 1, y + 1) + 4, get(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

const NEIGHBOURS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly pixels: number[];
  used: boolean;
}

/** The thinned lines as a graph: clusters of crossing and end pixels as nodes, and the lines between them. */
function graphOf(skeleton: Bitmap): { edges: Edge[]; nodeOf: Int32Array; nodes: number[][] } {
  const { w, h, data } = skeleton;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  const degree = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      let n = 0;
      for (const [dx, dy] of NEIGHBOURS) if (on(x + dx, y + dy)) n++;
      degree[y * w + x] = n;
    }
  }
  const nodeOf = new Int32Array(w * h).fill(-1);
  const nodes: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    if (!data[i] || degree[i] === 2 || nodeOf[i] >= 0) continue;
    const id = nodes.length;
    const cluster: number[] = [];
    const stack = [i];
    nodeOf[i] = id;
    while (stack.length > 0) {
      const p = stack.pop()!;
      cluster.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const q = (py + dy) * w + px + dx;
        if (on(px + dx, py + dy) && degree[q] !== 2 && nodeOf[q] < 0) {
          nodeOf[q] = id;
          stack.push(q);
        }
      }
    }
    nodes.push(cluster);
  }
  const visited = new Uint8Array(w * h);
  const edges: Edge[] = [];
  const walk = (start: number, from: number): Edge => {
    const pixels: number[] = [];
    let prev = from;
    let p = start;
    let end = -1;
    for (let guard = 0; guard < w * h; guard++) {
      if (nodeOf[p] >= 0) {
        end = nodeOf[p];
        break;
      }
      visited[p] = 1;
      pixels.push(p);
      const px = p % w;
      const py = (p - px) / w;
      let next = -1;
      // Straight neighbors first, so a staircase is followed step by step.
      for (const [dx, dy] of NEIGHBOURS) {
        if (!on(px + dx, py + dy)) continue;
        const q = (py + dy) * w + px + dx;
        if (q === prev || (visited[q] && nodeOf[q] < 0)) continue;
        if (nodeOf[q] >= 0 && nodeOf[q] === nodeOf[from] && pixels.length < 2) continue;
        next = q;
        break;
      }
      if (next < 0) break;
      prev = p;
      p = next;
    }
    return { a: nodeOf[from] ?? -1, b: end, pixels, used: false };
  };
  nodes.forEach((cluster) => {
    for (const p of cluster) {
      const px = p % w;
      const py = (p - px) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const q = (py + dy) * w + px + dx;
        if (on(px + dx, py + dy) && nodeOf[q] < 0 && !visited[q]) edges.push(walk(q, p));
      }
    }
  });
  // Closed loops with no crossing at all, such as an o.
  for (let i = 0; i < w * h; i++) {
    if (!data[i] || visited[i] || nodeOf[i] >= 0) continue;
    const pixels: number[] = [];
    let p = i;
    let prev = -1;
    for (let guard = 0; guard < w * h; guard++) {
      visited[p] = 1;
      pixels.push(p);
      const px = p % w;
      const py = (p - px) / w;
      let next = -1;
      for (const [dx, dy] of NEIGHBOURS) {
        const q = (py + dy) * w + px + dx;
        if (on(px + dx, py + dy) && q !== prev && !visited[q]) {
          next = q;
          break;
        }
      }
      if (next < 0) break;
      prev = p;
      p = next;
    }
    if (pixels.length > 2) edges.push({ a: -2, b: -2, pixels: [...pixels, pixels[0]], used: false });
  }
  return { edges, nodeOf, nodes };
}

function centre(cluster: readonly number[], w: number): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const p of cluster) {
    sx += p % w;
    sy += Math.floor(p / w);
  }
  return [sx / cluster.length, sy / cluster.length];
}

function direction(points: readonly [number, number][], fromEnd: boolean): [number, number] {
  const n = points.length;
  if (n < 2) return [0, 0];
  const k = Math.min(n - 1, 6);
  const [a, b] = fromEnd ? [points[n - 1 - k], points[n - 1]] : [points[k], points[0]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

export interface FollowOptions {
  /** Where the pen most likely started, in pixels: the walk begins at the end nearest it. */
  readonly start?: readonly [number, number];
  /** Lines shorter than this, in pixels, are left out unless they are all there is. */
  readonly minLength: number;
  /** Spurs shorter than this that hang off a crossing are trimmed: thinning makes them at the ends of thick ink. */
  readonly spur: number;
}

/** Follows the thinned lines into pen paths, in pixels. */
export function follow(skeleton: Bitmap, options: FollowOptions): [number, number][][] {
  const { w } = skeleton;
  const { edges, nodes } = graphOf(skeleton);
  const pt = (p: number): [number, number] => [p % w, Math.floor(p / w)];
  const nodeEdges = new Map<number, Edge[]>();
  for (const edge of edges) {
    if (edge.a >= 0) nodeEdges.set(edge.a, [...(nodeEdges.get(edge.a) ?? []), edge]);
    if (edge.b >= 0 && edge.b !== edge.a) nodeEdges.set(edge.b, [...(nodeEdges.get(edge.b) ?? []), edge]);
  }
  // Short spurs from a crossing to a loose end.
  const deg = (node: number) => (node < 0 ? 1 : (nodeEdges.get(node)?.length ?? 0));
  for (const edge of edges) {
    if (edge.a === -2) continue;
    const [da, db] = [deg(edge.a), deg(edge.b)];
    if (((da === 1 && db >= 3) || (db === 1 && da >= 3)) && edge.pixels.length < options.spur) edge.used = true;
  }
  const degreeOf = (node: number) => (nodeEdges.get(node) ?? []).filter((e) => !e.used).length;
  const paths: [number, number][][] = [];
  const startNode = (): { edge: Edge; from: number } | null => {
    const open = edges.filter((e) => !e.used);
    if (open.length === 0) return null;
    // Begin at a loose end; the one nearest the pen's start when it is known, else the top-left one.
    const ends: { edge: Edge; from: number; at: [number, number] }[] = [];
    for (const edge of open) {
      if (edge.a >= 0 && degreeOf(edge.a) === 1) ends.push({ edge, from: edge.a, at: centre(nodes[edge.a], w) });
      if (edge.b >= 0 && degreeOf(edge.b) === 1) ends.push({ edge, from: edge.b, at: centre(nodes[edge.b], w) });
      if (edge.b < 0 && edge.a >= 0 && edge.pixels.length > 0)
        ends.push({ edge, from: -3, at: pt(edge.pixels[edge.pixels.length - 1]) });
    }
    const score = (at: [number, number]) =>
      options.start ? Math.hypot(at[0] - options.start[0], at[1] - options.start[1]) : at[0] + at[1] * 0.25;
    if (ends.length > 0) {
      ends.sort((a, b) => score(a.at) - score(b.at));
      return ends[0];
    }
    const loop = open.sort((a, b) => b.pixels.length - a.pixels.length)[0];
    return { edge: loop, from: loop.a };
  };
  for (let guard = 0; guard < edges.length + 1; guard++) {
    const begin = startNode();
    if (!begin) break;
    const path: [number, number][] = [];
    let edge: Edge | null = begin.edge;
    let from = begin.from;
    while (edge) {
      edge.used = true;
      let forward: boolean;
      let to: number;
      if (from === -3) [forward, to] = [false, edge.a];
      else if (edge.a === -2) [forward, to] = [true, -1];
      else if (from === edge.a) [forward, to] = [true, edge.b];
      else [forward, to] = [false, edge.a];
      const pixels = forward ? edge.pixels.map(pt) : [...edge.pixels].reverse().map(pt);
      if (from >= 0 && path.length === 0) path.push(centre(nodes[from], w));
      path.push(...pixels);
      if (to < 0) break;
      path.push(centre(nodes[to], w));
      const heading = direction(path, true);
      let best: Edge | null = null;
      let bestTurn = -Infinity;
      for (const next of nodeEdges.get(to) ?? []) {
        if (next.used) continue;
        const out = next.a === to ? next.pixels.map(pt) : [...next.pixels].reverse().map(pt);
        const dir = direction([centre(nodes[to], w), ...out], false);
        // `dir` points back toward the node, so a straight continuation has it opposite the heading.
        const straight = -(heading[0] * dir[0] + heading[1] * dir[1]);
        if (straight > bestTurn) {
          bestTurn = straight;
          best = next;
        }
      }
      // A pen goes on through a crossing, or round a sharp corner when that is the only way on.
      if (!best || (bestTurn < -0.2 && degreeOf(to) > 1)) break;
      edge = best;
      from = to;
    }
    if (path.length > 0) paths.push(path);
  }
  const long = paths.filter((p) => pathLength(p) >= options.minLength);
  return long.length > 0 ? long : paths.sort((a, b) => pathLength(b) - pathLength(a)).slice(0, 1);
}

function pathLength(path: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return sum;
}

/** Smooths a pixel path a little and drops the points a straight line would pass within `tolerance` of. */
export function tidyPath(path: readonly [number, number][], tolerance: number): [number, number][] {
  if (path.length < 3) return [...path];
  const smooth = path.map((p, i) => {
    if (i === 0 || i === path.length - 1) return p;
    const [a, b] = [path[i - 1], path[i + 1]];
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as [number, number];
  });
  const keep = new Uint8Array(smooth.length);
  keep[0] = keep[smooth.length - 1] = 1;
  const stack: [number, number][] = [[0, smooth.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstD = tolerance;
    const [ax, ay] = smooth[first];
    const [bx, by] = smooth[last];
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = first + 1; i < last; i++) {
      const [px, py] = smooth[i];
      const d =
        len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return smooth.filter((_, i) => keep[i]);
}

/** The width of the ink along a path, from the distances (in pixels). */
function widthsAlong(path: readonly [number, number][], dist: Float32Array, bitmap: Bitmap): number[] {
  return path.map(([x, y]) => {
    let best = 0;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && py >= 0 && px < bitmap.w && py < bitmap.h) best = Math.max(best, dist[py * bitmap.w + px]);
      }
    }
    return Math.max(1, best * 2 - 1);
  });
}

/**
 * One stroke's filled outline (the rings of a PDF fill) to its center line, in the outline's units. The walk starts
 * at the end nearest the outline's first point, which is where pen exports start their outlines.
 */
export function outlineToStrokes(rings: readonly Ring[]): Traced[] {
  const usable = rings.filter((r) => r.length >= 6 && r.length <= MAX_OUTLINE_POINTS * 2);
  if (usable.length === 0) return [];
  const area = Math.abs(usable.reduce((sum, r) => sum + ringArea(r), 0));
  const perimeter = usable.reduce((sum, r) => sum + ringLength(r), 0);
  if (!(perimeter > 0)) return [];
  // A thin shape's width is about twice its area over its perimeter; draw it about six pixels wide.
  const width = Math.max(1e-3, (2 * area) / perimeter);
  let scale = Math.min(60, Math.max(1, 6 / width));
  let filled = fillRings(usable, scale);
  while (!filled && scale > 0.05) {
    scale /= 2;
    filled = fillRings(usable, scale);
  }
  if (!filled) return [];
  const { bitmap, x0, y0 } = filled;
  const dist = distances(bitmap);
  const skeleton = thin({ w: bitmap.w, h: bitmap.h, data: bitmap.data.slice() });
  const start: [number, number] = [(usable[0][0] - x0) * scale, (usable[0][1] - y0) * scale];
  const px = width * scale;
  const paths = follow(skeleton, { start, minLength: px * 1.5, spur: Math.max(3, px * 0.9) });
  return paths.map((path) => {
    const tidy = tidyPath(path, 0.45);
    const widths = widthsAlong(tidy, dist, bitmap);
    return tidy.map(([x, y], i) => ({
      x: x0 + (x + 0.5) / scale,
      y: y0 + (y + 0.5) / scale,
      width: widths[i] / scale,
    }));
  });
}

/**
 * A stroked path (a PDF line drawn with a pen width) to a stroke: its points are already the center line, so they
 * are only thinned out.
 */
export function polylineToStroke(points: readonly number[], width: number): Traced {
  const path: [number, number][] = [];
  for (let i = 0; i + 1 < points.length && path.length < MAX_OUTLINE_POINTS; i += 2)
    path.push([points[i], points[i + 1]]);
  return tidyPath(path, width * 0.05).map(([x, y]) => ({ x, y, width }));
}

/** Otsu's threshold of 8-bit gray levels. */
export function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Ink from a gray picture: the background is evened out over blocks (a photo is lighter in some places than others),
 * dark pixels are ink, and the long thin lines of ruled or squared paper are taken out.
 */
export function inkOf(gray: Uint8Array, w: number, h: number): Bitmap {
  const data = new Uint8Array(w * h);
  if (w * h === 0 || w * h > MAX_PIXELS || gray.length < w * h)
    return { w: Math.max(0, w), h: Math.max(0, h), data: new Uint8Array(0) };
  // The background: the brightest level in each block, spread over the block.
  const block = Math.max(16, Math.round(Math.min(w, h) / 24));
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const bright = new Uint8Array(bw * bh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = Math.floor(y / block) * bw + Math.floor(x / block);
      bright[b] = Math.max(bright[b], gray[y * w + x]);
    }
  }
  const even = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bg = Math.max(32, bright[Math.floor(y / block) * bw + Math.floor(x / block)]);
      even[y * w + x] = Math.min(255, Math.round((gray[y * w + x] / bg) * 255));
    }
  }
  const threshold = Math.min(200, otsu(even));
  for (let i = 0; i < w * h; i++) data[i] = even[i] < threshold ? 1 : 0;
  // Paper lines: runs of ink across most of the width that are no more than a few pixels thick.
  const longRun = Math.round(w * 0.35);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && data[y * w + x]) run++;
      else {
        if (run >= longRun) {
          for (let k = x - run; k < x; k++) {
            // Keep the pixel where ink crosses the line: ink above and below it.
            const up = y > 2 && data[(y - 3) * w + k];
            const down = y < h - 3 && data[(y + 3) * w + k];
            if (!(up && down)) data[y * w + k] = 0;
          }
        }
        run = 0;
      }
    }
  }
  return { w, h, data };
}

/** Pen strokes from a picture of handwriting, in its pixels. */
export function traceBitmap(ink: Bitmap): Traced[] {
  if (ink.data.length === 0) return [];
  const dist = distances(ink);
  // The typical stroke width: twice the middle distance on the thinned lines.
  const skeleton = thin({ w: ink.w, h: ink.h, data: ink.data.slice() });
  const onLine: number[] = [];
  for (let i = 0; i < skeleton.data.length && onLine.length < 50_000; i++) if (skeleton.data[i]) onLine.push(dist[i]);
  onLine.sort((a, b) => a - b);
  const width = Math.max(1, (onLine[onLine.length >> 1] ?? 1) * 2);
  const paths = follow(skeleton, { minLength: width * 2, spur: width * 1.2 });
  return paths.map((path) => {
    const tidy = tidyPath(path, 0.6);
    const widths = widthsAlong(tidy, dist, ink);
    return tidy.map(([x, y], i) => ({ x: x + 0.5, y: y + 0.5, width: widths[i] }));
  });
}
