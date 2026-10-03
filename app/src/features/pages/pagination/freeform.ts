// Sheets on a freeform page. Floating blocks and ink keep their coordinates, so the only question is which sheets a
// box falls on. A box across a sheet edge is drawn on both sheets, clipped at each edge, and flagged so the interface
// can offer "Move below page break".

import { EPS, contentTop, sheetAt, type Rect, type SheetGeometry } from './geometry';

export interface SheetSpan {
  /** The first and last sheet the box touches. A box that only touches an edge belongs to the sheet it fills. */
  readonly first: number;
  readonly last: number;
  /** True when the box reaches more than one sheet. */
  readonly crossesBreak: boolean;
  /** True when part of the box lies left of the paper, right of it, or above the page. */
  readonly offPaper: boolean;
}

export interface SheetPiece {
  readonly sheet: number;
  /** The part of the box on that sheet, in page coordinates. */
  readonly rect: Rect;
}

/** Which sheets the box reaches. A box with no height sits on one sheet. */
export function sheetSpan(g: SheetGeometry, box: Rect): SheetSpan {
  const first = sheetAt(g, box.y);
  const last = Math.max(first, sheetAt(g, box.y + box.h - 2 * EPS));
  return {
    first,
    last,
    crossesBreak: last > first,
    offPaper: box.x < -EPS || box.x + box.w > g.width + EPS || box.y < -EPS,
  };
}

/** The part of the box on each sheet it reaches, for clipping when the page is drawn or exported. */
export function sheetPieces(g: SheetGeometry, box: Rect): SheetPiece[] {
  const { first, last } = sheetSpan(g, box);
  const pieces: SheetPiece[] = [];
  for (let sheet = first; sheet <= last; sheet += 1) {
    const top = Math.max(box.y, sheet * g.height);
    const bottom = Math.min(box.y + box.h, (sheet + 1) * g.height);
    pieces.push({ sheet, rect: { x: box.x, y: top, w: box.w, h: Math.max(0, bottom - top) } });
  }
  return pieces;
}

/** How many sheets a page needs: one for each full or partial sheet that any bottom edge reaches, at least 1. */
export function sheetCount(g: SheetGeometry, bottoms: readonly number[]): number {
  const lowest = bottoms.reduce((max, y) => Math.max(max, y), 0);
  return Math.max(1, Math.ceil((lowest - EPS) / g.height));
}

/**
 * The sheets a page has once something is written at `y`. Writing below the last sheet adds the sheet it falls on, and
 * any between, each with the same background, so the pen never draws into the gap where no paper is.
 */
export function sheetsAfterWriting(g: SheetGeometry, sheets: number, y: number): number {
  return Math.max(sheets, sheetAt(g, y) + 1);
}

/** The y for "Move below page break": the top of the content box of the sheet after the one the box starts on. */
export function belowBreak(g: SheetGeometry, box: Rect): number {
  return contentTop(g, sheetSpan(g, box).first + 1);
}

/** The smallest box that holds the points, grown by half the pen width. Returns null for no points. */
export function inkBounds(points: readonly { readonly x: number; readonly y: number }[], width: number): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = Math.max(0, width) / 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}
