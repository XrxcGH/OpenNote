// The 21 built-in looks (DESIGN 3.5): seven pen colors in a light, a medium, and a dark weight. A look is stored
// by name, so a theme change or dark mode recolors it. Each look gives a style per element (header, band, and so
// on); the model's `resolve` lays those under the table's own styles. Text color is left to Automatic, so text
// reads on every fill.

import { darken, lighten } from '../../../../ui/color/math';
import { resolveColor } from '../../../../ui/color/parse';
import type { Scheme } from '../../../../ui/color/parse';
import type { CellStyle, LookElement, NamedLook } from '../model';

export const LOOK_PENS = ['indigo', 'brick', 'fern', 'plum', 'amber', 'walnut', 'ink'] as const;
export const LOOK_WEIGHTS = ['light', 'medium', 'dark'] as const;

const THEME_OF: Record<(typeof LOOK_PENS)[number], string> = {
  indigo: 'theme:accent1',
  brick: 'theme:accent2',
  fern: 'theme:accent3',
  plum: 'theme:accent4',
  amber: 'theme:accent5',
  walnut: 'theme:accent6',
  ink: 'theme:text',
};

/** The names of all 21 looks, such as `medium-indigo`. */
export const LOOK_NAMES: readonly string[] = LOOK_WEIGHTS.flatMap((w) => LOOK_PENS.map((p) => `${w}-${p}`));

const side = (color: string, style = 'thin') => ({ style, color });

/** The tint or shade of a pen: toward white in the light scheme, toward black in the dark scheme. */
function tint(pen: string, scheme: Scheme, percent: number): string {
  return scheme === 'light' ? lighten(pen, percent) : darken(pen, percent);
}

/** The style a look gives an element, or undefined when it adds nothing there. */
export function lookStyle(name: string, element: LookElement, scheme: Scheme): CellStyle | undefined {
  const m = /^(light|medium|dark)-([a-z]+)$/.exec(name);
  if (!m || !Object.hasOwn(THEME_OF, m[2])) return undefined;
  const weight = m[1];
  const pen = resolveColor(THEME_OF[m[2] as keyof typeof THEME_OF], scheme);
  if (!pen) return undefined;
  const bold = { font: { bold: true } };
  if (weight === 'light') {
    const rule = side(tint(pen, scheme, 60));
    switch (element) {
      case 'whole':
        return { border: { b: rule } };
      case 'header':
        return { ...bold, border: { b: side(pen, 'medium') } };
      case 'total':
        return { ...bold, border: { t: side(pen, 'medium') } };
      case 'firstCol':
      case 'lastCol':
        return bold;
      case 'band1':
      case 'colBand1':
        return { fill: tint(pen, scheme, 85) };
      default:
        return undefined;
    }
  }
  if (weight === 'medium') {
    const rule = side(tint(pen, scheme, 40));
    switch (element) {
      case 'whole':
        return { border: { t: rule, r: rule, b: rule, l: rule } };
      case 'header':
        return { ...bold, fill: darken(pen, scheme === 'light' ? 25 : 65) };
      case 'total':
        return { ...bold, fill: tint(pen, scheme, 60) };
      case 'firstCol':
      case 'lastCol':
        return bold;
      case 'band1':
      case 'colBand1':
        return { fill: tint(pen, scheme, 80) };
      default:
        return undefined;
    }
  }
  const k = scheme === 'light' ? 0 : 30;
  const deep = darken(pen, 25 + k);
  const rule = side(darken(pen, 50));
  switch (element) {
    case 'whole':
      return { fill: deep, border: { t: rule, r: rule, b: rule, l: rule } };
    case 'header':
      return { ...bold, fill: darken(pen, 60 + k / 2) };
    case 'total':
      return { ...bold, fill: darken(pen, 60 + k / 2) };
    case 'firstCol':
    case 'lastCol':
      return bold;
    case 'band1':
    case 'colBand1':
      return { fill: darken(pen, 40 + k) };
    default:
      return undefined;
  }
}

/** The model's `namedLook` hook for a scheme. */
export function namedLookFor(scheme: Scheme): NamedLook {
  return (name, element) => lookStyle(name, element, scheme);
}
