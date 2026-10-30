// Small engineering sketches for the kits as SVG text. It draws members, arrows (forces or flows), dimension lines
// with extension lines, hatched ground and walls, pins, rollers, and labels. Coordinates are SVG pixels (y down). Each
// helper returns one fragment that names its pens; diagramSvg swaps in the palette, so a sketch shows in the window
// in the theme's colors and on paper in fixed ones.
import type { Palette } from './palette';
import { paletteOf } from './palette';
import { el, px, svgDocument } from './svg';

export type Pen = 'ink' | 'muted' | 'accent' | 'force' | 'flow';

/** A fragment refers to pens by name; diagramSvg swaps in the palette's colors. */
const pen = (name: Pen): string => `{{${name}}}`;

const colorOf = (palette: Palette, name: Pen): string =>
  ({ ink: palette.text, muted: palette.muted, accent: palette.pens[0], force: palette.pens[1], flow: palette.pens[2] })[
    name
  ];

export interface LineOptions {
  pen?: Pen;
  width?: number;
  dashed?: boolean;
}

export function line(x1: number, y1: number, x2: number, y2: number, options: LineOptions = {}): string {
  const style = { stroke: pen(options.pen ?? 'ink'), 'stroke-width': options.width ?? 2, 'stroke-linecap': 'round' };
  return el('line', { x1, y1, x2, y2, ...style, 'stroke-dasharray': options.dashed ? '6 4' : undefined });
}

/** The three corners of an arrowhead at (x, y) pointing along the direction (dx, dy). */
export function arrowHead(x: number, y: number, dx: number, dy: number, size = 9): [number, number][] {
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const back = [x - ux * size, y - uy * size];
  const half = size * 0.45;
  return [
    [x, y],
    [back[0] - uy * half, back[1] + ux * half],
    [back[0] + uy * half, back[1] - ux * half],
  ];
}

const pointsText = (points: readonly (readonly [number, number])[]): string =>
  points.map(([x, y]) => `${px(x)},${px(y)}`).join(' ');

const head = (points: [number, number][], color: Pen): string =>
  el('polygon', { points: pointsText(points), fill: pen(color) });

export interface LabelOptions {
  pen?: Pen;
  anchor?: 'start' | 'middle' | 'end';
  size?: number;
}

export function label(x: number, y: number, text: string, options: LabelOptions = {}): string {
  const attrs = { x, y, dy: '0.35em', 'text-anchor': options.anchor ?? 'start', 'font-size': options.size ?? 12 };
  return el('text', { ...attrs, fill: pen(options.pen ?? 'ink') }, text);
}

/** An arrow from (x1, y1) to (x2, y2), with an optional label beside its middle. */
export function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: { pen?: Pen; label?: string; both?: boolean } = {},
): string {
  const color = options.pen ?? 'force';
  const parts = [line(x1, y1, x2, y2, { pen: color }), head(arrowHead(x2, y2, x2 - x1, y2 - y1), color)];
  if (options.both) parts.push(head(arrowHead(x1, y1, x1 - x2, y1 - y2), color));
  if (options.label) {
    // The label sits to the left of the direction of travel, clear of the line.
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ox = ((y2 - y1) / length) * 12;
    const oy = (-(x2 - x1) / length) * 12;
    parts.push(label((x1 + x2) / 2 + ox, (y1 + y2) / 2 + oy, options.label, { pen: color, anchor: 'middle' }));
  }
  return parts.join('');
}

/**
 * A dimension: extension lines from the two points, offset `offset` pixels to the left of the direction from the
 * first to the second, and a line with arrowheads at both ends carrying the text.
 */
export function dimension(x1: number, y1: number, x2: number, y2: number, text: string, offset = 18): string {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (y2 - y1) / length;
  const ny = -(x2 - x1) / length;
  const [ax, ay, bx, by] = [x1 + nx * offset, y1 + ny * offset, x2 + nx * offset, y2 + ny * offset];
  const gap = 3 * Math.sign(offset);
  const reach = offset + Math.sign(offset) * 4;
  const thin = { pen: 'muted', width: 1 } as const;
  return [
    line(x1 + nx * gap, y1 + ny * gap, x1 + nx * reach, y1 + ny * reach, thin),
    line(x2 + nx * gap, y2 + ny * gap, x2 + nx * reach, y2 + ny * reach, thin),
    line(ax, ay, bx, by, thin),
    head(arrowHead(ax, ay, ax - bx, ay - by, 7), 'muted'),
    head(arrowHead(bx, by, bx - ax, by - ay, 7), 'muted'),
    label((ax + bx) / 2 + nx * 10, (ay + by) / 2 + ny * 10, text, { pen: 'muted', anchor: 'middle', size: 11 }),
  ].join('');
}

/** Hatching for ground or a wall: a base line along one side of the box, and short slanted strokes beyond it. */
export function hatch(
  x: number,
  y: number,
  width: number,
  height: number,
  side: 'below' | 'above' | 'left' | 'right' = 'below',
): string {
  const parts: string[] = [];
  const step = 8;
  const base = { pen: 'muted', width: 1.5 } as const;
  const stroke = { pen: 'muted', width: 1 } as const;
  if (side === 'below' || side === 'above') {
    const at = side === 'below' ? y : y + height;
    const dir = side === 'below' ? 1 : -1;
    parts.push(line(x, at, x + width, at, base));
    for (let s = x + 4; s <= x + width; s += step) parts.push(line(s, at, s - 6, at + dir * 7, stroke));
  } else {
    const at = side === 'right' ? x : x + width;
    const dir = side === 'right' ? 1 : -1;
    parts.push(line(at, y, at, y + height, base));
    for (let s = y + 4; s <= y + height; s += step) parts.push(line(at, s, at + dir * 7, s - 6, stroke));
  }
  return parts.join('');
}

const outline = { fill: 'none', stroke: pen('ink'), 'stroke-width': 1.5 };

/** A pin support under (x, y): a triangle on hatched ground. */
export function pin(x: number, y: number, size = 14): string {
  const corners: [number, number][] = [
    [x, y],
    [x - size * 0.7, y + size],
    [x + size * 0.7, y + size],
  ];
  return el('polygon', { points: pointsText(corners), ...outline }) + hatch(x - size, y + size, size * 2, 0, 'below');
}

/** A roller support under (x, y): a triangle on two wheels on hatched ground. */
export function roller(x: number, y: number, size = 14): string {
  const top = y + size * 0.75;
  const corners: [number, number][] = [
    [x, y],
    [x - size * 0.7, top],
    [x + size * 0.7, top],
  ];
  const r = size * 0.12;
  const wheels = [-0.35, 0.35].map((k) => el('circle', { cx: x + k * size, cy: top + r, r, ...outline })).join('');
  return (
    el('polygon', { points: pointsText(corners), ...outline }) + wheels + hatch(x - size, top + 2 * r, size * 2, 0)
  );
}

export interface ShapeOptions {
  pen?: Pen;
  fill?: Pen;
  width?: number;
}

const shapeStyle = (options: ShapeOptions) => ({
  fill: options.fill ? pen(options.fill) : 'none',
  'fill-opacity': options.fill ? 0.15 : undefined,
  stroke: pen(options.pen ?? 'ink'),
  'stroke-width': options.width ?? 2,
});

export function rect(x: number, y: number, width: number, height: number, options: ShapeOptions = {}): string {
  return el('rect', { x, y, width, height, ...shapeStyle(options) });
}

export function circle(cx: number, cy: number, r: number, options: ShapeOptions = {}): string {
  return el('circle', { cx, cy, r, ...shapeStyle(options) });
}

export function polyline(
  points: readonly (readonly [number, number])[],
  options: { pen?: Pen; width?: number; closed?: boolean } = {},
): string {
  const style = { fill: 'none', stroke: pen(options.pen ?? 'ink'), 'stroke-width': options.width ?? 2 };
  return el(options.closed ? 'polygon' : 'polyline', {
    points: pointsText(points),
    ...style,
    'stroke-linejoin': 'round',
  });
}

/** The sketch as a standalone SVG document. */
export function diagramSvg(
  parts: readonly string[],
  options: { width: number; height: number; title: string; palette?: 'screen' | 'paper' },
): string {
  const name = options.palette ?? 'paper';
  const palette = paletteOf(name);
  const body = parts
    .join('')
    .replace(/\{\{(ink|muted|accent|force|flow)\}\}/g, (_m, one: Pen) => colorOf(palette, one));
  const background =
    name === 'paper' ? el('rect', { width: options.width, height: options.height, fill: palette.page }) : '';
  return svgDocument(options.width, options.height, options.title, background + body);
}
