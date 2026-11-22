// Sorting through merged cells (ADR 0064): Excel refuses a sort of a range whose merges are not all the same size.
import type { TableData } from '../../../../editor/schema/specs';
import { mergeSet } from '../model/merges';
import { readSheet } from '../model/sheet';

/**
 * True when sorting the rows `from` to `to` (positions in `data.rows`) must be refused: a merge that spans more than one
 * row touches the range, or a merge reaches out of it. Sorting moves rows one by one, so a merge inside one row stays
 * valid, and a merge across rows would be pulled apart.
 */
export function sortRefusal(data: TableData, stored: unknown, from: number, to: number): boolean {
  const merges = mergeSet(readSheet({ sheet: stored }), data).list;
  return merges.some(
    (m) =>
      m.box.bottom >= from && m.box.top <= to && (m.box.top !== m.box.bottom || m.box.top < from || m.box.bottom > to),
  );
}
