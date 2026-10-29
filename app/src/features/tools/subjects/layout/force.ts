// Force-directed drawings of any graph, such as automata and social networks, after Fruchterman and Reingold
// (1991). The starting positions come from the seeded generator, so one seed always gives the same drawing.
import { Rng } from '../num/rng';
import { boundsOf, checkGraph, clipEnds } from './graph';
import type { GraphInput, GraphLayout, PlacedNode, RoutedEdge } from './graph';

export interface ForceOptions {
  /** The seed of the starting positions; the same seed gives the same drawing. */
  seed?: bigint;
  iterations?: number;
  /** The ideal edge length. */
  length?: number;
}

/** Fruchterman-Reingold with linear cooling and a light pull toward the center so separate pieces stay close. */
export function layoutForce(graph: GraphInput, options: ForceOptions = {}): GraphLayout {
  const index = checkGraph(graph);
  const n = graph.nodes.length;
  const k = options.length ?? 2;
  const rng = new Rng(options.seed ?? 1n);
  const side = k * Math.sqrt(n);
  const px = graph.nodes.map(() => rng.uniform() * side);
  const py = graph.nodes.map(() => rng.uniform() * side);
  const links = graph.edges.map((e) => [index.get(e.from) ?? 0, index.get(e.to) ?? 0]).filter(([a, b]) => a !== b);
  const iterations = options.iterations ?? 300;
  for (let it = 0; it < iterations; it += 1) {
    const temperature = (side / 10) * (1 - it / iterations);
    forceStep(px, py, links, k, temperature);
  }
  const cx = px.reduce((s, v) => s + v, 0) / n;
  const cy = py.reduce((s, v) => s + v, 0) / n;
  const nodes = graph.nodes.map((node, i) => ({
    id: node.id,
    label: node.label ?? node.id,
    x: px[i] - cx,
    y: py[i] - cy,
    width: node.width ?? 1,
    height: node.height ?? 1,
  }));
  return { nodes, edges: routeStraight(graph, index, nodes, k), bounds: boundsOf(nodes) };
}

function forceStep(px: number[], py: number[], links: readonly number[][], k: number, temperature: number): void {
  const n = px.length;
  const dx = new Array<number>(n).fill(0);
  const dy = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let ex = px[i] - px[j];
      let ey = py[i] - py[j];
      let d = Math.hypot(ex, ey);
      if (d < 1e-9) [ex, ey, d] = [1e-3 * (i - j), 1e-3, Math.hypot(1e-3 * (i - j), 1e-3)];
      const f = (k * k) / d;
      dx[i] += (ex / d) * f;
      dy[i] += (ey / d) * f;
      dx[j] -= (ex / d) * f;
      dy[j] -= (ey / d) * f;
    }
  }
  for (const [a, b] of links) {
    const ex = px[a] - px[b];
    const ey = py[a] - py[b];
    const d = Math.max(Math.hypot(ex, ey), 1e-9);
    const f = (d * d) / k;
    dx[a] -= (ex / d) * f;
    dy[a] -= (ey / d) * f;
    dx[b] += (ex / d) * f;
    dy[b] += (ey / d) * f;
  }
  const cx = px.reduce((s, v) => s + v, 0) / n;
  const cy = py.reduce((s, v) => s + v, 0) / n;
  for (let i = 0; i < n; i += 1) {
    dx[i] -= (px[i] - cx) * 0.05;
    dy[i] -= (py[i] - cy) * 0.05;
    const d = Math.hypot(dx[i], dy[i]);
    if (d > 0) {
      px[i] += (dx[i] / d) * Math.min(d, temperature);
      py[i] += (dy[i] / d) * Math.min(d, temperature);
    }
  }
}

/** Straight edges between boxes; a pair joined both ways bends apart, and a loop rises above its node. */
function routeStraight(
  graph: GraphInput,
  index: Map<string, number>,
  nodes: readonly PlacedNode[],
  k: number,
): RoutedEdge[] {
  const pairs = new Set(graph.edges.map((e) => `${e.from}\u0000${e.to}`));
  return graph.edges.map((e) => {
    const a = nodes[index.get(e.from) ?? 0];
    const b = nodes[index.get(e.to) ?? 0];
    if (a === b) {
      const top = a.y - a.height / 2;
      const r = Math.max(a.width, a.height) * 0.4;
      const points: [number, number][] = [
        [a.x - r, top],
        [a.x - r, top - 2 * r],
        [a.x + r, top - 2 * r],
        [a.x + r, top],
      ];
      return { from: e.from, to: e.to, label: e.label, points };
    }
    let points: [number, number][] = [
      [a.x, a.y],
      [b.x, b.y],
    ];
    if (pairs.has(`${e.to}\u0000${e.from}`)) {
      const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-9);
      const bend = 0.15 * k;
      const mid: [number, number] = [
        (a.x + b.x) / 2 + ((b.y - a.y) / len) * bend,
        (a.y + b.y) / 2 - ((b.x - a.x) / len) * bend,
      ];
      points = [[a.x, a.y], mid, [b.x, b.y]];
    }
    return { from: e.from, to: e.to, label: e.label, points: clipEnds(points, a, b) };
  });
}
