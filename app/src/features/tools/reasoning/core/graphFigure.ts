// Node-and-edge pictures: state diagrams, graphs, networks, and resource graphs. Nodes sit on a circle, or in columns
// by distance from a start node, so a machine reads left to right. Edges are straight, bent when two run both ways,
// and loops sit above their node.
import { arrowDefs, el, label, pathD, round, svgRoot, textWidth } from './svg';
import type { SvgNode, Tone } from './svg';

export interface GraphNode {
  id: string;
  label?: string;
  /** A double ring, as for an accepting state. */
  ring?: boolean;
  /** An arrow in from the left, as for a start state. */
  start?: boolean;
  tone?: Tone;
  /** A second line under the label, such as an output or a distance. */
  note?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  tone?: Tone;
  /** A thicker line, for edges on a path, tree, or cut. */
  bold?: boolean;
}

export interface GraphLayout {
  directed: boolean;
  /** Columns by breadth-first distance from the first node, or a circle. */
  layout?: 'columns' | 'circle';
}

interface Point {
  x: number;
  y: number;
}

const R = 20;

const SOFT: Partial<Record<Tone, Tone>> = { accent: 'accentSoft', hi: 'hiSoft', warn: 'warnSoft' };
/** The pale fill that goes with a tone. */
export const softOf = (tone: Tone): Tone => SOFT[tone] ?? 'sunken';

function columns(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, Point> {
  const depth = new Map<string, number>();
  const order = nodes.map((n) => n.id);
  const next = (id: string) => edges.filter((e) => e.from === id).map((e) => e.to);
  for (const root of order) {
    if (depth.has(root)) continue;
    const base = depth.size === 0 ? 0 : Math.max(...depth.values()) + 1;
    depth.set(root, base);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const to of next(id))
        if (!depth.has(to)) {
          depth.set(to, depth.get(id)! + 1);
          queue.push(to);
        }
    }
  }
  const byColumn = new Map<number, string[]>();
  for (const id of order) byColumn.set(depth.get(id)!, [...(byColumn.get(depth.get(id)!) ?? []), id]);
  const tallest = Math.max(...[...byColumn.values()].map((c) => c.length));
  const places = new Map<string, Point>();
  for (const [column, ids] of byColumn)
    ids.forEach((id, i) => places.set(id, { x: 60 + column * 110, y: 50 + (i + (tallest - ids.length) / 2) * 90 }));
  return places;
}

function circle(nodes: readonly GraphNode[]): Map<string, Point> {
  const n = nodes.length;
  const radius = n <= 1 ? 0 : Math.max(70, (n * 2 * (R + 22)) / (2 * Math.PI));
  const places = new Map<string, Point>();
  nodes.forEach((node, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    places.set(node.id, { x: radius + 60 + radius * Math.cos(angle), y: radius + 50 + radius * Math.sin(angle) });
  });
  return places;
}

function nodeShape(node: GraphNode, at: Point): SvgNode[] {
  const fill = node.tone ? `@${softOf(node.tone)}` : '@paper';
  const stroke = node.tone ? `@${node.tone}` : '@ink';
  const parts: SvgNode[] = [el('circle', { cx: round(at.x), cy: round(at.y), r: R, fill, stroke, strokeWidth: 1.5 })];
  if (node.ring) parts.push(el('circle', { cx: round(at.x), cy: round(at.y), r: R - 4, fill: 'none', stroke }));
  if (node.start)
    parts.push(
      el('line', {
        x1: round(at.x - R - 26),
        y1: round(at.y),
        x2: round(at.x - R - 1),
        y2: round(at.y),
        stroke: '@ink',
        markerEnd: 'url(#kit-arrow)',
      }),
    );
  const text = node.label ?? node.id;
  const size = textWidth(text) > 2 * R - 8 ? Math.max(8, ((2 * R - 8) / [...text].length) * 1.6) : 12;
  parts.push(label(at.x, at.y, text, { fontSize: round(size) }));
  if (node.note) parts.push(label(at.x, at.y + R + 10, node.note, { fontSize: 11, fill: '@muted' }));
  return parts;
}

function edgeShape(edge: GraphEdge, a: Point, b: Point, bend: number, directed: boolean): SvgNode[] {
  const stroke = edge.tone ? `@${edge.tone}` : '@ink';
  const width = edge.bold ? 3 : 1.25;
  const marker = directed ? 'url(#kit-arrow)' : undefined;
  if (a === b || (a.x === b.x && a.y === b.y)) {
    const top = a.y - R - 34;
    const d = pathD('M', a.x - 8, a.y - R + 2, 'C', a.x - 22, top, a.x + 22, top, a.x + 8, a.y - R + 2);
    return [
      el('path', { d, fill: 'none', stroke, strokeWidth: width, markerEnd: marker }),
      edge.label ? label(a.x, a.y - R - 34, edge.label, { fontSize: 11 }) : null,
    ].filter((x): x is SvgNode => x !== null);
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const mid = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
  const toward = (p: Point, q: Point, cut: number): Point => {
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: p.x + ((q.x - p.x) / l) * cut, y: p.y + ((q.y - p.y) / l) * cut };
  };
  const start = toward(a, mid, R);
  const end = toward(b, mid, R + (directed ? 1 : 0));
  const control = { x: 2 * mid.x - (a.x + b.x) / 2, y: 2 * mid.y - (a.y + b.y) / 2 };
  const d =
    bend === 0
      ? pathD('M', start.x, start.y, 'L', end.x, end.y)
      : pathD('M', start.x, start.y, 'Q', control.x, control.y, end.x, end.y);
  const parts: SvgNode[] = [el('path', { d, fill: 'none', stroke, strokeWidth: width, markerEnd: marker })];
  if (edge.label) {
    const w = textWidth(edge.label, 11) + 6;
    parts.push(
      el('rect', { x: round(mid.x - w / 2), y: round(mid.y - 8), width: round(w), height: 16, rx: 3, fill: '@paper' }),
      label(mid.x, mid.y, edge.label, { fontSize: 11 }),
    );
  }
  return parts;
}

/** A picture of the graph. Edges with the same ends should be merged by the caller, labels joined. */
export function graphFigure(nodes: readonly GraphNode[], edges: readonly GraphEdge[], opts: GraphLayout): SvgNode {
  const places = (opts.layout ?? 'columns') === 'columns' ? columns(nodes, edges) : circle(nodes);
  const xs = [...places.values()].map((p) => p.x);
  const ys = [...places.values()].map((p) => p.y);
  const width = Math.max(160, Math.max(...xs, 0) + 70);
  const height = Math.max(110, Math.max(...ys, 0) + 60);
  const both = new Set(edges.map((e) => `${e.from}\u0000${e.to}`));
  const lines = edges.flatMap((edge) => {
    const a = places.get(edge.from);
    const b = places.get(edge.to);
    if (!a || !b) return [];
    const reverse = edge.from !== edge.to && both.has(`${edge.to}\u0000${edge.from}`);
    const sameColumn = Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) > 100;
    const bend = reverse && opts.directed ? 18 : sameColumn ? 28 : 0;
    return edgeShape(edge, a, b, bend, opts.directed);
  });
  const shapes = nodes.flatMap((node) => nodeShape(node, places.get(node.id)!));
  return svgRoot(width, height, opts.directed ? arrowDefs() : null, el('g', {}, ...lines), el('g', {}, ...shapes));
}
