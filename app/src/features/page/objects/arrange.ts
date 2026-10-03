// Where z-order commands move a block (ARCHITECTURE.md section 6.5; owner WP3). Floating blocks draw in order key
// order, and handwriting stays on top: front is just below the first ink block, and nothing passes an ink block.
// Bring forward and Send backward step past one overlapping neighbor. The functions are pure, so tests cover them.
import type { BlockId, BlockJson, PageRect } from '../../../services/pages/types';
import { byOrder } from '../readingOrder/order';

export type ArrangeKind = 'bringToFront' | 'sendToBack' | 'bringForward' | 'sendBackward';

const floating = (block: BlockJson) => block.frame?.x !== undefined && block.frame?.y !== undefined;

function overlaps(a: PageRect, b: PageRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The floating, non-ink blocks below the first ink block, bottom first. */
function stack(blocks: readonly BlockJson[]): BlockJson[] {
  const sorted = [...blocks].filter(floating).sort(byOrder);
  const ink = sorted.findIndex((block) => block.type === 'ink');
  return (ink < 0 ? sorted : sorted.slice(0, ink)).filter((block) => block.type !== 'ink');
}

/**
 * The place a moveBlock gives `id` for `kind`, or null when it is already there. `rect` gives each block's
 * rectangle, for the overlap that Bring forward and Send backward step past.
 */
export function arrangeTarget(
  kind: ArrangeKind,
  id: BlockId,
  blocks: readonly BlockJson[],
  rect: (id: BlockId) => PageRect | null,
): { after?: BlockId; before?: BlockId } | null {
  const order = stack(blocks);
  const at = order.findIndex((block) => block.id === id);
  if (at < 0) return null;
  if (kind === 'bringToFront') return at === order.length - 1 ? null : { after: order.at(-1)!.id };
  if (kind === 'sendToBack') return at === 0 ? null : { before: order[0]!.id };
  const own = rect(id);
  const step = kind === 'bringForward' ? 1 : -1;
  for (let i = at + step; i >= 0 && i < order.length; i += step) {
    const other = rect(order[i]!.id);
    if (own && other && !overlaps(own, other)) continue;
    return step > 0 ? { after: order[i]!.id } : { before: order[i]!.id };
  }
  return null;
}

/** Whether `kind` would move the block: the menu disables it at the ends. */
export function canArrange(kind: ArrangeKind, id: BlockId, blocks: readonly BlockJson[]): boolean {
  const order = stack(blocks);
  const at = order.findIndex((block) => block.id === id);
  if (at < 0) return false;
  return kind === 'bringToFront' || kind === 'bringForward' ? at < order.length - 1 : at > 0;
}

/** A frame value rounded to 0.01 units and kept within spec 2.3's range. */
export function frameValue(value: number, min = 0): number {
  return Math.min(10_000_000, Math.max(min, Math.round(value * 100) / 100));
}
