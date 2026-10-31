// A picture as data: lines, paths, dots, boxes, and labels in a fixed-size frame. The window draws it with the
// theme's colors (so it follows light and dark), and Insert writes the same marks as an SVG file in the light
// colors on a page-colored ground. Every picture carries a title and a text description for screen readers.
import { tokens } from '../../../../theme/tokens';

export type Role = 'axis' | 'grid' | 'text' | 'muted' | 's0' | 's1' | 's2' | 's3' | 's4' | 'ground';

interface Stroke {
  role: Role;
  dash?: boolean;
  width?: number;
}

export type Mark =
  | ({ kind: 'line'; x1: number; y1: number; x2: number; y2: number } & Stroke)
  | ({ kind: 'path'; d: string; fill?: boolean; opacity?: number; pattern?: string } & Stroke)
  | ({ kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean } & Stroke)
  | ({
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: boolean;
      opacity?: number;
      pattern?: string;
    } & Stroke)
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      role: Role;
      anchor?: 'start' | 'middle' | 'end';
      size?: number;
      rotate?: number;
      bold?: boolean;
    };

/** A repeating fill, such as the dots of a sandstone, drawn in a `size` × `size` tile. */
export interface Pattern {
  id: string;
  size: number;
  marks: readonly Mark[];
}

export interface Figure {
  width: number;
  height: number;
  title: string;
  description: string;
  marks: readonly Mark[];
  patterns?: readonly Pattern[];
}

const LIGHT = tokens.color.light;

/** The color of a role: a theme variable on screen, the light token in a saved picture. */
export function paint(role: Role, saved: boolean): string {
  if (!saved) {
    const names: Record<Role, string> = {
      axis: 'text-secondary',
      grid: 'border-subtle',
      text: 'text-primary',
      muted: 'text-secondary',
      s0: 'accent-primary',
      s1: 'accent-clay',
      s2: 'accent-night',
      s3: 'accent-dusk',
      s4: 'accent-candle',
      ground: 'surface-page',
    };
    return `var(--color-${names[role]})`;
  }
  const colors: Record<Role, string> = {
    axis: LIGHT.text.secondary,
    grid: LIGHT.border.subtle,
    text: LIGHT.text.primary,
    muted: LIGHT.text.secondary,
    s0: LIGHT.accent.primary,
    s1: LIGHT.accent.clay,
    s2: LIGHT.accent.night,
    s3: LIGHT.accent.dusk,
    s4: LIGHT.accent.candle,
    ground: LIGHT.surface.page,
  };
  return colors[role];
}

export const SERIES: readonly Role[] = ['s0', 's1', 's2', 's3', 's4'];

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (value: number): string => String(Math.round(value * 100) / 100);

/** The SVG attributes of a mark, as name and value pairs, for either renderer. */
export function attributes(mark: Mark, saved: boolean, prefix = ''): [string, string][] {
  const color = paint(mark.role, saved);
  if (mark.kind === 'text') {
    const list: [string, string][] = [
      ['x', n(mark.x)],
      ['y', n(mark.y)],
      ['fill', color],
      ['font-size', String(mark.size ?? 11)],
      ['text-anchor', mark.anchor ?? 'start'],
    ];
    if (mark.bold) list.push(['font-weight', '600']);
    if (mark.rotate) list.push(['transform', `rotate(${mark.rotate} ${n(mark.x)} ${n(mark.y)})`]);
    return list;
  }
  const filled = 'fill' in mark && mark.fill;
  const pattern = 'pattern' in mark && mark.pattern ? `url(#${prefix}${mark.pattern})` : null;
  const list: [string, string][] = [
    ['stroke', color],
    ['stroke-width', String(mark.width ?? 1.5)],
    ['fill', pattern ?? (filled ? color : 'none')],
  ];
  if (mark.dash) list.push(['stroke-dasharray', '4 3']);
  if ('opacity' in mark && mark.opacity !== undefined) list.push(['fill-opacity', String(mark.opacity)]);
  if (mark.kind === 'line') list.push(['x1', n(mark.x1)], ['y1', n(mark.y1)], ['x2', n(mark.x2)], ['y2', n(mark.y2)]);
  else if (mark.kind === 'path') list.push(['d', mark.d]);
  else if (mark.kind === 'circle') list.push(['cx', n(mark.cx)], ['cy', n(mark.cy)], ['r', n(mark.r)]);
  else list.push(['x', n(mark.x)], ['y', n(mark.y)], ['width', n(mark.w)], ['height', n(mark.h)]);
  return list;
}

const TAG = { line: 'line', path: 'path', circle: 'circle', rect: 'rect', text: 'text' } as const;

function markSvg(mark: Mark, prefix = ''): string {
  const attrs = attributes(mark, true, prefix)
    .map(([key, value]) => `${key}="${escape(value)}"`)
    .join(' ');
  return mark.kind === 'text' ? `<text ${attrs}>${escape(mark.text)}</text>` : `<${TAG[mark.kind]} ${attrs}/>`;
}

/** The picture as a standalone SVG file in the light colors. */
export function figureSvg(figure: Figure): string {
  const defs = (figure.patterns ?? [])
    .map(
      (p) =>
        `<pattern id="${escape(p.id)}" width="${p.size}" height="${p.size}" patternUnits="userSpaceOnUse">` +
        `${p.marks.map((m) => markSvg(m)).join('')}</pattern>`,
    )
    .join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${figure.width}" height="${figure.height}"`,
    ` viewBox="0 0 ${figure.width} ${figure.height}" role="img" font-family="${escape(tokens.font.ui)}">`,
    `<title>${escape(figure.title)}</title><desc>${escape(figure.description)}</desc>`,
    defs ? `<defs>${defs}</defs>` : '',
    `<rect width="${figure.width}" height="${figure.height}" fill="${paint('ground', true)}"/>`,
    ...figure.marks.map((m) => markSvg(m)),
    '</svg>',
  ].join('');
}

/** A path through points, skipping gaps where a point is not finite. */
export function pathOf(points: readonly (readonly [number, number])[], close = false): string {
  let d = '';
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${n(x)} ${n(y)}`;
    pen = true;
  }
  return close && d ? `${d}Z` : d;
}
