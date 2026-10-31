// Pictures for the linguistics tool: a syntax tree laid out by the shared tidy-tree layout, a dependency tree with
// labeled arcs over the words, and a vowel chart with F2 running right to left and F1 top to bottom, as is usual.
import { layoutTree } from '../../subjects/layout/tree';
import type { TreeInput } from '../../subjects/layout/tree';
import { PAPER, SERIES, r2, svgDocument, svgText, textWidth } from '../svg';
import type { Dependency, SyntaxNode } from './trees';
import type { Normalized } from './vowels';

const SIZE = 13;
const BOX_H = 20;
const PAD = 16;

export function syntaxSvg(root: SyntaxNode, title: string): string {
  const triangles = new Set<string>();
  const words = new Set<string>();
  let next = 0;
  const convert = (n: SyntaxNode): TreeInput => {
    const id = `n${next++}`;
    if (n.leaf) words.add(id);
    const width = textWidth(n.label, SIZE) + 10;
    if (n.triangle) {
      const label = n.children.map((c) => c.label).join(' ');
      const leaf = `n${next++}`;
      triangles.add(leaf);
      words.add(leaf);
      return {
        id,
        label: n.label,
        width,
        height: BOX_H,
        children: [{ id: leaf, label, width: textWidth(label, SIZE) + 10, height: BOX_H }],
      };
    }
    return { id, label: n.label, width, height: BOX_H, children: n.children.map(convert) };
  };
  const layout = layoutTree(convert(root), { gap: 14, levelGap: 46 });
  const { minX, minY, maxX, maxY } = layout.bounds;
  const dx = PAD - minX;
  const dy = PAD - minY;
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const lines = layout.nodes
    .filter((n) => n.parent !== null)
    .map((n) => {
      const p = byId.get(n.parent as string);
      if (!p) return '';
      const px = p.x + dx;
      const py = p.y + dy + BOX_H / 2;
      const cy = n.y + dy - BOX_H / 2;
      if (triangles.has(n.id)) {
        const half = n.width / 2 - 2;
        const cx = n.x + dx;
        return `<path d="M${r2(px)} ${r2(py)} L${r2(cx - half)} ${r2(cy)} H${r2(cx + half)} Z" fill="none" stroke="${PAPER.line}"/>`;
      }
      return `<line x1="${r2(px)}" y1="${r2(py)}" x2="${r2(n.x + dx)}" y2="${r2(cy)}" stroke="${PAPER.line}"/>`;
    })
    .join('');
  const labels = layout.nodes
    .map((n) => {
      const extra = words.has(n.id)
        ? ' text-anchor="middle" font-style="italic"'
        : ' text-anchor="middle" font-weight="600"';
      return svgText(n.x + dx, n.y + dy + 4, n.label, SIZE, extra);
    })
    .join('');
  return svgDocument(maxX - minX + 2 * PAD, maxY - minY + 2 * PAD, lines + labels, title);
}

export function dependencySvg(deps: readonly Dependency[], title: string): string {
  const widths = deps.map((d) => Math.max(textWidth(d.word, SIZE), 30) + 18);
  const xs: number[] = [];
  let x = PAD;
  for (const w of widths) {
    xs.push(x + w / 2);
    x += w;
  }
  const maxSpan = Math.max(1, ...deps.map((d) => (d.head === 0 ? 1 : Math.abs(d.head - d.index))));
  const top = 30 + maxSpan * 22;
  const base = top + 10;
  const arcs = deps
    .map((d) => {
      const to = xs[d.index - 1];
      if (d.head === 0) {
        return (
          `<path d="M${r2(to)} 14 V${r2(base - 14)}" stroke="${PAPER.accent}" fill="none" marker-end="url(#arrow)"/>` +
          svgText(to + 4, 24, d.relation || 'root', 11, ` fill="${PAPER.muted}"`)
        );
      }
      const from = xs[d.head - 1];
      const height = 22 * Math.abs(d.head - d.index) + 10;
      const y = base - 14;
      const mid = (from + to) / 2;
      return (
        `<path d="M${r2(from)} ${r2(y)} C${r2(from)} ${r2(y - height)} ${r2(to)} ${r2(y - height)} ${r2(to)} ${r2(y)}"` +
        ` fill="none" stroke="${PAPER.accent}" marker-end="url(#arrow)"/>` +
        svgText(mid, y - height * 0.75 - 3, d.relation, 11, ` text-anchor="middle" fill="${PAPER.muted}"`)
      );
    })
    .join('');
  const marker =
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">` +
    `<path d="M0 0 L10 5 L0 10 z" fill="${PAPER.accent}"/></marker></defs>`;
  const wordsSvg = deps.map((d, i) => svgText(xs[i], base + 8, d.word, SIZE, ' text-anchor="middle"')).join('');
  const numbers = deps
    .map((d, i) => svgText(xs[i], base + 24, String(d.index), 10, ` text-anchor="middle" fill="${PAPER.muted}"`))
    .join('');
  return svgDocument(x + PAD, base + 36, marker + arcs + wordsSvg + numbers, title);
}

export function vowelSvg(
  points: readonly Normalized[],
  means: readonly { vowel: string; x: number; y: number }[],
  labels: { title: string; f1: string; f2: string },
): string {
  const width = 380;
  const height = 300;
  const pad = 44;
  const xsAll = points.map((p) => p.x);
  const ysAll = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xsAll), Math.max(...xsAll)];
  const [y0, y1] = [Math.min(...ysAll), Math.max(...ysAll)];
  const spanX = x1 - x0 || 1;
  const spanY = y1 - y0 || 1;
  // F2 grows to the left and F1 grows downward, so front high vowels sit at the top left.
  const sx = (v: number) => width - pad - ((v - x0) / spanX) * (width - 2 * pad);
  const sy = (v: number) => pad + ((v - y0) / spanY) * (height - 2 * pad);
  const speakers = [...new Set(points.map((p) => p.speaker))];
  const dots = points
    .map((p) => {
      const color = SERIES[speakers.indexOf(p.speaker) % SERIES.length];
      return `<circle cx="${r2(sx(p.x))}" cy="${r2(sy(p.y))}" r="3" fill="${color}" fill-opacity="0.6"/>`;
    })
    .join('');
  const names = means
    .map((m) => svgText(sx(m.x), sy(m.y) - 7, m.vowel, 15, ' text-anchor="middle" font-weight="600"'))
    .join('');
  const frame =
    `<rect x="${pad}" y="${pad}" width="${width - 2 * pad}" height="${height - 2 * pad}" fill="none" stroke="${PAPER.grid}"/>` +
    svgText(width / 2, height - 12, labels.f2, 11, ' text-anchor="middle"') +
    svgText(12, height / 2, labels.f1, 11, ` transform="rotate(-90 12 ${height / 2})" text-anchor="middle"`) +
    svgText(pad, pad - 8, `${r2(x1)}`, 10, ` fill="${PAPER.muted}"`) +
    svgText(width - pad, pad - 8, `${r2(x0)}`, 10, ` text-anchor="end" fill="${PAPER.muted}"`) +
    svgText(width - pad + 4, pad + 4, `${r2(y0)}`, 10, ` fill="${PAPER.muted}"`) +
    svgText(width - pad + 4, height - pad, `${r2(y1)}`, 10, ` fill="${PAPER.muted}"`);
  return svgDocument(width, height, frame + dots + names, labels.title);
}
