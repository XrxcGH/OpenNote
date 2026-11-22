// The Format Cells preview: the style as CSS on one sample cell, and the same style in words for a screen reader
// (DESIGN 10.3, 619). The drawing rules are the render lane's (colors, fills, borders), so the sample looks as the
// table will.
import type { CSSProperties } from 'react';
import { t } from '../../../../strings/t';
import type { Scheme } from '../../../../ui/color/parse';
import type { CellStyle } from '../../sheet/model';
import { cssLine } from '../../sheet/render/borders';
import { colorOf, drawFill } from '../../sheet/render/color';
import { automaticText } from '../../sheet/render/color';
import type { Edges } from './edges';

const POINT = 96 / 72;

/** The CSS of the sample cell. */
export function previewCss(style: CellStyle, edges: Edges, scheme: Scheme): CSSProperties {
  const font = style.font ?? {};
  const align = style.align ?? {};
  const fill = drawFill(style.fill, scheme);
  const color = colorOf(font.color, scheme) ?? (fill.under ? automaticText(fill.under) : undefined);
  const lines: string[] = [];
  if (font.underline !== undefined && font.underline !== 'none') lines.push('underline');
  if (font.strike !== undefined && font.strike !== 'none') lines.push('line-through');
  const side = (key: 't' | 'r' | 'b' | 'l') => {
    const one = edges[key];
    return one ? cssLine(one, colorOf(one.color, scheme) ?? 'currentColor') : 'none';
  };
  const diagonal = (key: 'dd' | 'du') => {
    const one = edges[key];
    if (!one) return null;
    const ink = colorOf(one.color, scheme) ?? 'currentColor';
    const to = key === 'dd' ? 'to bottom right' : 'to top right';
    const lo = 'calc(50% - 0.5px)';
    const hi = 'calc(50% + 0.5px)';
    return `linear-gradient(${to}, transparent ${lo}, ${ink} ${lo} ${hi}, transparent ${hi})`;
  };
  const images = [diagonal('dd'), diagonal('du'), fill.image].filter((one): one is string => one !== null && !!one);
  const rotate = typeof align.rotate === 'number' ? align.rotate : 0;
  return {
    fontFamily: font.family && !font.family.startsWith('+') ? font.family : undefined,
    fontSize: font.size ? `${font.size * POINT}px` : undefined,
    fontWeight: font.bold ? 700 : font.weight,
    fontStyle: font.italic ? 'italic' : undefined,
    textDecoration: lines.length > 0 ? lines.join(' ') : undefined,
    verticalAlign: font.script === 'super' ? 'super' : font.script === 'sub' ? 'sub' : undefined,
    color,
    backgroundColor: fill.color,
    backgroundImage: images.length > 0 ? images.join(', ') : undefined,
    borderTop: side('t'),
    borderRight: side('r'),
    borderBottom: side('b'),
    borderLeft: side('l'),
    textAlign:
      align.h === 'left' || align.h === 'right' || align.h === 'center' || align.h === 'justify' ? align.h : undefined,
    justifyContent: align.v === 'middle' ? 'center' : align.v === 'bottom' ? 'flex-end' : 'flex-start',
    paddingBlock: style.pad ? `${style.pad.t ?? 2}pt ${style.pad.b ?? 2}pt` : undefined,
    paddingInline: style.pad ? `${style.pad.l ?? 4}pt ${style.pad.r ?? 4}pt` : undefined,
    whiteSpace: align.wrap === 'clip' || align.wrap === 'overflow' ? 'nowrap' : 'normal',
    transform: rotate !== 0 ? `rotate(${-rotate}deg)` : undefined,
    textIndent: align.indent ? `${align.indent * 3}ch` : undefined,
  };
}

/** The style in a short sentence: what shows, in the order a person reads a cell. */
export function describePreview(style: CellStyle, text: string): string {
  const parts: string[] = [];
  const font = style.font ?? {};
  if (font.bold) parts.push(t('sheetFormat.describe.bold'));
  if (font.italic) parts.push(t('sheetFormat.describe.italic'));
  if (font.underline !== undefined && font.underline !== 'none') parts.push(t('sheetFormat.describe.underline'));
  if (font.strike !== undefined && font.strike !== 'none') parts.push(t('sheetFormat.describe.strike'));
  if (font.size) parts.push(t('sheetFormat.describe.size', { size: font.size }));
  if (typeof style.fill === 'string' && style.fill !== 'none')
    parts.push(t('sheetFormat.describe.fill', { color: style.fill }));
  else if (style.fill !== undefined && style.fill !== 'none') parts.push(t('sheetFormat.describe.fillPattern'));
  const sides = Object.keys(style.border ?? {}).length;
  if (sides > 0) parts.push(t('sheetFormat.describe.borders', { count: sides }));
  const h = style.align?.h;
  if (h !== undefined && h !== 'general') parts.push(t('sheetFormat.describe.align', { align: h }));
  const extras = parts.length > 0 ? parts.join(', ') : t('sheetFormat.describe.plain');
  return t('sheetFormat.describe.sentence', { text, style: extras });
}
