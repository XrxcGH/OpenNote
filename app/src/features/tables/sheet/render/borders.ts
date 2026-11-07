// Borders (DESIGN 9, Excel's drawing rules). Each border side maps to a CSS line, and where two cells share an
// edge the heavier line wins; on a tie the right or lower cell's side wins, as Excel draws. Both cells of an edge
// get the same answer, so `border-collapse: collapse` has nothing left to decide.

import type { BorderSide, Borders } from '../model';

export interface Line {
  css: 'solid' | 'dashed' | 'dotted' | 'double';
  /** Width in CSS pixels. */
  width: number;
}

/** The 13 styles as CSS. `slantDashDot` falls back to a 2 px dashed line, `double` is 3 px so both lines show. */
export const BORDER_LINES: Readonly<Record<string, Line>> = {
  hair: { css: 'solid', width: 0.5 },
  thin: { css: 'solid', width: 1 },
  medium: { css: 'solid', width: 2 },
  thick: { css: 'solid', width: 3 },
  dotted: { css: 'dotted', width: 1 },
  dashed: { css: 'dashed', width: 1 },
  mediumDashed: { css: 'dashed', width: 2 },
  dashDot: { css: 'dashed', width: 1 },
  mediumDashDot: { css: 'dashed', width: 2 },
  dashDotDot: { css: 'dotted', width: 1 },
  mediumDashDotDot: { css: 'dotted', width: 2 },
  slantDashDot: { css: 'dashed', width: 2 },
  double: { css: 'double', width: 3 },
};

/** Excel's weight order for a shared edge: higher wins. Dotted and hair lines are the lightest. */
const WEIGHT: Readonly<Record<string, number>> = {
  hair: 1,
  dotted: 2,
  dashDotDot: 3,
  dashDot: 4,
  dashed: 5,
  thin: 6,
  mediumDashDotDot: 7,
  slantDashDot: 8,
  mediumDashDot: 9,
  mediumDashed: 10,
  medium: 11,
  thick: 12,
  double: 13,
};

const known = (side: BorderSide | undefined): side is BorderSide =>
  side !== undefined && Object.hasOwn(BORDER_LINES, side.style);

/** The side that draws on an edge shared by `before` (above or left) and `after` (below or right). */
export function heavier(before: BorderSide | undefined, after: BorderSide | undefined): BorderSide | undefined {
  const a = known(before) ? before : undefined;
  const b = known(after) ? after : undefined;
  if (!a || !b) return a ?? b;
  return WEIGHT[a.style] > WEIGHT[b.style] ? a : b;
}

export type Edge = 't' | 'r' | 'b' | 'l';

export interface Neighbors {
  above?: Borders;
  below?: Borders;
  left?: Borders;
  right?: Borders;
}

/** The four sides a cell draws, after each shared edge is settled. */
export function resolvedSides(own: Borders | undefined, near: Neighbors): Record<Edge, BorderSide | undefined> {
  return {
    t: heavier(near.above?.b, own?.t),
    l: heavier(near.left?.r, own?.l),
    b: heavier(own?.b, near.below?.t),
    r: heavier(own?.r, near.right?.l),
  };
}

/** A CSS border value for a side in the given color. */
export function cssLine(side: BorderSide, color: string): string {
  const line = BORDER_LINES[side.style];
  const width = typeof side.width === 'number' && side.width > 0 ? side.width : line.width;
  return `${width}px ${line.css} ${color}`;
}
