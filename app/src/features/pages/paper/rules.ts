// The rules of a page's paper as the grid its text is laid out in. Ruled, grid, and dot paper have rules at the top
// margin plus whole spacings, down every sheet. Text on such paper takes whole rules and sits on them (see
// `features/page/layout/rules.ts`); every other paper lays text out freely. The rules are read from the same lattice
// the paper renderer draws and the drawing tools snap to (core/paperLattice.ts), so text and shapes share one geometry.
import { ruleGridOf } from '../../../core/paperLattice';
import type { RuleGrid } from '../../../core/ruled';
import type { SheetGeometry } from '../pagination/geometry';
import { paperLattice } from './patterns';
import type { PageBackground } from './types';

/** The lattice text is laid out in: rule k is at `origin + k * step`, down the page or down each sheet. */
export type PaperRules = RuleGrid;

/** The rules of the paper, or null when its paper has none a line of text could sit on. */
export function paperRules(background: PageBackground, g: SheetGeometry, paginated: boolean): PaperRules | null {
  const lattice = paperLattice(background, g, paginated);
  return lattice ? ruleGridOf(lattice) : null;
}
