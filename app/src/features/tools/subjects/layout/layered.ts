// Layered drawings of directed acyclic graphs, such as Harris matrices, project networks, and causal graphs. The
// method is Sugiyama's: longest-path layers, dummy nodes on edges that span layers, and barycenter sweeps to remove
// crossings. Priority placement then lets long edges run straight.
import { boundsOf, checkGraph, clipEnds } from './graph';
import type { GraphInput, GraphLayout, PlacedNode, RoutedEdge } from './graph';

export interface LayeredLayout extends GraphLayout {
  /** Each real node's layer, by id; 0 is the top (or left). */
  layers: Record<string, number>;
  /** The number of dummy nodes placed on edges that span more than one layer. */
  dummies: number;
  /** Edge crossings left after the sweeps. */
  crossings: number;
  /** Edges turned around to break cycles (empty for a DAG), as [from, to] pairs of the input. */
  reversed: [string, string][];
}

export interface LayeredOptions {
  direction?: 'down' | 'right';
  /** Space between neighboring boxes in a layer. */
  gap?: number;
  /** Distance between layers. */
  layerGap?: number;
  /** Barycenter sweeps; each is one pass down and one up. */
  sweeps?: number;
}

interface Vertex {
  id: string;
  dummy: boolean;
  size: number;
  layer: number;
  up: number[];
  down: number[];
}

/** Edges as index pairs with cycles broken: a depth-first search turns around every edge that closes a cycle. */
function acyclicEdges(
  n: number,
  edges: readonly [number, number][],
): { edges: [number, number][]; reversed: number[] } {
  const out: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a], i) => out[a].push(i));
  const state = new Uint8Array(n);
  const reversed: number[] = [];
  const visit = (v: number): void => {
    state[v] = 1;
    for (const i of out[v]) {
      const w = edges[i][1];
      if (state[w] === 1) reversed.push(i);
      else if (state[w] === 0) visit(w);
    }
    state[v] = 2;
  };
  for (let v = 0; v < n; v += 1) if (state[v] === 0) visit(v);
  const flip = new Set(reversed);
  const kept = edges.map(([a, b], i): [number, number] => (flip.has(i) ? [b, a] : [a, b])).filter(([a, b]) => a !== b);
  return { edges: kept, reversed };
}

/** Longest-path layers from the sources: a node sits one layer below its lowest predecessor. */
function longestPathLayers(n: number, edges: readonly [number, number][]): number[] {
  const indegree = new Array<number>(n).fill(0);
  const succ: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    indegree[b] += 1;
    succ[a].push(b);
  }
  const layer = new Array<number>(n).fill(0);
  const queue = indegree.flatMap((d, v) => (d === 0 ? [v] : []));
  for (let head = 0; head < queue.length; head += 1) {
    const v = queue[head];
    for (const w of succ[v]) {
      layer[w] = Math.max(layer[w], layer[v] + 1);
      indegree[w] -= 1;
      if (indegree[w] === 0) queue.push(w);
    }
  }
  return layer;
}

/** Real vertices, then a chain of dummies for each edge that spans layers; returns the chains per edge. */
function withDummies(graph: GraphInput, layer: number[], edges: [number, number][], along: 'width' | 'height') {
  const vertices: Vertex[] = graph.nodes.map((node, i) => ({
    id: node.id,
    dummy: false,
    size: node[along] ?? 1,
    layer: layer[i],
    up: [],
    down: [],
  }));
  const chains = edges.map(([a, b]) => {
    const chain = [a];
    for (let l = layer[a] + 1; l < layer[b]; l += 1) {
      vertices.push({ id: `dummy:${vertices.length}`, dummy: true, size: 0, layer: l, up: [], down: [] });
      chain.push(vertices.length - 1);
    }
    chain.push(b);
    for (let k = 0; k + 1 < chain.length; k += 1) {
      vertices[chain[k]].down.push(chain[k + 1]);
      vertices[chain[k + 1]].up.push(chain[k]);
    }
    return chain;
  });
  return { vertices, chains };
}

/** Crossings between two neighboring layers, counted as inversions of the edge endpoints. */
function crossingsBetween(upper: readonly number[], vertices: readonly Vertex[], pos: readonly number[]): number {
  const ends: [number, number][] = [];
  for (const v of upper) for (const w of vertices[v].down) ends.push([pos[v], pos[w]]);
  let count = 0;
  for (let i = 0; i < ends.length; i += 1)
    for (let j = i + 1; j < ends.length; j += 1)
      if ((ends[i][0] - ends[j][0]) * (ends[i][1] - ends[j][1]) < 0) count += 1;
  return count;
}

function totalCrossings(rows: readonly number[][], vertices: readonly Vertex[]): number {
  const pos = positionsOf(rows, vertices.length);
  let sum = 0;
  for (let l = 0; l + 1 < rows.length; l += 1) sum += crossingsBetween(rows[l], vertices, pos);
  return sum;
}

function positionsOf(rows: readonly number[][], n: number): number[] {
  const pos = new Array<number>(n).fill(0);
  for (const row of rows) row.forEach((v, i) => (pos[v] = i));
  return pos;
}

/** One barycenter pass: each layer is sorted by the mean position of its neighbors in the layer before it. */
function sweep(rows: number[][], vertices: readonly Vertex[], downward: boolean): void {
  const pos = positionsOf(rows, vertices.length);
  const order = downward
    ? rows.map((_, i) => i).slice(1)
    : rows
        .map((_, i) => i)
        .reverse()
        .slice(1);
  for (const l of order) {
    const key = (v: number): number => {
      const near = downward ? vertices[v].up : vertices[v].down;
      return near.length === 0 ? pos[v] : near.reduce((s, w) => s + pos[w], 0) / near.length;
    };
    rows[l].sort((a, b) => key(a) - key(b) || pos[a] - pos[b]);
    rows[l].forEach((v, i) => (pos[v] = i));
  }
}

function orderLayers(vertices: readonly Vertex[], sweeps: number): { rows: number[][]; crossings: number } {
  const depth = Math.max(...vertices.map((v) => v.layer)) + 1;
  let rows: number[][] = Array.from({ length: depth }, () => []);
  vertices.forEach((v, i) => rows[v.layer].push(i));
  let best = rows.map((r) => r.slice());
  let bestCount = totalCrossings(rows, vertices);
  for (let s = 0; s < sweeps && bestCount > 0; s += 1) {
    for (const downward of [true, false]) {
      sweep(rows, vertices, downward);
      const count = totalCrossings(rows, vertices);
      if (count < bestCount) [best, bestCount] = [rows.map((r) => r.slice()), count];
    }
  }
  rows = best;
  return { rows, crossings: bestCount };
}

/**
 * Moves node i of a layer toward `target` until a node of equal or higher priority blocks it. Nodes of lower
 * priority are pushed along to keep the minimum separation.
 */
export function moveWithPriority(
  x: number[],
  sep: readonly number[],
  priority: readonly number[],
  i: number,
  target: number,
): void {
  const dir = Math.sign(target - x[i]);
  if (dir === 0) return;
  let allowed = Math.abs(target - x[i]);
  let need = 0;
  for (let j = i + dir; j >= 0 && j < x.length; j += dir) {
    need += sep[dir > 0 ? j - 1 : j];
    const slack = dir * (x[j] - x[i]) - need;
    if (priority[j] >= priority[i]) {
      allowed = Math.min(allowed, Math.max(0, slack));
      break;
    }
  }
  x[i] += dir * allowed;
  for (let j = i + dir; j >= 0 && j < x.length; j += dir) {
    const gap = sep[dir > 0 ? j - 1 : j];
    const limit = x[j - dir] + dir * gap;
    if (dir * (x[j] - limit) >= 0) break;
    x[j] = limit;
  }
}

function placeRows(rows: readonly number[][], vertices: readonly Vertex[], gap: number): number[] {
  const x = new Array<number>(vertices.length).fill(0);
  const seps = rows.map((row) => row.slice(1).map((v, k) => (vertices[row[k]].size + vertices[v].size) / 2 + gap));
  rows.forEach((row, l) => row.forEach((v, k) => (x[v] = k === 0 ? 0 : x[row[k - 1]] + seps[l][k - 1])));
  const passes: ('up' | 'down')[] = ['up', 'down', 'up', 'down'];
  for (const side of passes) {
    const layers =
      side === 'up'
        ? rows.map((_, l) => l).slice(1)
        : rows
            .map((_, l) => l)
            .reverse()
            .slice(1);
    for (const l of layers) {
      const row = rows[l];
      const near = (v: number) => (side === 'up' ? vertices[v].up : vertices[v].down);
      const priority = row.map((v) => (vertices[v].dummy ? Number.MAX_SAFE_INTEGER : near(v).length));
      const xs = row.map((v) => x[v]);
      const byPriority = row.map((_, k) => k).sort((a, b) => priority[b] - priority[a] || a - b);
      for (const k of byPriority) {
        const ns = near(row[k]);
        if (ns.length > 0) moveWithPriority(xs, seps[l], priority, k, ns.reduce((s, w) => s + x[w], 0) / ns.length);
      }
      row.forEach((v, k) => (x[v] = xs[k]));
    }
  }
  const lo = Math.min(...x);
  return x.map((v) => v - lo);
}

/** Lays out a directed graph in layers. Cycles are broken by turning edges around; they are listed in the result. */
export function layoutLayered(graph: GraphInput, options: LayeredOptions = {}): LayeredLayout {
  const index = checkGraph(graph);
  const direction = options.direction ?? 'down';
  const pairs = graph.edges.map((e): [number, number] => [index.get(e.from) ?? 0, index.get(e.to) ?? 0]);
  const { edges, reversed } = acyclicEdges(graph.nodes.length, pairs);
  const layer = longestPathLayers(graph.nodes.length, edges);
  const { vertices, chains } = withDummies(graph, layer, edges, direction === 'right' ? 'height' : 'width');
  const { rows, crossings } = orderLayers(vertices, options.sweeps ?? 6);
  const breadth = placeRows(rows, vertices, options.gap ?? 0.5);
  const layerGap = options.layerGap ?? 1.5;
  const at = (v: number): [number, number] =>
    direction === 'down' ? [breadth[v], vertices[v].layer * layerGap] : [vertices[v].layer * layerGap, breadth[v]];
  const nodes = graph.nodes.map((n, i) => {
    const [x, y] = at(i);
    return { id: n.id, label: n.label ?? n.id, x, y, width: n.width ?? 1, height: n.height ?? 1 };
  });
  const flipped = new Set(reversed);
  const routed = routeChains(graph, pairs, chains, at, flipped, nodes);
  return {
    nodes,
    edges: routed,
    bounds: boundsOf(nodes),
    layers: Object.fromEntries(graph.nodes.map((n, i) => [n.id, layer[i]])),
    dummies: vertices.length - graph.nodes.length,
    crossings,
    reversed: reversed.map((i) => [graph.edges[i].from, graph.edges[i].to]),
  };
}

function routeChains(
  graph: GraphInput,
  pairs: readonly [number, number][],
  chains: readonly number[][],
  at: (v: number) => [number, number],
  flipped: ReadonlySet<number>,
  nodes: readonly PlacedNode[],
): RoutedEdge[] {
  // acyclicEdges drops self-loops, so chains line up with the input edges that are not loops.
  const kept = graph.edges.map((e, i) => ({ e, i })).filter(({ i }) => pairs[i][0] !== pairs[i][1]);
  return kept.map(({ e, i }, k) => {
    const chain = flipped.has(i) ? [...chains[k]].reverse() : chains[k];
    const points = chain.map(at);
    return { from: e.from, to: e.to, label: e.label, points: clipEnds(points, nodes[pairs[i][0]], nodes[pairs[i][1]]) };
  });
}
