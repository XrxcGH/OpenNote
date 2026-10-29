// Cornell paper: a cue column on the left, a notes area beside it, and a summary area across the bottom. The flow
// of text fills the notes area, so a paginated Cornell page has a smaller content box than its margins say.

import type { Rect, SheetGeometry } from '../pagination/geometry';
import { ruled } from './basic';
import type { Canvas } from './canvas';

/** The cue column is 2.5 in wide from the paper's left edge, the summary 2 in tall, and notes keep 24 units clear. */
export const CORNELL = { cue: 240, summary: 192, pad: 24 } as const;

export interface CornellAreas {
  readonly cue: Rect;
  readonly notes: Rect;
  readonly summary: Rect;
}

/** The three areas of a sheet, in sheet coordinates. */
export function cornellAreas(g: SheetGeometry): CornellAreas {
  const [top, right, bottom, left] = g.margins;
  const summaryTop = g.height - bottom - CORNELL.summary;
  const notesLeft = Math.max(left, CORNELL.cue + CORNELL.pad);
  return {
    cue: { x: left, y: top, w: Math.max(0, CORNELL.cue - left), h: Math.max(0, summaryTop - top) },
    notes: {
      x: notesLeft,
      y: top,
      w: Math.max(0, g.width - right - notesLeft),
      h: Math.max(0, summaryTop - CORNELL.pad - top),
    },
    summary: { x: left, y: summaryTop, w: Math.max(0, g.width - right - left), h: CORNELL.summary },
  };
}

/** Draws the dividers and the ruled lines of both areas for one sheet. */
export function cornell(c: Canvas, g: SheetGeometry, step: number): void {
  const [top, right] = g.margins;
  const { summary } = cornellAreas(g);
  const edge = g.width - right;
  c.line(CORNELL.cue, top, CORNELL.cue, summary.y, 'strong');
  c.line(summary.x, summary.y, edge, summary.y, 'strong');
  const notes = { x: CORNELL.cue, y: top + step, w: edge - CORNELL.cue, h: summary.y - 1 - (top + step) };
  ruled(c, notes, top, step);
  ruled(c, { x: summary.x, y: summary.y + step, w: summary.w, h: summary.h - step }, summary.y, step);
}
