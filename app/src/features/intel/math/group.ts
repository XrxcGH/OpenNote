// From strokes to symbols (A1-28). Handwritten math is a pile of strokes; a symbol is one stroke or several that
// belong together: the two bars of an equals sign, the crossbar of a plus, the dot over an i. Structural strokes
// (a root sign, an integral, a bracket, a fraction bar) stay alone, because other symbols sit inside or beside them.
import { boxOf, centerX, centerY, height, shapeOf, union, width } from './geometry';
import type { Box, Pt, Shape } from './geometry';

export interface MathStroke {
  key: string;
  points: readonly Pt[];
}

export type Role = 'char' | 'bar' | 'radical' | 'integral' | 'open' | 'close' | 'openSquare' | 'closeSquare';

/** One symbol before it is read: its strokes, where it sits, and what its shape says. */
export interface Cluster {
  strokes: MathStroke[];
  box: Box;
  role: Role;
  /** Set when the symbol is known without reading, such as an equals sign. */
  text?: string;
}

const STRUCTURAL: ReadonlySet<Shape> = new Set(['radical', 'integral', 'open', 'close', 'openSquare', 'closeSquare']);

interface Item {
  stroke: MathStroke;
  box: Box;
  shape: Shape;
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

const overlapX = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
const overlapY = (a: Box, b: Box): number => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Whether two strokes cross or touch, within a small margin. */
function touches(a: Box, b: Box, margin: number): boolean {
  return a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 && a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1;
}

/** Groups the strokes of a piece of math into symbols. */
export function groupStrokes(strokes: readonly MathStroke[]): Cluster[] {
  const items: Item[] = strokes
    .filter((stroke) => stroke.points.length > 0)
    .map((stroke) => ({ stroke, box: boxOf(stroke.points), shape: shapeOf(stroke.points) }));
  const sizes = items.filter((item) => item.shape !== 'bar').map((item) => Math.max(width(item.box), height(item.box)));
  const unit = median(sizes) || median(items.map((item) => Math.max(width(item.box), height(item.box))));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i: number, j: number) => void (parent[find(i)] = find(j));

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const [a, b] = [items[i], items[j]];
      if (STRUCTURAL.has(a.shape) || STRUCTURAL.has(b.shape)) continue;
      const bars = a.shape === 'bar' && b.shape === 'bar';
      if (bars) {
        // An equals sign: two bars of about one length, one above the other, with nothing between them.
        const shared = overlapX(a.box, b.box);
        const narrow = Math.min(width(a.box), width(b.box));
        const gap = Math.max(a.box.y0, b.box.y0) - Math.min(a.box.y1, b.box.y1);
        const between: Box = {
          x0: Math.max(a.box.x0, b.box.x0),
          x1: Math.min(a.box.x1, b.box.x1),
          y0: Math.min(a.box.y1, b.box.y1),
          y1: Math.max(a.box.y0, b.box.y0),
        };
        const crowded = items.some(
          (other, k) =>
            k !== i &&
            k !== j &&
            overlapX(other.box, between) > 0 &&
            overlapY(other.box, { ...between, y0: between.y0 - unit * 0.1, y1: between.y1 + unit * 0.1 }) > 0,
        );
        if (
          shared >= 0.7 * narrow &&
          narrow >= 0.6 * Math.max(width(a.box), width(b.box)) &&
          gap < 0.9 * unit &&
          !crowded
        ) {
          join(i, j);
        }
        continue;
      }
      // A bar that another stroke crosses is part of that symbol, as in a plus. A long bar that nothing crosses is a
      // fraction bar or a minus, and stays alone.
      const crosses = (item: Item, other: Item) =>
        item.shape === 'bar' &&
        other.box.y0 < centerY(item.box) &&
        other.box.y1 > centerY(item.box) &&
        centerX(other.box) >= item.box.x0 &&
        centerX(other.box) <= item.box.x1;
      if (crosses(a, b) || crosses(b, a)) {
        join(i, j);
        continue;
      }
      const longBar = (item: Item, other: Item) =>
        item.shape === 'bar' && width(item.box) > 1.8 * Math.max(width(other.box), unit * 0.5);
      if (longBar(a, b) || longBar(b, a)) continue;
      // Strokes of one symbol cross or touch; symbols that merely stand close are separate, as an exponent is.
      const margin = 0.04 * unit;
      const tiny = (item: Item) => Math.max(width(item.box), height(item.box)) < 0.28 * unit;
      const dot = tiny(a) !== tiny(b);
      const near = dot
        ? overlapX(a.box, b.box) > 0 || Math.abs(centerX(a.box) - centerX(b.box)) < 0.5 * unit
        : touches(a.box, b.box, margin);
      const close = dot ? Math.abs(centerY(a.box) - centerY(b.box)) < 1.1 * unit : true;
      if (near && close) join(i, j);
    }
  }

  const byRoot = new Map<number, Item[]>();
  items.forEach((item, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), item]));
  const clusters: Cluster[] = [];
  for (const members of byRoot.values()) {
    const box = members.map((m) => m.box).reduce(union);
    const only = members.length === 1 ? members[0] : null;
    const parts = { strokes: members.map((m) => m.stroke), box };
    if (members.length === 2 && members.every((m) => m.shape === 'bar')) {
      clusters.push({ ...parts, role: 'char', text: '=' });
    } else if (only && only.shape === 'bar') {
      clusters.push({ ...parts, role: 'bar' });
    } else if (only && STRUCTURAL.has(only.shape)) {
      clusters.push({ ...parts, role: only.shape as Role });
    } else {
      clusters.push({ ...parts, role: 'char' });
    }
  }
  return clusters.sort((a, b) => a.box.x0 - b.box.x0 || a.box.y0 - b.box.y0);
}
