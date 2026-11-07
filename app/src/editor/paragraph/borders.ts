// Paragraph border groups (spec 6.8 `border`; text DESIGN.md 7.4). Neighbors with equal borders and equal indents
// share one box, as in Word. The box's top border is drawn on the first, its bottom border on the last, and the
// `between` border between members. The renderer marks each member with its place in the group.
import type { Border, ParaFormat } from './attributes';

export type BorderPlace = 'single' | 'first' | 'middle' | 'last';

const SIDES = ['top', 'bottom', 'start', 'end', 'between'] as const;

function hasBorder(border: Border | undefined): border is Border {
  return border !== undefined && SIDES.some((side) => border[side] !== undefined);
}

/** Whether two paragraphs join into one bordered box: equal borders on every side and equal indents. */
export function sameBox(a: ParaFormat | null, b: ParaFormat | null): boolean {
  if (!a || !b || !hasBorder(a.border) || !hasBorder(b.border)) return false;
  return JSON.stringify([a.border, a.indent ?? null]) === JSON.stringify([b.border, b.indent ?? null]);
}

/** The place of each paragraph, in order, in its border group, or null for a paragraph without borders. */
export function borderPlaces(formats: readonly (ParaFormat | null)[]): (BorderPlace | null)[] {
  return formats.map((format, at) => {
    if (!format || !hasBorder(format.border)) return null;
    const joinsBefore = at > 0 && sameBox(formats[at - 1], format);
    const joinsAfter = at < formats.length - 1 && sameBox(format, formats[at + 1]);
    if (joinsBefore && joinsAfter) return 'middle';
    if (joinsBefore) return 'last';
    if (joinsAfter) return 'first';
    return 'single';
  });
}
