// Where each mark range opens and closes (SPEC 7.7). Marks nest in a fixed order, outermost first. Where two ranges
// overlap, the mark that comes later in the order is closed and reopened. A mark stays open across leaves as long
// as every mark outside it does too.
import type { Mark } from '@tiptap/pm/model';
import { wrapping } from './leaves';
import type { Leaf } from './leaves';

export interface Range {
  readonly mark: Mark;
  /** The boundary before the first leaf of the range. Boundary `i` lies just before leaf `i`. */
  readonly open: number;
  close: number;
}

export interface Boundary {
  /** Ranges that end here, innermost first. */
  closes: Range[];
  /** Ranges that start here, outermost first. */
  opens: Range[];
}

export interface Plan {
  readonly ranges: Range[];
  readonly boundaries: Boundary[];
}

export function planRanges(leaves: readonly Leaf[]): Plan {
  const boundaries: Boundary[] = Array.from({ length: leaves.length + 1 }, () => ({ closes: [], opens: [] }));
  const ranges: Range[] = [];
  let stack: Range[] = [];
  for (let at = 0; at <= leaves.length; at++) {
    const target = wrapping(leaves[at]);
    let keep = 0;
    while (keep < stack.length && keep < target.length && stack[keep].mark.eq(target[keep])) keep++;
    for (const range of stack.slice(keep).reverse()) {
      range.close = at;
      boundaries[at].closes.push(range);
    }
    const opened = target.slice(keep).map((mark): Range => ({ mark, open: at, close: -1 }));
    boundaries[at].opens.push(...opened);
    ranges.push(...opened);
    stack = [...stack.slice(0, keep), ...opened];
  }
  return { ranges, boundaries };
}
