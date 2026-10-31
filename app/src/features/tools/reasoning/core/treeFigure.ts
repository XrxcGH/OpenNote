// Tree pictures: parse trees, search trees, game and decision trees, branch-and-bound and DPLL trees, and argument
// maps. Leaves take one slot each from left to right, each parent sits over its children, and depth runs downward.
import { el, label, round, svgRoot, textWidth } from './svg';
import type { SvgNode, Tone } from './svg';
import { softOf } from './graphFigure';

export interface TreeNode {
  label: string;
  children: readonly TreeNode[];
  /** A second line under the label, such as a value or a bound. */
  note?: string;
  /** Text on the edge from the parent. */
  edge?: string;
  tone?: Tone;
  /** A square, as for a decision node, or a box; a circle otherwise. */
  shape?: 'circle' | 'box' | 'square';
  /** A struck-out edge, as for a pruned branch. */
  cut?: boolean;
}

interface Placed {
  node: TreeNode;
  x: number;
  depth: number;
  width: number;
  kids: Placed[];
}

const ROW = 70;

function place(node: TreeNode, depth: number, next: { x: number }): Placed {
  const width = Math.max(30, textWidth(node.label) + 14, node.note ? textWidth(node.note, 11) + 8 : 0);
  if (node.children.length === 0) {
    const x = next.x + width / 2;
    next.x += width + 12;
    return { node, x, depth, width, kids: [] };
  }
  const kids = node.children.map((child) => place(child, depth + 1, next));
  const x = (kids[0].x + kids[kids.length - 1].x) / 2;
  return { node, x, depth, width, kids };
}

function walk(p: Placed, out: Placed[] = []): Placed[] {
  out.push(p);
  for (const k of p.kids) walk(k, out);
  return out;
}

function shapeOf(p: Placed): SvgNode[] {
  const y = 30 + p.depth * ROW;
  const tone = p.node.tone;
  const fill = tone ? `@${softOf(tone)}` : '@paper';
  const stroke = tone ? `@${tone}` : '@ink';
  const parts: SvgNode[] = [];
  if ((p.node.shape ?? 'box') === 'circle')
    parts.push(el('ellipse', { cx: round(p.x), cy: y, rx: round(p.width / 2), ry: 14, fill, stroke }));
  else
    parts.push(
      el('rect', {
        x: round(p.x - p.width / 2),
        y: y - 14,
        width: round(p.width),
        height: 28,
        rx: p.node.shape === 'square' ? 0 : 6,
        fill,
        stroke,
      }),
    );
  parts.push(label(p.x, y, p.node.label));
  if (p.node.note) parts.push(label(p.x, y + 23, p.node.note, { fontSize: 11, fill: '@muted' }));
  return parts;
}

function edgeOf(parent: Placed, child: Placed): SvgNode[] {
  const y1 = 30 + parent.depth * ROW + 14 + (parent.node.note ? 16 : 0);
  const y2 = 30 + child.depth * ROW - 14;
  const parts: SvgNode[] = [
    el('line', {
      x1: round(parent.x),
      y1,
      x2: round(child.x),
      y2,
      stroke: child.node.cut ? '@muted' : '@ink',
      strokeDasharray: child.node.cut ? '4 3' : undefined,
    }),
  ];
  if (child.node.edge) {
    const mx = (parent.x + child.x) / 2;
    const my = (y1 + y2) / 2;
    const w = textWidth(child.node.edge, 11) + 6;
    parts.push(
      el('rect', { x: round(mx - w / 2), y: round(my - 8), width: round(w), height: 16, rx: 3, fill: '@paper' }),
      label(mx, my, child.node.edge, { fontSize: 11 }),
    );
  }
  return parts;
}

/** A picture of the tree rooted at `root`. */
export function treeFigure(root: TreeNode): SvgNode {
  const next = { x: 10 };
  const top = place(root, 0, next);
  const all = walk(top);
  const depth = Math.max(...all.map((p) => p.depth));
  const lines = all.flatMap((p) => p.kids.flatMap((k) => edgeOf(p, k)));
  return svgRoot(
    Math.max(80, next.x),
    60 + depth * ROW + 30,
    el('g', {}, ...lines),
    el('g', {}, ...all.flatMap(shapeOf)),
  );
}

/** The tree as indented text, for screen readers and for notes. */
export function treeText(root: TreeNode, depth = 0): string {
  const self = `${'  '.repeat(depth)}${root.edge ? `${root.edge}: ` : ''}${root.label}${root.note ? ` (${root.note})` : ''}`;
  return [self, ...root.children.map((c) => treeText(c, depth + 1))].join('\n');
}
