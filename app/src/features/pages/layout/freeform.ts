// The sheets of a freeform page. Floating blocks and ink keep their coordinates, so planning is only a question of
// which sheets each box touches. A box across a sheet edge is drawn on both sheets, clipped at each edge.

import { sheetCount, sheetPieces, sheetSpan, type SheetSpan } from '../pagination/freeform';
import type { Rect, SheetGeometry } from '../pagination/geometry';

/** A block or the ink layer, as the box it covers in page coordinates. */
export interface FloatingItem {
  readonly id: string;
  readonly rect: Rect;
}

export interface FloatingSlice {
  readonly id: string;
  readonly sheet: number;
  /** The part of the item on that sheet, in page coordinates. */
  readonly rect: Rect;
}

export interface FloatingPlan {
  /** How many sheets the items need, at least 1. */
  readonly sheets: number;
  /** Where each item sits, by ID. */
  readonly spans: ReadonlyMap<string, SheetSpan>;
  /** The IDs of items across a sheet edge, which the interface offers to move below the break. */
  readonly crossing: readonly string[];
  /** The IDs of items that lie partly off the paper. */
  readonly offPaper: readonly string[];
}

export function planFloating(g: SheetGeometry, items: readonly FloatingItem[]): FloatingPlan {
  const spans = new Map<string, SheetSpan>();
  for (const item of items) spans.set(item.id, sheetSpan(g, item.rect));
  return {
    sheets: sheetCount(
      g,
      items.map((i) => i.rect.y + i.rect.h),
    ),
    spans,
    crossing: items.filter((i) => spans.get(i.id)?.crossesBreak).map((i) => i.id),
    offPaper: items.filter((i) => spans.get(i.id)?.offPaper).map((i) => i.id),
  };
}

/** The pieces of every item on each sheet, in the items' order. Every sheet up to `sheets` has an entry. */
export function floatingBySheet(g: SheetGeometry, items: readonly FloatingItem[], sheets: number): FloatingSlice[][] {
  const out = Array.from({ length: sheets }, (): FloatingSlice[] => []);
  for (const item of items) {
    for (const piece of sheetPieces(g, item.rect)) {
      if (piece.sheet < sheets) out[piece.sheet].push({ id: item.id, sheet: piece.sheet, rect: piece.rect });
    }
  }
  return out;
}
