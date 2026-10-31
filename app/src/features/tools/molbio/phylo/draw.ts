// Tree pictures: a rectangular phylogram (branch lengths to scale, with a scale bar), a cladogram (tips aligned),
// and a radial tree. Support values sit beside their nodes.
import type { Figure, Shape } from '../figure';
import { fmt } from '../shared';
import { hasLengths, isLeaf, leaves } from './tree';
import type { TreeNode } from './tree';

export type Style = 'phylogram' | 'cladogram' | 'radial';

interface Placed {
  node: TreeNode;
  /** Distance from the root (phylogram) or depth (cladogram). */
  x: number;
  /** Leaf order, fractional for internal nodes. */
  y: number;
  children: Placed[];
}

function place(root: TreeNode, scaled: boolean): Placed {
  let next = 0;
  const depth = (n: TreeNode): number => (isLeaf(n) ? 0 : 1 + Math.max(...n.children.map(depth)));
  const total = depth(root);
  const visit = (n: TreeNode, x: number, level: number): Placed => {
    if (isLeaf(n)) return { node: n, x: scaled ? x : total, y: next++, children: [] };
    const children = n.children.map((c) => visit(c, x + (scaled ? (c.length ?? 0) : 1), level + 1));
    const y = (children[0]!.y + children.at(-1)!.y) / 2;
    return { node: n, x: scaled ? x : level, y, children };
  };
  return visit(root, 0, 0);
}

const all = (p: Placed): Placed[] => [p, ...p.children.flatMap(all)];

/** A round length for the scale bar, about a fifth of the tree's depth. */
function scaleLength(depth: number): number {
  const raw = depth / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5].find((m) => m * power >= raw) ?? 10) * power;
}

export function treeFigure(root: TreeNode, style: Style): Figure {
  const scaled = style !== 'cladogram' && hasLengths(root);
  return style === 'radial' ? radial(root, scaled) : rectangular(root, scaled);
}

function rectangular(root: TreeNode, scaled: boolean): Figure {
  const tips = leaves(root);
  const longest = Math.max(...tips.map((t) => t.length));
  const width = 560;
  const left = 20;
  const right = width - 16 - longest * 7.2;
  const rowH = 22;
  const placed = place(root, scaled);
  const maxX = Math.max(...all(placed).map((p) => p.x)) || 1;
  const sx = (x: number) => left + (x / maxX) * (right - left);
  const sy = (y: number) => 20 + y * rowH;
  const shapes: Shape[] = [];
  for (const p of all(placed)) {
    if (p.children.length > 0) {
      const ys = p.children.map((c) => sy(c.y));
      shapes.push({
        kind: 'line',
        x1: sx(p.x),
        y1: Math.min(...ys),
        x2: sx(p.x),
        y2: Math.max(...ys),
        stroke: 'ink',
        width: 1.5,
      });
      for (const c of p.children) {
        shapes.push({ kind: 'line', x1: sx(p.x), y1: sy(c.y), x2: sx(c.x), y2: sy(c.y), stroke: 'ink', width: 1.5 });
      }
      if (p.node.support !== undefined && p !== placed) {
        shapes.push({
          kind: 'text',
          x: sx(p.x) - 3,
          y: sy(p.y) - 4,
          label: fmt(p.node.support),
          size: 10,
          anchor: 'end',
          tone: 'accent',
        });
      }
    } else {
      shapes.push({ kind: 'text', x: sx(p.x) + 5, y: sy(p.y) + 4, label: p.node.name, size: 12 });
    }
  }
  let height = sy(tips.length - 1) + 20;
  if (scaled) {
    const bar = scaleLength(maxX);
    const w = (bar / maxX) * (right - left);
    shapes.push({ kind: 'line', x1: left, y1: height, x2: left + w, y2: height, stroke: 'ink', width: 2 });
    shapes.push({ kind: 'text', x: left + w + 6, y: height + 4, label: fmt(bar), size: 10, tone: 'muted' });
    height += 20;
  }
  return { width, height, shapes };
}

function radial(root: TreeNode, scaled: boolean): Figure {
  const tips = leaves(root);
  const size = 460;
  const c = size / 2;
  const placed = place(root, scaled);
  const maxX = Math.max(...all(placed).map((p) => p.x)) || 1;
  const reach = c - 70;
  const angle = (y: number) => (2 * Math.PI * y) / tips.length - Math.PI / 2;
  const at = (x: number, y: number): [number, number] => [
    c + (x / maxX) * reach * Math.cos(angle(y)),
    c + (x / maxX) * reach * Math.sin(angle(y)),
  ];
  const shapes: Shape[] = [];
  for (const p of all(placed)) {
    for (const ch of p.children) {
      const [x1, y1] = at(p.x, ch.y);
      const [x2, y2] = at(ch.x, ch.y);
      shapes.push({ kind: 'line', x1, y1, x2, y2, stroke: 'ink', width: 1.5 });
    }
    if (p.children.length > 1) {
      const a = p.children[0]!.y;
      const b = p.children.at(-1)!.y;
      const r = (p.x / maxX) * reach;
      if (r > 0) {
        const [x1, y1] = at(p.x, a);
        const [x2, y2] = at(p.x, b);
        const large = ((b - a) / tips.length) * 2 * Math.PI > Math.PI ? 1 : 0;
        shapes.push({ kind: 'path', d: `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`, stroke: 'ink', width: 1.5 });
      }
    }
    if (p.children.length === 0) {
      const [x, y] = at(p.x + maxX * 0.04, p.y);
      const cos = Math.cos(angle(p.y));
      shapes.push({ kind: 'text', x, y: y + 4, label: p.node.name, size: 11, anchor: cos >= 0 ? 'start' : 'end' });
    } else if (p.node.support !== undefined && p !== placed) {
      const [x, y] = at(p.x, p.y);
      shapes.push({ kind: 'text', x: x + 3, y: y - 3, label: fmt(p.node.support), size: 10, tone: 'accent' });
    }
  }
  return { width: size, height: size, shapes };
}
