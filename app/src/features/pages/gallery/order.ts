// Reordering pages in the gallery. The notes service places a page "before" another (or at the end), so these functions
// work out the new order and the page to place the moved ones before. Several pages move together and keep their order.

export interface Reorder {
  /** The whole order after the move. */
  readonly order: readonly string[];
  /** The page the moved pages now sit before, or null when they are last. It is the `beforeId` of the notes service. */
  readonly beforeId: string | null;
}

/**
 * Moves the `moving` pages into `slot`: an index into the current order, from 0 (first) to its length (last). The
 * moved pages gather at the slot in the order they already had. Returns null when nothing would change.
 */
export function dropPages(order: readonly string[], moving: ReadonlySet<string>, slot: number): Reorder | null {
  const chosen = order.filter((id) => moving.has(id));
  if (chosen.length === 0) return null;
  const clamped = Math.min(Math.max(Math.trunc(slot), 0), order.length);
  const before = order.slice(0, clamped).filter((id) => moving.has(id)).length;
  const rest = order.filter((id) => !moving.has(id));
  const at = clamped - before;
  const next = [...rest.slice(0, at), ...chosen, ...rest.slice(at)];
  if (next.every((id, i) => id === order[i])) return null;
  return { order: next, beforeId: rest[at] ?? null };
}

/** "Move up" and "Move down": the selected pages pass the page above or below them. */
export function stepPages(
  order: readonly string[],
  selected: ReadonlySet<string>,
  direction: 'up' | 'down',
): Reorder | null {
  const indexes = order.flatMap((id, i) => (selected.has(id) ? [i] : []));
  if (indexes.length === 0) return null;
  // Up goes to the slot before the page above the first selected one. Down goes past the page below the last one.
  const slot = direction === 'up' ? indexes[0] - 1 : indexes[indexes.length - 1] + 2;
  return dropPages(order, selected, slot);
}

/** A page-set selection after a click: plain replaces, ctrl toggles, and shift extends from the anchor. */
export function clickSelection(
  order: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  id: string,
  how: 'replace' | 'toggle' | 'extend',
): { selected: ReadonlySet<string>; anchor: string } {
  if (how === 'toggle') {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    return { selected: next, anchor: id };
  }
  if (how === 'extend' && anchor !== null && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
    return { selected: new Set(order.slice(a, b + 1)), anchor };
  }
  return { selected: new Set([id]), anchor: id };
}
