// Chart palette slots. Charts are content, like ink, so they use the pen palette (BRAND.md section 4). The order
// comes from the Phase 7 design: a greedy search for the pens that stay apart under normal vision and three kinds
// of color blindness. The first three pens stay clearly apart by color alone. From the fourth series, fills get
// patterns and lines and dots get dashes and shapes, so no chart depends on color alone (WCAG 1.4.1).
//
// Each slot names a CSS variable, `--chart-s0` to `--chart-s6`. The token build emits them from this table, so a
// theme switch recolors charts with no redraw.

export type PatternKind = 'solid' | 'diagonal' | 'dots' | 'horizontal' | 'crosshatch' | 'vertical' | 'reverse-diagonal';

/** Plot's `symbol` names for dots. */
export type SymbolName = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'star' | 'wye';

export interface Slot {
  /** The brand pen this slot uses. */
  pen: string;
  cssVar: string;
  pattern: PatternKind;
  /** A stroke-dasharray, or null for a solid line. */
  dash: string | null;
  symbol: SymbolName;
}

export const SLOTS: readonly Slot[] = [
  { pen: 'Indigo', cssVar: '--chart-s0', pattern: 'solid', dash: null, symbol: 'circle' },
  { pen: 'Amber', cssVar: '--chart-s1', pattern: 'diagonal', dash: '6 3', symbol: 'square' },
  { pen: 'Ink', cssVar: '--chart-s2', pattern: 'dots', dash: '2 2', symbol: 'triangle' },
  { pen: 'Fern', cssVar: '--chart-s3', pattern: 'horizontal', dash: '8 3 2 3', symbol: 'diamond' },
  { pen: 'Brick', cssVar: '--chart-s4', pattern: 'crosshatch', dash: '12 4', symbol: 'cross' },
  { pen: 'Walnut', cssVar: '--chart-s5', pattern: 'vertical', dash: '2 5', symbol: 'star' },
  { pen: 'Plum', cssVar: '--chart-s6', pattern: 'reverse-diagonal', dash: '6 2 2 2', symbol: 'wye' },
];

export const MAX_SERIES = SLOTS.length;

/** Charts with this many series or more use patterns, dashes, and shapes without being asked. */
export const PATTERNS_FROM = 4;

/** The pattern tile is 8 by 8 units, drawn in the page color over the series color. */
export const PATTERN_SIZE = 8;

export function needsPatterns(seriesCount: number, forced: boolean): boolean {
  return forced || seriesCount >= PATTERNS_FROM;
}

export function slotColor(slot: number): string {
  return `var(${SLOTS[slot % MAX_SERIES].cssVar})`;
}

/** The id of a slot's pattern. Ids carry a prefix so two charts on one page never share a definition. */
export function patternId(prefix: string, slot: number): string {
  return `${prefix}-pattern-${slot}`;
}

/** What to paint a slot with: its color, or its pattern when patterns are on and the slot has one. */
export function slotPaint(slot: number, patterns: boolean, prefix: string): string {
  const s = SLOTS[slot % MAX_SERIES];
  return patterns && s.pattern !== 'solid' ? `url(#${patternId(prefix, slot)})` : slotColor(slot);
}

export interface PatternDef {
  id: string;
  kind: PatternKind;
  size: number;
  /** The tile's background, which is the series color. */
  background: string;
  /** The color of the pattern's lines and dots, which is the page color. */
  line: string;
}

/** Definitions for the patterns a chart needs, for its own `<defs>`. */
export function patternDefs(slots: readonly number[], prefix: string): PatternDef[] {
  return slots
    .filter((slot) => SLOTS[slot % MAX_SERIES].pattern !== 'solid')
    .map((slot) => ({
      id: patternId(prefix, slot),
      kind: SLOTS[slot % MAX_SERIES].pattern,
      size: PATTERN_SIZE,
      background: slotColor(slot),
      line: 'var(--color-surface-page)',
    }));
}
