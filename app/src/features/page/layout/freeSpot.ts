// Free space on a freeform page: where a new floating block can go without covering the title or a block that is
// already there.
import type { MountedPage } from '../mount';

/** The gap kept between a new block and what it goes under. */
export const KEEP_BELOW = 24;

/** The size of a new block's footprint that must not land on a block already there (a file card, a small picture). */
const FOOTPRINT = { w: 320, h: 96 };

/** `y`, or the first y below the blocks that a block at `x`, `y` would cover, so a new block never hides one. */
export function clearOfBlocks(
  mounted: Pick<MountedPage, 'layer'>,
  x: number,
  y: number,
  footprint: { w: number; h: number } = FOOTPRINT,
): number {
  const boxes = mounted.layer
    .blocks()
    .map((block) => mounted.layer.view(block.id)?.measure())
    .filter((box): box is NonNullable<typeof box> => !!box && box.w > 0 && box.h > 0)
    .sort((a, b) => a.y - b.y);
  let top = y;
  for (const box of boxes) {
    const covers = box.x < x + footprint.w && box.x + box.w > x && box.y < top + footprint.h && box.y + box.h > top;
    if (covers) top = box.y + box.h + KEEP_BELOW;
  }
  return top;
}

/** The first world y under the title band, so a new block never covers the page title. */
export function belowTitle(mounted: Pick<MountedPage, 'title' | 'viewport'>): number {
  const band = mounted.title?.element.getBoundingClientRect();
  if (!band || band.height === 0) return 0;
  return mounted.viewport.toWorld(band.left, band.bottom).y + KEEP_BELOW;
}

/** The gap kept between a new box and the right edge of the page area. */
const EDGE_GAP = 8;

/**
 * `x`, moved left so a new box at least `w` wide ends inside the page area the viewport shows. A press near the
 * right edge would otherwise start a box that the edge cuts off. It never goes left of the area's left edge.
 */
export function insideView(mounted: Pick<MountedPage, 'viewport'>, x: number, w: number): number {
  const { viewport } = mounted.viewport;
  if (viewport.clientWidth === 0) return x;
  const rect = viewport.getBoundingClientRect();
  const left = mounted.viewport.toWorld(rect.left, rect.top).x;
  const right = mounted.viewport.toWorld(rect.left + viewport.clientWidth, rect.top).x;
  return Math.max(left, Math.min(x, right - w - EDGE_GAP));
}
