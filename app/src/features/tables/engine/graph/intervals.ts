// A static interval index for one column: which formulas read which rows (ADR 0065). Entries are sorted by their
// first row and laid out as an implicit balanced tree, with the largest last row of every subtree. A query visits
// only subtrees that can hold a match, so finding the readers of a row costs O(log n + matches), not O(n).

/** One formula reading rows `from` to `to` (inclusive; Infinity for a whole column). */
export interface Interval {
  readonly from: number;
  readonly to: number;
  readonly unit: number;
  /**
   * A spill's claim on the cells it wants to fill. Typing into one of them must recalculate the spilling formula,
   * but the formula's own results there must not, or every spill would read itself.
   */
  readonly blocker?: boolean;
}

export class IntervalIndex {
  private readonly items: Interval[];
  private readonly maxTo: Float64Array;

  constructor(entries: readonly Interval[]) {
    this.items = [...entries].sort((a, b) => a.from - b.from);
    this.maxTo = new Float64Array(this.items.length);
    this.build(0, this.items.length - 1);
  }

  get size(): number {
    return this.items.length;
  }

  private build(lo: number, hi: number): number {
    if (lo > hi) return -Infinity;
    const mid = (lo + hi) >>> 1;
    const max = Math.max(this.items[mid].to, this.build(lo, mid - 1), this.build(mid + 1, hi));
    this.maxTo[mid] = max;
    return max;
  }

  /** Calls `visit` with the unit of every interval that shares a row with `from` to `to`, blockers only if `typed`. */
  units(from: number, to: number, typed: boolean, visit: (unit: number) => void): void {
    const { items, maxTo } = this;
    const stack: number[] = [0, items.length - 1];
    while (stack.length > 0) {
      const hi = stack.pop()!;
      let lo = stack.pop()!;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (maxTo[mid] < from) break;
        if (lo <= mid - 1) stack.push(lo, mid - 1);
        const item = items[mid];
        if (item.from > to) break;
        if (item.to >= from && (typed || item.blocker !== true)) visit(item.unit);
        lo = mid + 1;
      }
    }
  }

  /** Calls `visit` for every interval that shares a row with `from` to `to`. */
  overlapping(from: number, to: number, visit: (entry: Interval) => void): void {
    this.walk(0, this.items.length - 1, from, to, visit);
  }

  private walk(lo: number, hi: number, from: number, to: number, visit: (entry: Interval) => void): void {
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.maxTo[mid] < from) return;
      this.walk(lo, mid - 1, from, to, visit);
      const item = this.items[mid];
      if (item.from > to) return;
      if (item.to >= from) visit(item);
      lo = mid + 1;
    }
  }
}
