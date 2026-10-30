// The input and output of the graph drawings: layered.ts for directed acyclic graphs and force.ts for any graph.
// Both use the checks and the edge clipping here.
import { ensure } from '../errors';

export interface GraphNodeInput {
  id: string;
  label?: string;
  width?: number;
  height?: number;
}

export interface GraphEdgeInput {
  from: string;
  to: string;
  label?: string;
}

export interface GraphInput {
  nodes: readonly GraphNodeInput[];
  edges: readonly GraphEdgeInput[];
}

export interface PlacedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutedEdge {
  from: string;
  to: string;
  label?: string;
  points: [number, number][];
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: RoutedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** The most nodes a drawing takes; larger graphs are refused with a clear message. */
export const MAX_GRAPH_NODES = 2000;

export function checkGraph(graph: GraphInput): Map<string, number> {
  ensure(graph.nodes.length > 0, 'empty', 'nodes');
  ensure(graph.nodes.length <= MAX_GRAPH_NODES, 'tooLarge', String(MAX_GRAPH_NODES));
  const index = new Map<string, number>();
  graph.nodes.forEach((n, i) => {
    ensure(!index.has(n.id), 'shape', n.id);
    index.set(n.id, i);
  });
  for (const e of graph.edges) ensure(index.has(e.from) && index.has(e.to), 'shape', `${e.from} -> ${e.to}`);
  return index;
}

/** Where the segment from the box center toward (x, y) leaves the box. */
function boxExit(node: PlacedNode, x: number, y: number): [number, number] {
  const dx = x - node.x;
  const dy = y - node.y;
  if (dx === 0 && dy === 0) return [node.x, node.y];
  const t = Math.min(
    dx === 0 ? Infinity : node.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : node.height / 2 / Math.abs(dy),
  );
  return t >= 1 ? [node.x, node.y] : [node.x + dx * t, node.y + dy * t];
}

/** Trims a polyline so it starts and ends on the node boxes, where an arrowhead can show. */
export function clipEnds(points: [number, number][], from: PlacedNode, to: PlacedNode): [number, number][] {
  if (points.length < 2) return points;
  const out = points.slice();
  out[0] = boxExit(from, ...out[1]);
  out[out.length - 1] = boxExit(to, ...out[out.length - 2]);
  return out;
}

/** A self-loop's route: a small rectangle standing on the top edge of the node's box. */
export function loopRoute(a: PlacedNode): [number, number][] {
  const top = a.y - a.height / 2;
  const r = Math.max(a.width, a.height) * 0.4;
  return [
    [a.x - r, top],
    [a.x - r, top - 2 * r],
    [a.x + r, top - 2 * r],
    [a.x + r, top],
  ];
}

export function boundsOf(nodes: readonly PlacedNode[]): GraphLayout['bounds'] {
  return {
    minX: Math.min(...nodes.map((n) => n.x - n.width / 2)),
    minY: Math.min(...nodes.map((n) => n.y - n.height / 2)),
    maxX: Math.max(...nodes.map((n) => n.x + n.width / 2)),
    maxY: Math.max(...nodes.map((n) => n.y + n.height / 2)),
  };
}
