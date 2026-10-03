// A page's reading order (ARCHITECTURE.md section 20.1, spec 6.2; owner WP3). The blocks of view.readingOrder come
// first, in that order, skipping IDs that name no block or repeat. Then flowing blocks follow in order key order,
// and floating blocks follow in rows. A row takes the floating blocks up to 8 units below its first block, read
// left to right. Ties go by order key, then by ID. The Rust core has the same function, and
// docs/format/fixtures/reading-order proves the two agree.
import type { BlockId, BlockJson } from '../../../services/pages/types';

/** Floating blocks whose tops are this close to a row's first block join that row. */
export const READING_ROW_UNITS = 8;

const floating = (block: BlockJson) => block.frame?.x !== undefined && block.frame?.y !== undefined;
const x = (block: BlockJson) => block.frame?.x ?? 0;
const y = (block: BlockJson) => block.frame?.y ?? 0;

/** Order key, then ID: the order of blocks that tie on everything else. */
export function byOrder(a: BlockJson, b: BlockJson): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function floatingRows(blocks: BlockJson[]): BlockJson[] {
  const sorted = [...blocks].sort((a, b) => y(a) - y(b) || x(a) - x(b) || byOrder(a, b));
  const out: BlockJson[] = [];
  let start = 0;
  while (start < sorted.length) {
    const top = y(sorted[start]!);
    let end = start;
    while (end < sorted.length && y(sorted[end]!) - top <= READING_ROW_UNITS) end += 1;
    out.push(...sorted.slice(start, end).sort((a, b) => x(a) - x(b) || y(a) - y(b) || byOrder(a, b)));
    start = end;
  }
  return out;
}

/** The IDs of `blocks` in reading order, with `preferred` (view.readingOrder) first. */
export function readingOrder(blocks: readonly BlockJson[], preferred: readonly BlockId[] = []): BlockId[] {
  const ids = new Set(blocks.map((block) => block.id));
  const seen = new Set<BlockId>();
  const out: BlockId[] = [];
  for (const id of preferred) {
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  const rest = blocks.filter((block) => !seen.has(block.id));
  out.push(
    ...rest
      .filter((block) => !floating(block))
      .sort(byOrder)
      .map((block) => block.id),
  );
  out.push(...floatingRows(rest.filter(floating)).map((block) => block.id));
  return out;
}

/** Moves `id` one place up or down in `order`. Returns the new order, or null at an end. */
export function moveInOrder(order: readonly BlockId[], id: BlockId, by: -1 | 1): BlockId[] | null {
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
