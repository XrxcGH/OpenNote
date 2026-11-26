// Merged cells by their corner cells' IDs (format spec R-SHT-12, DESIGN 3.6). A merge covers the rows and columns
// between its corners in the table's current order, so inserting a row inside it makes it taller with no change to
// the file. Deleting a corner's row or column moves that corner to the nearest row or column left inside the merge.

import { boxOf, cornersOf, gridOf, isCorner, isSingle, type Box, type Grid } from './grid';
import { isObject, own, ownObject, put, sortedKeys } from './json';
import type { Sheet, TableLike } from './types';

export const MERGE_LIMIT = 10_000;

export interface ActiveMerge {
  id: string;
  box: Box;
}

/**
 * Disjoint boxes indexed by row: for each row, the column spans the boxes cover there, sorted by left edge. Spans of
 * one row never overlap, so their right edges are sorted too, and an overlap test is a binary search per row. Adding
 * a box costs one sorted insert per row it covers, so a table's merges cost at most one entry per covered cell.
 */
export class BoxIndex {
  private readonly byRow = new Map<number, { left: number[]; right: number[]; id: string[] }>();

  /** The first span of a row whose right edge is at or after `col`, as an index into the row's arrays. */
  private static firstFrom(right: readonly number[], col: number): number {
    let lo = 0;
    let hi = right.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (right[mid] < col) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** True when a box of the index overlaps `box`. */
  overlaps(box: Box): boolean {
    for (let row = box.top; row <= box.bottom; row++) {
      const spans = this.byRow.get(row);
      if (!spans) continue;
      const at = BoxIndex.firstFrom(spans.right, box.left);
      if (at < spans.left.length && spans.left[at] <= box.right) return true;
    }
    return false;
  }

  /** Adds a box that overlaps none of the index. */
  add(id: string, box: Box): void {
    for (let row = box.top; row <= box.bottom; row++) {
      let spans = this.byRow.get(row);
      if (!spans) {
        spans = { left: [], right: [], id: [] };
        this.byRow.set(row, spans);
      }
      const at = BoxIndex.firstFrom(spans.right, box.left);
      spans.left.splice(at, 0, box.left);
      spans.right.splice(at, 0, box.right);
      spans.id.splice(at, 0, id);
    }
  }

  /** The ID of the box that covers a cell, or undefined. */
  at(row: number, col: number): string | undefined {
    const spans = this.byRow.get(row);
    if (!spans) return undefined;
    const at = BoxIndex.firstFrom(spans.right, col);
    return at < spans.left.length && spans.left[at] <= col ? spans.id[at] : undefined;
  }
}

/** The active merges of a sheet, in ID order, with an index for overlap tests and lookups by cell. */
export interface MergeSet {
  list: ActiveMerge[];
  index: BoxIndex;
  /** No ID below `m` and this number is free; IDs are only added while the set is in use. */
  nextFree: number;
  /** The entries of `merges` in the file, valid or not, which the limit counts. */
  stored: number;
}

/**
 * The merges a reader uses, in ID order: valid, larger than one cell, and not overlapping a merge with a lower ID
 * (two devices merged at once). The others are kept in the file and ignored.
 */
export function activeMerges(sheet: Sheet, table: TableLike): ActiveMerge[] {
  return mergeSet(sheet, table).list;
}

/** The active merges with their index. Pass it to addMerge when adding many merges in a row. */
export function mergeSet(sheet: Sheet, table: TableLike): MergeSet {
  const merges = ownObject(sheet, 'merges');
  const set: MergeSet = { list: [], index: new BoxIndex(), nextFree: 1, stored: Object.keys(merges ?? {}).length };
  if (!merges) return set;
  const grid = gridOf(table);
  for (const id of sortedKeys(merges)) {
    const merge = merges[id];
    const box = boxOf(grid, own(merge, 'from'), own(merge, 'to'));
    if (!box || isSingle(box) || set.index.overlaps(box)) continue;
    set.list.push({ id, box });
    set.index.add(id, box);
  }
  return set;
}

/** The active merge that covers a cell, or undefined. */
export function mergeAt(merges: readonly ActiveMerge[], row: number, col: number): ActiveMerge | undefined {
  return merges.find(({ box }) => row >= box.top && row <= box.bottom && col >= box.left && col <= box.right);
}

export type MergeRefusal = 'single' | 'overlap' | 'limit' | 'missing';

/** A free merge ID: `m` and the lowest number not in use, starting the search at `from`. */
function freeId(merges: Record<string, unknown>, from = 1): number {
  for (let n = from; ; n++) if (!Object.hasOwn(merges, `m${n}`)) return n;
}

/**
 * Merges the box between two cells. Changes `sheet` in place and returns the new merge's ID. It refuses a box of one
 * cell, a box that overlaps an active merge, a corner that is not in the table, and a merge past the limit. For a
 * batch, give each call the same set from mergeSet as `active`. Each call keeps that set current.
 */
export function addMerge(
  sheet: Sheet,
  table: TableLike,
  from: [string, string],
  to: [string, string],
  active: MergeSet = mergeSet(sheet, table),
): { id: string } | { refused: MergeRefusal } {
  const grid = gridOf(table);
  const box = boxOf(grid, from, to);
  if (!box) return { refused: 'missing' };
  if (isSingle(box)) return { refused: 'single' };
  if (active.index.overlaps(box)) return { refused: 'overlap' };
  const merges = ownObject(sheet, 'merges') ?? {};
  if (active.stored >= MERGE_LIMIT) return { refused: 'limit' };
  const n = freeId(merges, active.nextFree);
  const id = `m${n}`;
  active.nextFree = n + 1;
  active.stored++;
  put(merges, id, cornersOf(grid, box));
  put(sheet, 'merges', merges);
  active.list.push({ id, box });
  active.index.add(id, box);
  return { id };
}

/** Removes a merge. Changes `sheet` in place. */
export function removeMerge(sheet: Sheet, id: string): void {
  const merges = ownObject(sheet, 'merges');
  if (!merges) return;
  delete merges[id];
  if (Object.keys(merges).length === 0) delete sheet.merges;
}

/**
 * The position in `after` of the nearest line from `start` toward `end` (both positions in `before`) that is still
 * in the table, or undefined when every line between them is gone.
 */
function nearest(before: string[], after: Map<string, number>, start: number, end: number): number | undefined {
  const step = end >= start ? 1 : -1;
  for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
    const at = after.get(before[i]);
    if (at !== undefined) return at;
  }
  return undefined;
}

/**
 * The box of corners `from` and `to` after rows or columns were deleted: each corner whose row or column is gone
 * moves toward the other corner, to the nearest line still there. Null when nothing of the box is left.
 */
export function moveCorners(before: Grid, after: Grid, from: [string, string], to: [string, string]): Box | null {
  const old = boxOf(before, from, to);
  if (!old) return boxOf(after, from, to);
  const top = nearest(before.rows, after.rowAt, old.top, old.bottom);
  const bottom = nearest(before.rows, after.rowAt, old.bottom, old.top);
  const left = nearest(before.cols, after.colAt, old.left, old.right);
  const right = nearest(before.cols, after.colAt, old.right, old.left);
  if (top === undefined || bottom === undefined || left === undefined || right === undefined) return null;
  return { top, bottom, left, right };
}

/** True when both corners' rows and columns are still in the table, so the corners need no change. */
export function stillThere(grid: Grid, from: [string, string], to: [string, string]): boolean {
  return grid.rowAt.has(from[0]) && grid.rowAt.has(to[0]) && grid.colAt.has(from[1]) && grid.colAt.has(to[1]);
}

/**
 * Brings the merges up to date after a structure change from `before` to `after` (DESIGN 3.6). Corners of deleted
 * rows and columns move inward. A merge with nothing left, or with one cell left, is removed. So is a merge that
 * overlaps an active merge with a lower ID, since writers never write overlaps. Changes `sheet` in place.
 */
export function repairMerges(sheet: Sheet, before: TableLike, after: TableLike): void {
  const merges = ownObject(sheet, 'merges');
  if (!merges) return;
  const was = gridOf(before);
  const now = gridOf(after);
  const kept = new BoxIndex();
  for (const id of sortedKeys(merges)) {
    const merge = merges[id];
    const from = own(merge, 'from');
    const to = own(merge, 'to');
    if (!isObject(merge) || !isCorner(from) || !isCorner(to)) continue;
    const box = moveCorners(was, now, from, to);
    if (!box || isSingle(box) || kept.overlaps(box)) {
      delete merges[id];
      continue;
    }
    kept.add(id, box);
    if (stillThere(now, from, to)) continue;
    const corners = cornersOf(now, box);
    put(merge, 'from', corners.from);
    put(merge, 'to', corners.to);
  }
  if (Object.keys(merges).length === 0) delete sheet.merges;
}
