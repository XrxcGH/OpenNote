// Reading order (format spec 6.2), which every export follows: flowing blocks in order, then floating blocks by
// position in rows, with the page's own `readingOrder` list first. Screen readers, `page.md`, and the tags of an
// accessible PDF all read blocks in this order.

import { isFloating, type ExportBlock } from './source';

/** Floating blocks whose top edges are this close, in page units, read as one row. */
export const ROW_TOLERANCE = 8;

type Comparator = (a: ExportBlock, b: ExportBlock) => number;

const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const num = (a: number | undefined, b: number | undefined): number => (a ?? 0) - (b ?? 0);

/** Order key, then ID. Order keys are plain ASCII, so they compare by code unit. */
const byKey: Comparator = (a, b) => text(a.order, b.order) || text(a.id, b.id);
const byPosition: Comparator = (a, b) => num(a.frame?.y, b.frame?.y) || num(a.frame?.x, b.frame?.x) || byKey(a, b);
const leftToRight: Comparator = (a, b) => num(a.frame?.x, b.frame?.x) || num(a.frame?.y, b.frame?.y) || byKey(a, b);

/** The floating blocks in rows, each row left to right. */
function floatingRows(floating: readonly ExportBlock[]): ExportBlock[] {
  const sorted = [...floating].sort(byPosition);
  const out: ExportBlock[] = [];
  for (let i = 0; i < sorted.length;) {
    const top = sorted[i].frame?.y ?? 0;
    let end = i + 1;
    while (end < sorted.length && (sorted[end].frame?.y ?? 0) <= top + ROW_TOLERANCE) end += 1;
    out.push(...sorted.slice(i, end).sort(leftToRight));
    i = end;
  }
  return out;
}

/**
 * The blocks in reading order. `preferred` is the page's `view.readingOrder`: its blocks come first, in its order,
 * and IDs that name no block or repeat are ignored.
 */
export function readingOrder(blocks: readonly ExportBlock[], preferred: readonly string[] = []): ExportBlock[] {
  const flowing = blocks.filter((b) => !isFloating(b)).sort(byKey);
  const natural = [...flowing, ...floatingRows(blocks.filter(isFloating))];
  if (preferred.length === 0) return natural;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const first = [...new Set(preferred)].flatMap((id) => byId.get(id) ?? []);
  const listed = new Set(first.map((b) => b.id));
  return [...first, ...natural.filter((b) => !listed.has(b.id))];
}
