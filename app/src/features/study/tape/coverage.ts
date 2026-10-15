// Which blocks of the shown page each study tape sits over (Study tools). A block counts as covered when at least half
// of its area is under the tape, measured on the screen, so flowing text is found as well as floating blocks.

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const COVERED = 0.5;

/** The share of `inner` that lies inside `outer`, from 0 to 1. */
export function shareInside(inner: Box, outer: Box): number {
  const area = (inner.right - inner.left) * (inner.bottom - inner.top);
  if (area <= 0) return 0;
  const w = Math.min(inner.right, outer.right) - Math.max(inner.left, outer.left);
  const h = Math.min(inner.bottom, outer.bottom) - Math.max(inner.top, outer.top);
  return w > 0 && h > 0 ? (w * h) / area : 0;
}

/** For each tape on the page, the blocks it covers, plus the tapes in top-to-bottom reading order. */
export function measureTape(
  root: ParentNode,
  tapeIds: readonly string[],
): { covered: Map<string, string[]>; order: string[] } {
  const items = [...root.querySelectorAll<HTMLElement>('[data-block-id]')].map((el) => ({
    id: el.dataset.blockId ?? '',
    box: el.getBoundingClientRect(),
  }));
  const tapes = items.filter((i) => tapeIds.includes(i.id));
  const covered = new Map<string, string[]>();
  for (const tape of tapes) {
    const ids = items
      .filter((i) => !tapeIds.includes(i.id) && shareInside(i.box, tape.box) >= COVERED)
      .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
      .map((i) => i.id);
    covered.set(tape.id, ids);
  }
  const order = tapes.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left).map((t) => t.id);
  return { covered, order };
}
