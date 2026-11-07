// The CSS declarations for a paragraph's version 2 formatting (text DESIGN.md 2.3 and 7). A paragraph, heading, or list
// item calls `paraDom` while it renders, so the static DOM and the editor's DOM carry the same style. Borders and drop
// caps ride on custom properties and data attributes, which the style sheet draws, because a group of bordered
// neighbors and a drop cap need rules an inline style can't hold.
import { PARA_KEYS, paraFormat } from '../paragraph/attributes';
import type { Border, BorderSide, BorderSideName, ParaFormat, Shade } from '../paragraph/attributes';
import { lineFactor } from './lineFactor';
import { colorValue, px } from './runStyle';
import type { StyleDeclarations } from './runStyle';

/** Word's automatic paragraph spacing, 14 pt. */
const AUTO_SPACING_PT = 14;

const BORDER_STYLE: Readonly<Record<string, string>> = {
  single: 'solid',
  double: 'double',
  dotted: 'dotted',
  dashed: 'dashed',
  thick: 'solid',
  triple: 'double',
  thinThickSmallGap: 'double',
  thickThinSmallGap: 'double',
  wave: 'solid',
  doubleWave: 'double',
  dashDotStroked: 'dashed',
  threeDEmboss: 'ridge',
  threeDEngrave: 'groove',
  inset: 'inset',
  outset: 'outset',
};

/** One border side as a CSS border value. A double line needs 3 px to show both strokes; thick is three times wide. */
function borderValue(side: BorderSide): string {
  const style = BORDER_STYLE[side.style] ?? 'solid';
  const wide = side.style === 'thick' ? side.width * 3 : side.width;
  const width = px(style === 'double' ? Math.max(wide, 2.25) : wide);
  return `${width} ${style} ${side.color ? colorValue(side.color) : 'currentcolor'}`;
}

const SIDE_PROPERTY: Readonly<Record<BorderSideName, string>> = {
  top: 'top',
  bottom: 'bottom',
  start: 'start',
  end: 'end',
  between: 'between',
};

function borderStyle(border: Border): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, side] of Object.entries(border) as [BorderSideName, BorderSide][]) {
    out[`--bd-${SIDE_PROPERTY[name]}`] = borderValue(side);
    if (name !== 'between') out[`--bd-${name}-space`] = px(side.space);
  }
  return out;
}

/** How much of the pattern color each `ST_Shd` pattern shows, in percent (stripes and crosses by their coverage). */
function patternPercent(pattern: string): number {
  const pct = /^pct(\d+)$/.exec(pattern);
  if (pct) return Number(pct[1]);
  if (pattern === 'solid') return 100;
  if (pattern === 'clear') return 0;
  return pattern.startsWith('thin') ? 25 : 50;
}

function shadeStyle(shade: Shade): Record<string, string> {
  const percent = patternPercent(shade.pattern);
  const fill = shade.fill ? colorValue(shade.fill) : 'transparent';
  const pattern = shade.color ? colorValue(shade.color) : 'currentcolor';
  if (percent === 0) return shade.fill ? { 'background-color': fill } : {};
  if (percent === 100) return { 'background-color': pattern };
  return { 'background-color': `color-mix(in srgb, ${pattern} ${percent}%, ${fill})` };
}

const spacing = (value: number | 'auto') => px(value === 'auto' ? AUTO_SPACING_PT : value);

/** The declarations for one paragraph's formatting attributes. */
export function paraStyle(attrs: Readonly<Record<string, unknown>>): StyleDeclarations {
  return styleOf(paraFormat(attrs));
}

function styleOf(f: ParaFormat): StyleDeclarations {
  const out: Record<string, string> = {};
  if (f.align) {
    out['text-align'] = f.align === 'distribute' ? 'justify' : f.align;
    if (f.align === 'distribute') {
      out['text-align-last'] = 'justify';
      out['text-justify'] = 'inter-character';
    }
  }
  if (f.indent) {
    const { start, end, first } = f.indent;
    // A hanging indent: the first line sits at start + first, and padding holds the later lines at start.
    if (first < 0) {
      out['margin-inline-start'] = px(start + first);
      out['padding-inline-start'] = px(-first);
    } else if (start !== 0) {
      out['margin-inline-start'] = px(start);
    }
    if (end !== 0) out['margin-inline-end'] = px(end);
    if (first !== 0) out['text-indent'] = px(first);
  }
  if (f.before !== undefined) out['margin-block-start'] = spacing(f.before);
  if (f.after !== undefined) out['margin-block-end'] = spacing(f.after);
  if (f.line) {
    const { rule, value } = f.line;
    const factor = Math.round(lineFactor(null) * 10000) / 10000;
    if (rule === 'multiple') {
      out['--line-mult'] = String(value);
      out['line-height'] = `calc(var(--line-mult) * var(--line-factor, ${factor}))`;
    } else if (rule === 'exact') {
      out['line-height'] = px(value);
    } else {
      out['line-height'] = `max(${px(value)}, ${factor}em)`;
    }
  }
  if (f.breakBefore) out['break-before'] = 'page';
  if (f.keepNext) out['break-after'] = 'avoid';
  if (f.keepLines) out['break-inside'] = 'avoid';
  if (f.widows !== undefined) {
    out.widows = f.widows ? '2' : '1';
    out.orphans = f.widows ? '2' : '1';
  }
  if (f.border) Object.assign(out, borderStyle(f.border));
  if (f.shade) Object.assign(out, shadeStyle(f.shade));
  if (f.dir) {
    out.direction = f.dir;
    out['unicode-bidi'] = 'isolate';
  }
  if (f.hyphenate !== undefined) out.hyphens = f.hyphenate ? 'auto' : 'manual';
  if (f.dropCap) {
    out['--drop-lines'] = String(f.dropCap.lines);
    out['--drop-distance'] = px(f.dropCap.distance);
  }
  return out;
}

/** The DOM attributes a paragraph, heading, or list item gets: its style and the data attributes that mark it. */
export function paraDom(attrs: Readonly<Record<string, unknown>>): Record<string, string> {
  // Most paragraphs have no formatting, so a plain page pays one scan of the keys and no more.
  if (!PARA_KEYS.some((key) => attrs[key] != null)) return NONE;
  const f = paraFormat(attrs);
  const style = Object.entries(styleOf(f))
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
  const out: Record<string, string> = {};
  if (style !== '') out.style = style;
  if (f.border && Object.keys(f.border).length > 0) out['data-border'] = '';
  if (f.dropCap) out['data-drop-cap'] = f.dropCap.mode;
  if (f.lang) out.lang = f.lang;
  return out;
}

const NONE: Record<string, string> = Object.freeze({});
