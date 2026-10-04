// The rules of a page's paper as the grid its text is laid out in. Ruled, grid, and dot paper have rules at the top
// margin plus whole spacings, down every sheet. Text on such paper takes whole rules and sits on them (see
// `features/page/layout/rules.ts`); every other paper lays text out freely.
import type { RuleGrid } from '../../../core/ruled';
import type { SheetGeometry } from '../pagination/geometry';
import { drawnSpacingOf } from './patterns';
import type { PageBackground } from './types';

/** Patterns whose lines run across the page at one spacing, anchored at the top margin. */
const RULED = new Set(['ruled', 'grid', 'dots']);

/** The lattice text is laid out in: rule k is at `origin + k * step`, down the page or down each sheet. */
export type PaperRules = RuleGrid;

/** The rules of the paper, or null when its paper has none a line of text could sit on. */
export function paperRules(background: PageBackground, g: SheetGeometry, paginated: boolean): PaperRules | null {
  if (!RULED.has(background.pattern)) return null;
  return { step: drawnSpacingOf(background), origin: g.margins[0], sheet: paginated ? g.height : null };
}
