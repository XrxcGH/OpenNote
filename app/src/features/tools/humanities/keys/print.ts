// A dichotomous key as numbered couplet lines (1a, 1b, ...) and as a tree picture. The words for a lead come from
// the tool, so this module has no strings of its own.
import { layoutTree } from '../../subjects/layout/tree';
import type { TreeInput } from '../../subjects/layout/tree';
import { PAPER, escapeXml, r2, svgDocument, textWidth, FONT } from '../svg';
import type { Couplet, KeyNode, Lead, Matrix } from './engine';

export type DescribeLead = (character: string, lead: Lead) => string;

/** What a lead leads to: the next couplet's number, or the taxa at its end joined by "or". */
export function destination(node: KeyNode, matrix: Matrix, or: string): string {
  if (node.kind === 'couplet') return String(node.number);
  return node.taxa.map((taxon) => matrix.taxa[taxon]!).join(` ${or} `);
}

/** One line for each lead, in printed order: "1a. Wings: present . . . 2". */
export function keyLines(list: readonly Couplet[], matrix: Matrix, describe: DescribeLead, or: string): string[] {
  const lines: string[] = [];
  for (const couplet of list) {
    const name = matrix.characters[couplet.split.character]!.name;
    couplet.split.leads.forEach((lead, side) => {
      const mark = side === 0 ? 'a' : 'b';
      lines.push(
        `${couplet.number}${mark}. ${describe(name, lead)} . . . ${destination(couplet.next[side]!, matrix, or)}`,
      );
    });
  }
  return lines;
}

const SIZE = 12;

/** The key drawn as a tree: each couplet a box with its number and character, each end a box with its taxa. */
export function keySvg(root: KeyNode, matrix: Matrix, title: string, or: string): string {
  let id = 0;
  const label = (node: KeyNode) =>
    node.kind === 'couplet'
      ? `${node.number}. ${matrix.characters[node.split.character]!.name}`
      : node.taxa.map((taxon) => matrix.taxa[taxon]!).join(` ${or} `);
  const toInput = (node: KeyNode): TreeInput => {
    const text = label(node);
    return {
      id: `n${id++}`,
      label: text,
      width: textWidth(text, SIZE) + 16,
      height: 24,
      children: node.kind === 'couplet' ? node.next.map(toInput) : undefined,
    };
  };
  const layout = layoutTree(toInput(root), { gap: 12, levelGap: 56, edges: 'straight' });
  const pad = 16;
  const dx = pad - layout.bounds.minX;
  const dy = pad - layout.bounds.minY;
  const width = layout.bounds.maxX - layout.bounds.minX + pad * 2;
  const height = layout.bounds.maxY - layout.bounds.minY + pad * 2;
  const lines = layout.edges
    .map((edge) => {
      const points = edge.points.map(([x, y]) => `${r2(x + dx)},${r2(y + dy)}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${PAPER.line}" stroke-width="1.2"/>`;
    })
    .join('');
  const boxes = layout.nodes
    .map((node) => {
      const leaf = !layout.edges.some((edge) => edge.from === node.id);
      const x = node.x + dx - node.width / 2;
      const y = node.y + dy - node.height / 2;
      return (
        `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(node.width)}" height="${r2(node.height)}" rx="4" ` +
        `fill="${leaf ? PAPER.accentSoft : PAPER.background}" stroke="${leaf ? PAPER.accent : PAPER.line}"/>` +
        `<text x="${r2(node.x + dx)}" y="${r2(node.y + dy + 4)}" text-anchor="middle" font-family="${FONT}" ` +
        `font-size="${SIZE}" fill="${PAPER.text}">${escapeXml(node.label)}</text>`
      );
    })
    .join('');
  return svgDocument(width, height, lines + boxes, title);
}
