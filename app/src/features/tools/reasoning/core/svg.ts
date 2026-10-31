// Pictures as plain data: a small tree of SVG elements. The kit window draws it with the theme's colors, and Insert
// writes it out as a self-contained SVG file with the light theme's colors. Nothing here touches the DOM.
import { tokens } from '../../../../theme/tokens';

/** A named color. Pictures never carry raw colors, so they follow the theme and Windows contrast themes. */
export type Tone =
  'ink' | 'muted' | 'line' | 'accent' | 'accentSoft' | 'hi' | 'hiSoft' | 'warn' | 'warnSoft' | 'paper' | 'sunken';

export type Attr = string | number;

export interface SvgNode {
  tag: string;
  attrs: Readonly<Record<string, Attr>>;
  children: readonly (SvgNode | string)[];
}

type Child = SvgNode | string | number | null | undefined | false;

/** An element. Attributes are camelCase (strokeWidth); a fill or stroke of `@tone` takes a theme color. */
export function el(tag: string, attrs: Record<string, Attr | undefined | null> = {}, ...children: Child[]): SvgNode {
  const kept: Record<string, Attr> = {};
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) kept[key] = value;
  const list: (SvgNode | string)[] = [];
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    list.push(typeof child === 'number' ? String(child) : child);
  }
  return { tag, attrs: kept, children: list };
}

/** The CSS variable each tone reads in the window. */
export const TONE_VARS: Readonly<Record<Tone, string>> = {
  ink: '--color-text-primary',
  muted: '--color-text-muted',
  line: '--color-border-control',
  accent: '--color-accent-primary',
  accentSoft: '--color-accent-primary-subtle',
  hi: '--color-accent-candle',
  hiSoft: '--color-accent-candle-subtle',
  warn: '--color-accent-dusk',
  warnSoft: '--color-accent-dusk-subtle',
  paper: '--color-surface-page',
  sunken: '--color-surface-sunken',
};

const light = tokens.color.light;
/** The colors a saved picture uses: the light theme's, so it reads on a white page or on paper. */
const EXPORT_COLORS: Readonly<Record<Tone, string>> = {
  ink: light.text.primary,
  muted: light.text.muted,
  line: light.border.control,
  accent: light.accent.primary,
  accentSoft: light.accent.primarySubtle,
  hi: light.accent.candle,
  hiSoft: light.accent.candleSubtle,
  warn: light.accent.dusk,
  warnSoft: light.accent.duskSubtle,
  paper: light.surface.page,
  sunken: light.surface.sunken,
};

export const toneOf = (value: Attr): Tone | null =>
  typeof value === 'string' && value.startsWith('@') && value.slice(1) in TONE_VARS ? (value.slice(1) as Tone) : null;

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function attrText(key: string, value: Attr): string {
  const tone = toneOf(value);
  return ` ${kebab(key)}="${escape(tone ? EXPORT_COLORS[tone] : String(value))}"`;
}

function serialize(node: SvgNode | string): string {
  if (typeof node === 'string') return escape(node);
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => attrText(key, value))
    .join('');
  if (node.children.length === 0) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

/** The picture as an SVG file, with its description as the title. */
export function svgFile(root: SvgNode, alt: string): string {
  const font = tokens.font.ui;
  const head = el('title', {}, alt);
  const body = el('g', { fontFamily: font }, ...root.children);
  const file = { ...root, attrs: { xmlns: 'http://www.w3.org/2000/svg', ...root.attrs }, children: [head, body] };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(file)}\n`;
}

/** The root element of a picture `width` by `height` units. */
export const svgRoot = (width: number, height: number, ...children: Child[]): SvgNode =>
  el(
    'svg',
    { viewBox: `0 0 ${round(width)} ${round(height)}`, width: round(width), height: round(height) },
    ...children,
  );

export const round = (n: number): number => Math.round(n * 10) / 10;

/** Path data from commands and numbers, such as pathD('M', 0, 0, 'L', 10, 5). */
export const pathD = (...parts: readonly (string | number)[]): string =>
  parts.map((p) => (typeof p === 'number' ? String(round(p)) : p)).join(' ');

/** A text label centered at (x, y). */
export const label = (x: number, y: number, text: string, extra: Record<string, Attr | undefined> = {}): SvgNode =>
  el(
    'text',
    {
      x: round(x),
      y: round(y),
      textAnchor: 'middle',
      dominantBaseline: 'central',
      fontSize: 12,
      fill: '@ink',
      ...extra,
    },
    text,
  );

/** About how wide a label is at 12 units, for layout. */
export const textWidth = (text: string, size = 12): number => Math.max(1, [...text].length) * size * 0.6;

/** An arrowhead marker; lines that end in an arrow use markerEnd="url(#kit-arrow)". */
export const arrowDefs = (): SvgNode =>
  el(
    'defs',
    {},
    el(
      'marker',
      {
        id: 'kit-arrow',
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: 'auto-start-reverse',
      },
      el('path', { d: 'M0 0L10 5L0 10z', fill: '@ink' }),
    ),
  );
