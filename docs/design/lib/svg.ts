// A tiny SVG builder for the OpenNote wireframes. Interface colors come from brand/tokens.json,
// so the drawings change when the tokens do. Annotation colors are deliberately outside the brand.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textWidth } from './metrics.ts';

export type ThemeName = 'light' | 'dark';

interface Pen {
  name: string;
  light: string;
  dark: string;
}

interface Tokens {
  color: Record<ThemeName, Record<string, Record<string, string>>>;
  ink: { pens: Pen[]; highlighters: Pen[] };
}

const TOKENS_PATH = join(import.meta.dirname, '..', '..', '..', 'brand', 'tokens.json');
const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as Tokens;

/** Annotation colors: magenta for keep-out zones, violet for layout regions. Never used in the app. */
export const NOTE = { keepOut: '#C2185B', region: '#6A3FB5', paper: '#FFFFFF' };

export interface Palette {
  theme: ThemeName;
  c(path: string): string;
  pen(name: string): string;
  highlighter(name: string): string;
}

export function palette(theme: ThemeName): Palette {
  const colors = tokens.color[theme];
  const find = (list: Pen[], name: string) => {
    const pen = list.find((p) => p.name === name);
    if (!pen) throw new Error(`Unknown pen "${name}"`);
    return pen[theme];
  };
  return {
    theme,
    c(path) {
      const [group, key] = path.split('.');
      const value = colors[group]?.[key];
      if (!value) throw new Error(`Unknown color token "${path}"`);
      return value;
    },
    pen: (name) => find(tokens.ink.pens, name),
    highlighter: (name) => find(tokens.ink.highlighters, name),
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RectStyle {
  fill?: string;
  stroke?: string;
  r?: number;
  dash?: string;
  width?: number;
  shadow?: boolean;
  opacity?: number;
}

export function rect(b: Box, s: RectStyle = {}): string {
  const attrs = [
    `x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"`,
    `rx="${s.r ?? 0}"`,
    `fill="${s.fill ?? 'none'}"`,
    s.stroke ? `stroke="${s.stroke}" stroke-width="${s.width ?? 1}"` : '',
    s.dash ? `stroke-dasharray="${s.dash}"` : '',
    s.shadow ? 'filter="url(#shadow)"' : '',
    s.opacity !== undefined ? `fill-opacity="${s.opacity}"` : '',
  ];
  return `<rect ${attrs.filter(Boolean).join(' ')}/>`;
}

export interface TextStyle {
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  font?: 'ui' | 'reading' | 'mono';
  italic?: boolean;
}

const FONTS = {
  ui: `'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif`,
  reading: `Literata, Cambria, Georgia, serif`,
  mono: `'Atkinson Hyperlegible Mono', 'Cascadia Code', Consolas, monospace`,
};

export function text(x: number, y: number, content: string, s: TextStyle = {}): string {
  return `<text ${textAttrs(x, y, s)}>${escapeXml(content)}</text>`;
}

/** A run of words inside a line of text, in its own color, weight or slant. */
export interface Run {
  text: string;
  fill?: string;
  weight?: number;
  italic?: boolean;
}

/**
 * One line of text made of runs in different styles. The browser sets each run right after the one before, so a
 * link, a bold word, or an equation sits one space from the words around it whatever font the viewer has.
 */
export function textRuns(x: number, y: number, runs: (string | Run)[], s: TextStyle = {}): string {
  const inner = runs.map((run) => {
    if (typeof run === 'string') return escapeXml(run);
    const attrs = [
      run.fill ? `fill="${run.fill}"` : '',
      run.weight ? `font-weight="${run.weight}"` : '',
      run.italic ? 'font-style="italic"' : '',
    ];
    return `<tspan ${attrs.filter(Boolean).join(' ')}>${escapeXml(run.text)}</tspan>`;
  });
  return `<text ${textAttrs(x, y, s)}>${inner.join('')}</text>`;
}

function textAttrs(x: number, y: number, s: TextStyle): string {
  const attrs = [
    `x="${x}" y="${y}"`,
    `font-size="${s.size ?? 13}"`,
    `font-weight="${s.weight ?? 400}"`,
    `fill="${s.fill ?? '#000'}"`,
    `text-anchor="${s.anchor ?? 'start'}"`,
    `font-family="${FONTS[s.font ?? 'ui']}"`,
    s.italic ? 'font-style="italic"' : '',
  ];
  return attrs.filter(Boolean).join(' ');
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function line(from: [number, number], to: [number, number], stroke: string, dash?: string): string {
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="${stroke}"${dashAttr}/>`;
}

/** A hand-drawn ink stroke. A `part` name lets the geometry tests find it. */
export function ink(d: string, color: string, width = 3, part?: string): string {
  const style = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const name = part ? ` data-part="${part}"` : '';
  return `<path${name} d="${d}" ${style} stroke="${color}" stroke-width="${width}"/>`;
}

export type Point = [number, number];

const round = (n: number) => Math.round(n * 100) / 100;
const spot = ([x, y]: Point) => `${round(x)} ${round(y)}`;

/** The point at an angle (in degrees, clockwise from the right) on the edge of an ellipse. */
export function onEllipse(cx: number, cy: number, rx: number, ry: number, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
}

/** How far each stroke of an arrowhead leans away from the line it ends. */
export const HEAD_SPREAD = (28 * Math.PI) / 180;

/** The two short strokes of an arrowhead, as the points where they end: a tip's strokes lean back from its path. */
export function barbs(c2: Point, tip: Point, length = 11): [Point, Point] {
  const heading = Math.atan2(tip[1] - c2[1], tip[0] - c2[0]);
  const lean = (side: number, size: number): Point => [
    tip[0] - size * Math.cos(heading + side * HEAD_SPREAD),
    tip[1] - size * Math.sin(heading + side * HEAD_SPREAD),
  ];
  return [lean(1, length), lean(-1, length - 1)];
}

/** A straight ink arrow from `from` to `tip`, with a head. */
export function straightArrow(from: Point, tip: Point, color: string, width = 2.2): string {
  const at = (k: number): Point => [from[0] + (tip[0] - from[0]) * k, from[1] + (tip[1] - from[1]) * k];
  return arrow(from, at(1 / 3), at(2 / 3), tip, color, width);
}

/**
 * A hand-drawn ink arrow: a curved shaft from `from` to `tip`, bent by c1 and c2. Two short strokes start at the
 * tip and lean back along the shaft, in the same pen. The shaft ends at the tip, so the arrow's point is the end of
 * its line, and the head is always drawn the right way round.
 */
export function arrow(from: Point, c1: Point, c2: Point, tip: Point, color: string, width = 2.2): string {
  const [left, right] = barbs(c2, tip);
  const d = `M${spot(from)}C${spot(c1)} ${spot(c2)} ${spot(tip)}M${spot(tip)}L${spot(left)}M${spot(tip)}L${spot(right)}`;
  return ink(d, color, width, 'arrow');
}

export function circle(cx: number, cy: number, r: number, fill: string, stroke?: string): string {
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="2"` : '';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${strokeAttr}/>`;
}

/** Gray bars that stand in for lines of text. */
export function textLines(x: number, y: number, widths: number[], color: string, gap = 16): string {
  return widths.map((w, i) => rect({ x, y: y + i * gap, w, h: 7 }, { fill: color, r: 3.5 })).join('');
}

/** A hatched area where nothing interactive may be placed. */
export function keepOut(b: Box, label: string, labelAt?: [number, number]): string {
  const [x, y] = labelAt ?? [b.x + 4, b.h >= 24 ? b.y + b.h / 2 + 4 : b.y + b.h + 13];
  const area = `<g pointer-events="none">${rect(b, { fill: 'url(#hatch)', stroke: NOTE.keepOut, dash: '4 3' })}</g>`;
  return label ? area + tag(x, y, label, NOTE.keepOut) : area;
}

/** The window buttons at the top right of every desktop screen. */
export function captionKeepOut(width: number): string {
  return keepOut({ x: width - 138, y: 0, w: 138, h: 40 }, 'Window buttons 138×40', [width - 176, 58]);
}

/** A dashed outline naming a layout region and its size. */
export function region(b: Box, label: string): string {
  const outline = `<g pointer-events="none">${rect(b, { stroke: NOTE.region, dash: '6 4', width: 1.5 })}</g>`;
  return label ? outline + tag(b.x + 6, b.y + 16, label, NOTE.region) : outline;
}

/** A small annotation label on a white pill, readable over any background. */
export function tag(x: number, y: number, label: string, color: string): string {
  // The pill is 6 px wider than its words at each end.
  const width = Math.ceil(textWidth(label, 11, 600) + 12);
  return [
    '<g data-fit="4" pointer-events="none">',
    rect({ x, y: y - 12, w: width, h: 17 }, { fill: NOTE.paper, stroke: color, r: 8.5 }),
    text(x + 6, y, label, { size: 11, weight: 600, fill: color }),
    '</g>',
  ].join('');
}

export interface DocumentSpec {
  title: string;
  width: number;
  height: number;
  background: string;
  body: string[];
}

/** Wraps drawing parts in a complete SVG document with a legend strip at the bottom. */
export function svgDocument(spec: DocumentSpec): string {
  const total = spec.height + 44;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${total}" width="${spec.width}" height="${total}" role="img">`,
    `<title>${escapeXml(spec.title)}</title>`,
    DEFS,
    rect({ x: 0, y: 0, w: spec.width, h: spec.height }, { fill: spec.background }),
    ...spec.body,
    legend(spec.height, spec.width),
    '</svg>',
    '',
  ].join('\n');
}

const DEFS = [
  '<defs>',
  `<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`,
  `<rect width="8" height="8" fill="${NOTE.keepOut}" fill-opacity="0.08"/>`,
  `<line x1="0" y1="0" x2="0" y2="8" stroke="${NOTE.keepOut}" stroke-opacity="0.45" stroke-width="2"/></pattern>`,
  '<filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">',
  '<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#2B2521" flood-opacity="0.16"/></filter>',
  '</defs>',
].join('\n');

function legend(y: number, width: number): string {
  return [
    rect({ x: 0, y, w: width, h: 44 }, { fill: NOTE.paper }),
    line([0, y], [width, y], '#D9D9D9'),
    rect({ x: 16, y: y + 14, w: 28, h: 16 }, { fill: 'url(#hatch)', stroke: NOTE.keepOut, dash: '4 3' }),
    text(52, y + 27, 'Keep-out zone: nothing interactive or important goes here', { size: 12, fill: '#333' }),
    rect({ x: 470, y: y + 14, w: 28, h: 16 }, { stroke: NOTE.region, dash: '6 4', width: 1.5 }),
    text(506, y + 27, 'Layout region with its size in pixels (at 100% scaling)', { size: 12, fill: '#333' }),
    text(width - 16, y + 27, 'OpenNote wireframe · colors from brand/tokens.json', {
      size: 12,
      fill: '#666',
      anchor: 'end',
    }),
  ].join('');
}
