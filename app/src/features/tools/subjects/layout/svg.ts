// A drawing of a laid-out tree or graph as SVG text, for the page (through insertFigure) and for the tool's own
// preview. The SVG is self-contained: the light theme's colors on the page color, since a stored figure is shown as
// an image and cannot follow the app's theme. Labels are escaped, so no input text can become markup.
import { tokens } from '../../../../theme/tokens';

export interface DrawNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawEdge {
  points: readonly (readonly [number, number])[];
  label?: string;
}

export interface Drawing {
  nodes: readonly DrawNode[];
  edges: readonly DrawEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface SvgStyle {
  /** Pixels per layout unit. */
  scale?: number;
  fontSize?: number;
  shape?: 'rect' | 'round' | 'ellipse' | 'none';
  arrows?: boolean;
  padding?: number;
  /** The accessible name of the picture. */
  title?: string;
}

const light = tokens.color.light;
export const FIGURE_COLORS = {
  line: light.text.secondary,
  fill: light.surface.page,
  text: light.text.primary,
  background: light.surface.page,
} as const;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text safe inside SVG elements and attributes. */
export const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** One SVG element; numbers are rounded to 0.01 and every attribute value is escaped. */
export function el(tag: string, attrs: Record<string, string | number>, content?: string): string {
  const list = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? fmt(v) : escapeXml(v)}"`)
    .join('');
  return content === undefined ? `<${tag}${list}/>` : `<${tag}${list}>${content}</${tag}>`;
}

/** An estimate of a label's box (in pixels) for a font size, so engines can size nodes without measuring text. */
export function labelSize(label: string, fontSize = 14, pad = 6): { width: number; height: number } {
  const lines = label.split('\n');
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  return { width: longest * fontSize * 0.6 + 2 * pad, height: lines.length * fontSize * 1.25 + 2 * pad };
}

type At = (x: number, y: number) => [number, number];
type Style = Required<SvgStyle>;
const PAINT = { fill: FIGURE_COLORS.fill, stroke: FIGURE_COLORS.line, 'stroke-width': 1.2 };

function shapeOf(node: DrawNode, at: At, style: Style): string {
  const [cx, cy] = at(node.x, node.y);
  const w = node.width * style.scale;
  const h = node.height * style.scale;
  if (style.shape === 'none') return '';
  if (style.shape === 'ellipse') return el('ellipse', { cx, cy, rx: w / 2, ry: h / 2, ...PAINT });
  const rx = style.shape === 'round' ? Math.min(w, h) / 4 : 0;
  return el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx, ...PAINT });
}

function textOf(node: DrawNode, at: At, style: Style): string {
  const [cx, cy] = at(node.x, node.y);
  const lines = node.label.split('\n');
  const lineHeight = style.fontSize * 1.25;
  const top = cy - ((lines.length - 1) * lineHeight) / 2;
  const attrs = { 'font-size': style.fontSize, 'text-anchor': 'middle', 'dominant-baseline': 'central' };
  return lines
    .map((line, i) =>
      el('text', { x: cx, y: top + i * lineHeight, ...attrs, fill: FIGURE_COLORS.text }, escapeXml(line)),
    )
    .join('');
}

function edgeOf(edge: DrawEdge, at: At, style: Style): string {
  const pts = edge.points.map(([x, y]) => at(x, y));
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`).join(' ');
  const marker: Record<string, string> = style.arrows ? { 'marker-end': 'url(#arrow)' } : {};
  const path = el('path', { d, fill: 'none', stroke: FIGURE_COLORS.line, 'stroke-width': 1.2, ...marker });
  if (!edge.label || pts.length < 2) return path;
  const mid = Math.floor((pts.length - 1) / 2);
  const x = (pts[mid][0] + pts[mid + 1][0]) / 2;
  const y = (pts[mid][1] + pts[mid + 1][1]) / 2 - 4;
  const attrs = { x, y, 'font-size': style.fontSize * 0.85, 'text-anchor': 'middle', fill: FIGURE_COLORS.text };
  return path + el('text', attrs, escapeXml(edge.label));
}

function arrowDefs(): string {
  const head = el('path', { d: 'M0 0L10 5L0 10z', fill: FIGURE_COLORS.line });
  const marker = { id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 7, markerHeight: 7 };
  return el('defs', {}, el('marker', { ...marker, orient: 'auto-start-reverse' }, head));
}

/** The drawing as a standalone SVG document string. Edges are drawn under the nodes. */
export function drawingToSvg(drawing: Drawing, options: SvgStyle = {}): string {
  const style: Style = {
    scale: options.scale ?? 40,
    fontSize: options.fontSize ?? 14,
    shape: options.shape ?? 'round',
    arrows: options.arrows ?? false,
    padding: options.padding ?? 12,
    title: options.title ?? '',
  };
  const { minX, minY, maxX, maxY } = drawing.bounds;
  const width = (maxX - minX) * style.scale + 2 * style.padding;
  const height = (maxY - minY) * style.scale + 2 * style.padding;
  const at: At = (x, y) => [(x - minX) * style.scale + style.padding, (y - minY) * style.scale + style.padding];
  const body = [
    style.title ? el('title', {}, escapeXml(style.title)) : '',
    style.arrows ? arrowDefs() : '',
    el('rect', { width: '100%', height: '100%', fill: FIGURE_COLORS.background }),
    ...drawing.edges.map((e) => edgeOf(e, at, style)),
    ...drawing.nodes.map((n) => shapeOf(n, at, style) + textOf(n, at, style)),
  ].join('');
  const root = { xmlns: 'http://www.w3.org/2000/svg', width, height, viewBox: `0 0 ${fmt(width)} ${fmt(height)}` };
  return el('svg', { ...root, role: 'img', 'font-family': tokens.font.ui }, body);
}
