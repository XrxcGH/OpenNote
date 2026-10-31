// Hasse diagrams: nodes in rows by rank (the bottom row first), with a line for each covering pair. Used for
// subgroup lattices and other partial orders.
import { el, label, round, svgRoot, textWidth } from './svg';
import type { SvgNode, Tone } from './svg';

export interface HasseNode {
  label: string;
  rank: number;
  tone?: Tone;
}

export function hasseFigure(nodes: readonly HasseNode[], edges: readonly (readonly [number, number])[]): SvgNode {
  const ranks = [...new Set(nodes.map((n) => n.rank))].sort((a, b) => a - b);
  const rows = ranks.map((r) => nodes.flatMap((n, i) => (n.rank === r ? [i] : [])));
  const boxW = Math.max(28, ...nodes.map((n) => textWidth(n.label, 11) + 12));
  const gap = 12;
  const width = Math.max(...rows.map((r) => r.length)) * (boxW + gap) + gap;
  const rowH = 64;
  const height = rows.length * rowH + 10;
  const at = new Map<number, [number, number]>();
  rows.forEach((row, k) => {
    const y = height - 26 - k * rowH;
    const span = row.length * (boxW + gap) - gap;
    row.forEach((i, j) => at.set(i, [(width - span) / 2 + j * (boxW + gap) + boxW / 2, y]));
  });
  const lines = edges.map(([a, b]) => {
    const [x1, y1] = at.get(a)!;
    const [x2, y2] = at.get(b)!;
    return el('line', { x1: round(x1), y1: round(y1 - 11), x2: round(x2), y2: round(y2 + 11), stroke: '@muted' });
  });
  const boxes = nodes.map((n, i) => {
    const [x, y] = at.get(i)!;
    return el(
      'g',
      {},
      el('rect', {
        x: round(x - boxW / 2),
        y: round(y - 11),
        width: round(boxW),
        height: 22,
        rx: 4,
        fill: n.tone === 'accent' ? '@accentSoft' : '@paper',
        stroke: n.tone ? `@${n.tone}` : '@line',
      }),
      label(x, y, n.label, { fontSize: 11 }),
    );
  });
  return svgRoot(width, height, ...lines, ...boxes);
}
