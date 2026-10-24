// A small picture model shared by every drawing in the kit: gels, plasmid maps, plots, trees, pedigrees, and wheels.
// Engines build a Figure from shapes and words; FigureView draws it on theme colors, and figureSvg writes it as a
// standalone SVG for the page. Tones name a role, never a color, so both follow the theme and print in one ink.
import { escapeXml } from './shared';
import type { MolKey, Vars } from './shared';

/** ink: text color; muted: secondary; faint: rules and grids; accent: the one highlighted thing; paper: the page. */
export type Tone = 'ink' | 'muted' | 'faint' | 'accent' | 'paper' | 'none';

export interface Paint {
  stroke?: Tone;
  fill?: Tone;
  width?: number;
  dash?: string;
}

export type Label = string | { word: MolKey; vars?: Vars };

export type Shape =
  | ({ kind: 'line'; x1: number; y1: number; x2: number; y2: number } & Paint)
  | ({ kind: 'rect'; x: number; y: number; w: number; h: number; r?: number } & Paint)
  | ({ kind: 'circle'; cx: number; cy: number; r: number } & Paint)
  | ({ kind: 'path'; d: string } & Paint)
  | {
      kind: 'text';
      x: number;
      y: number;
      label: Label;
      size?: number;
      anchor?: 'start' | 'middle' | 'end';
      tone?: Tone;
      bold?: boolean;
      mono?: boolean;
      /** Degrees, turning the text about its anchor point. */
      rotate?: number;
    };

export interface Figure {
  width: number;
  height: number;
  shapes: Shape[];
}

export type Resolve = (label: Label) => string;

const plain: Resolve = (label) => (typeof label === 'string' ? label : label.word);

/** The opacity a tone prints with in one ink. */
const INK: Record<Tone, { color: string; opacity?: number }> = {
  ink: { color: 'currentColor' },
  muted: { color: 'currentColor', opacity: 0.6 },
  faint: { color: 'currentColor', opacity: 0.25 },
  accent: { color: 'currentColor' },
  // Canvas is the page color of the SVG's own color scheme, so a filled symbol hides the lines behind it.
  paper: { color: 'Canvas' },
  none: { color: 'none' },
};

const num = (value: number): string => String(Math.round(value * 100) / 100);

function paintAttrs(paint: Paint, defaults: Paint): string {
  const stroke = paint.stroke ?? defaults.stroke ?? 'none';
  const fill = paint.fill ?? defaults.fill ?? 'none';
  const s = INK[stroke];
  const f = INK[fill];
  let out = ` stroke="${s.color}" fill="${f.color}"`;
  if (s.opacity !== undefined) out += ` stroke-opacity="${s.opacity}"`;
  if (f.opacity !== undefined) out += ` fill-opacity="${f.opacity}"`;
  if (stroke !== 'none') out += ` stroke-width="${num(paint.width ?? 1.5)}"`;
  if (paint.dash) out += ` stroke-dasharray="${paint.dash}"`;
  return out;
}

/** Attributes in SVG syntax; numbers are rounded to hundredths and missing values left out. */
function attrs(list: Record<string, string | number | undefined>): string {
  return Object.entries(list)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${typeof value === 'number' ? num(value) : value}"`)
    .join('');
}

function textSvg(shape: Extract<Shape, { kind: 'text' }>, resolve: Resolve): string {
  const tone = INK[shape.tone ?? 'ink'];
  const at = attrs({
    x: shape.x,
    y: shape.y,
    'font-size': shape.size ?? 12,
    'font-family': shape.mono ? 'monospace' : 'sans-serif',
    'text-anchor': shape.anchor ?? 'start',
    fill: tone.color,
    'fill-opacity': tone.opacity,
    'font-weight': shape.bold ? '600' : undefined,
    transform: shape.rotate ? `rotate(${num(shape.rotate)} ${num(shape.x)} ${num(shape.y)})` : undefined,
  });
  return `<text${at}>${escapeXml(resolve(shape.label))}</text>`;
}

function shapeSvg(shape: Shape, resolve: Resolve): string {
  const ink = { stroke: 'ink' } as const;
  switch (shape.kind) {
    case 'line':
      return `<line${attrs({ x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 })}${paintAttrs(shape, ink)}/>`;
    case 'rect': {
      const box = attrs({ x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: shape.r });
      return `<rect${box}${paintAttrs(shape, ink)}/>`;
    }
    case 'circle':
      return `<circle${attrs({ cx: shape.cx, cy: shape.cy, r: shape.r })}${paintAttrs(shape, ink)}/>`;
    case 'path':
      return `<path d="${escapeXml(shape.d)}"${paintAttrs(shape, ink)}/>`;
    case 'text':
      return textSvg(shape, resolve);
  }
}

/** The figure as a standalone SVG file in one ink, for inserting into a page as a picture. */
export function figureSvg(figure: Figure, resolve: Resolve = plain): string {
  const body = figure.shapes.map((shape) => shapeSvg(shape, resolve)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(figure.width)}" height="${num(figure.height)}"` +
    ` viewBox="0 0 ${num(figure.width)} ${num(figure.height)}">${body}</svg>`
  );
}

/** Every word a figure shows, in drawing order, for checks and a text reading of the picture. */
export const figureText = (figure: Figure, resolve: Resolve = plain): string[] =>
  figure.shapes.flatMap((shape) => (shape.kind === 'text' ? [resolve(shape.label)] : []));
