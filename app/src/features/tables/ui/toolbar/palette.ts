// What the cell format bar tells its color palettes: the color the contrast badge compares with (DESIGN 10.4), and the
// page's paper. Pure helpers, so the bar and its tests share them.
import { themeColor } from '../../../../ui/color/parse';
import type { Scheme } from '../../../../ui/color/parse';
import type { CellStyle } from '../../sheet/model';
import { colorOf } from '../../sheet/render/color';

/** The page's paper as `#rrggbb`, read from the page's surface token as the element sees it (a notebook may set it). */
export function paperOf(element: Element | null | undefined): string | undefined {
  if (!element) return undefined;
  const value = getComputedStyle(element).getPropertyValue('--color-surface-page').trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

/**
 * The color a palette's badge compares with. A fill is read against the cell's text color. A text color is read
 * against the cell's fill, or against the paper when the cell has no flat fill.
 */
export function againstFor(tool: 'fill' | 'textColor', style: CellStyle, scheme: Scheme, paper?: string): string {
  const page = paper ?? themeColor('background', scheme);
  if (tool === 'fill') return colorOf(style.font?.color, scheme) ?? themeColor('text', scheme, { background: page });
  const fill = typeof style.fill === 'string' && style.fill !== 'none' ? colorOf(style.fill, scheme) : undefined;
  return fill ?? page;
}
