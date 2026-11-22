// Sorting through merged cells (ADR 0064): Excel refuses a sort of a range whose merges are not all the same size.
import type { TableData } from '../../../../editor/schema/specs';
import { mergeSet } from '../model/merges';
import { readSheet } from '../model/sheet';

/**
 * True when sorting the rows `from` to `to` (positions in `data.rows`) must be refused: a merge touches the range, and
 * the merges there are not all of one size, or one reaches out of the range. Sorting rows moves whole rows, so rows
 * that all carry the same merged shape stay valid.
 */
export function sortRefusal(data: TableData, stored: unknown, from: number, to: number): boolean {
  const merges = mergeSet(readSheet({ sheet: stored }), data).list;
  const touching = merges.filter((m) => m.box.bottom >= from && m.box.top <= to);
  if (touching.length === 0) return false;
  if (touching.some((m) => m.box.top < from || m.box.bottom > to)) return true;
  const key = (m: (typeof touching)[number]) => `${m.box.bottom - m.box.top}:${m.box.right - m.box.left}`;
  const first = key(touching[0]);
  return touching.some((m) => key(m) !== first);
}
