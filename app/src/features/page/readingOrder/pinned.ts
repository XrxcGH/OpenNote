// The pinned reorder (ARCHITECTURE.md section 20.1): puts a container's children in a new order with the fewest
// moves, and never moves the pinned child, the wrapper that holds focus or an editor in use. Every order can be
// reached by moving only the other children around it, so focus, the caret, and the object selection survive.

/** Indexes into `values` of a longest strictly increasing subsequence, all within (low, high). */
function increasing(values: readonly number[], low: number, high: number): number[] {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, index) => {
    if (value <= low || value >= high) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < value) lo = mid + 1;
      else hi = mid;
    }
    previous[index] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = index;
  });
  const out: number[] = [];
  for (let at = tails.at(-1) ?? -1; at >= 0; at = previous[at]!) out.unshift(at);
  return out;
}

/** The target ranks of the children that stay where they are: the longest run already in order, with the pin. */
function kept(ranks: readonly number[], pin: number): Set<number> {
  if (pin < 0) return new Set(increasing(ranks, -1, Infinity).map((index) => ranks[index]!));
  const pinned = ranks[pin]!;
  const before = increasing(ranks.slice(0, pin), -1, pinned).map((index) => ranks[index]!);
  const after = increasing(ranks.slice(pin + 1), pinned, Infinity).map((index) => ranks[pin + 1 + index]!);
  return new Set([...before, pinned, ...after]);
}

/**
 * Orders `container`'s children as `target`, which lists each child once. Children not in `target` keep their
 * places relative to nothing in particular; the block layer keeps none. Returns how many children moved.
 */
export function pinnedReorder(container: HTMLElement, target: readonly Element[], pinned: Element | null): number {
  const rank = new Map(target.map((element, index) => [element, index]));
  const current = [...container.children].filter((child) => rank.has(child));
  const ranks = current.map((child) => rank.get(child)!);
  const stay = kept(ranks, pinned ? current.indexOf(pinned) : -1);
  let next: Element | null = null;
  let moves = 0;
  for (let index = target.length - 1; index >= 0; index -= 1) {
    const element = target[index]!;
    if (!stay.has(index) || element.parentElement !== container) {
      container.insertBefore(element, next);
      moves += 1;
    }
    next = element;
  }
  return moves;
}
