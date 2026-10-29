// The paper presets people pick from (FEATURES.md "Page layouts"). Each one is a page background with its spacing
// written out, since a page that omits its spacing gets the 7 mm default. Templates come from templates.ts.

import { spacingOf } from './patterns';
import type { PageBackground } from './types';

/** Common spacings in page units: 6 mm, 7 mm, and 8.7 mm ruling, 5 mm, 1/4 inch, and 1 cm grids, and 2 mm staves. */
export const SPACINGS = {
  ruledNarrow: 22.68,
  ruledCollege: 26.46,
  ruledWide: 32.88,
  grid5mm: 18.9,
  gridQuarterInch: 24,
  grid1cm: 37.8,
  dots: 18.9,
  isometric: 18.9,
  staff: 7.56,
} as const;

export const PRESETS = {
  plain: { pattern: 'plain' },
  'ruled-narrow': { pattern: 'ruled', spacing: SPACINGS.ruledNarrow },
  'ruled-college': { pattern: 'ruled', spacing: SPACINGS.ruledCollege },
  'ruled-wide': { pattern: 'ruled', spacing: SPACINGS.ruledWide },
  'grid-5mm': { pattern: 'grid', spacing: SPACINGS.grid5mm },
  'grid-quarter-inch': { pattern: 'grid', spacing: SPACINGS.gridQuarterInch },
  'grid-1cm': { pattern: 'grid', spacing: SPACINGS.grid1cm },
  dots: { pattern: 'dots', spacing: SPACINGS.dots },
  isometric: { pattern: 'isometric', spacing: SPACINGS.isometric },
  cornell: { pattern: 'cornell', spacing: SPACINGS.ruledCollege },
  staff: { pattern: 'staff', spacing: SPACINGS.staff },
} as const satisfies Record<string, PageBackground>;

export type PresetId = keyof typeof PRESETS;

/** A preset's pattern with a custom spacing, kept within the range that pattern allows. */
export function withSpacing(background: PageBackground, spacing: number): PageBackground {
  return { ...background, spacing: spacingOf({ ...background, spacing }) };
}
