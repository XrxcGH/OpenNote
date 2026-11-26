// The dependency graph of a page's formulas (ADR 0065). Every formula ("unit") registers the blocks of cells it
// reads. For each column of each table the graph keeps an interval index, so the readers of a changed cell or block
// are found in logarithmic time. A graph is forked for every edit: a fork shares every column it does not change, so
// an edit that changes no formula copies nothing.

import { IntervalIndex, type Interval } from './intervals';

export { IntervalIndex, type Interval } from './intervals';
export { stronglyConnected } from './tarjan';

/** A block of cells in table `s`: rows r1 to r2 and columns c1 to c2. Indexes start at 0; both ends are inside. */
export interface Box {
  readonly s: number;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/** What one unit reads, as registered in the graph. */
export interface Read extends Box {
  readonly blocker?: boolean;
}

const key = (s: number, c: number): number => s * 65536 + c;

/**
 * The readers of one column: reads of single cells by row, which most formulas are, and an interval index of the
 * reads of more than one row.
 */
class ColumnIndex {
  private readonly points = new Map<number, Interval[]>();
  private readonly ranges: IntervalIndex | null;

  constructor(entries: readonly Interval[]) {
    const spans: Interval[] = [];
    for (const entry of entries) {
      if (entry.from !== entry.to) {
        spans.push(entry);
        continue;
      }
      const list = this.points.get(entry.from);
      if (list) list.push(entry);
      else this.points.set(entry.from, [entry]);
    }
    this.ranges = spans.length > 0 ? new IntervalIndex(spans) : null;
  }

  units(from: number, to: number, typed: boolean, visit: (unit: number) => void): void {
    const pass = (list: readonly Interval[] | undefined): void => {
      if (list) for (const entry of list) if (typed || entry.blocker !== true) visit(entry.unit);
    };
    if (from === to) pass(this.points.get(from));
    else if (to - from < this.points.size) for (let r = from; r <= to; r++) pass(this.points.get(r));
    else for (const [row, list] of this.points) if (row >= from && row <= to) pass(list);
    this.ranges?.units(from, to, typed, visit);
  }
}

export class Graph {
  private entries: Map<number, Interval[]>;
  private indexes: Map<number, ColumnIndex>;
  /** Columns whose entry list this graph may change in place. */
  private readonly own = new Set<number>();
  /** What each unit reads, so it can be taken out again. */
  private reads: Map<number, readonly Read[]>;
  private ownReads = false;

  constructor(from?: Graph) {
    this.entries = from ? new Map(from.entries) : new Map();
    this.indexes = from ? new Map(from.indexes) : new Map();
    this.reads = from ? from.reads : new Map();
  }

  /** A copy that shares everything until it changes. */
  fork(): Graph {
    // From now on both graphs share every list, so neither may change one in place.
    this.own.clear();
    this.ownReads = false;
    return new Graph(this);
  }

  readsOf(unit: number): readonly Read[] {
    return this.reads.get(unit) ?? [];
  }

  private entryList(k: number): Interval[] {
    let list = this.entries.get(k);
    if (!this.own.has(k)) {
      list = list ? [...list] : [];
      this.entries.set(k, list);
      this.own.add(k);
    }
    this.indexes.delete(k);
    return list!;
  }

  private readMap(): Map<number, readonly Read[]> {
    if (!this.ownReads) {
      this.reads = new Map(this.reads);
      this.ownReads = true;
    }
    return this.reads;
  }

  /** Registers what a unit reads, replacing what it read before. */
  setReads(unit: number, reads: readonly Read[]): void {
    this.removeUnit(unit);
    if (reads.length === 0) return;
    this.readMap().set(unit, reads);
    for (const read of reads) {
      for (let c = read.c1; c <= read.c2; c++) {
        const entry: Interval = read.blocker
          ? { from: read.r1, to: read.r2, unit, blocker: true }
          : { from: read.r1, to: read.r2, unit };
        this.entryList(key(read.s, c)).push(entry);
      }
    }
  }

  /** Takes a unit out of the graph. */
  removeUnit(unit: number): void {
    const old = this.reads.get(unit);
    if (old === undefined) return;
    this.readMap().delete(unit);
    const columns = new Set<number>();
    for (const read of old) for (let c = read.c1; c <= read.c2; c++) columns.add(key(read.s, c));
    for (const k of columns) {
      const list = this.entryList(k);
      let w = 0;
      for (const entry of list) if (entry.unit !== unit) list[w++] = entry;
      list.length = w;
    }
  }

  private index(k: number): ColumnIndex | undefined {
    let index = this.indexes.get(k);
    if (index === undefined) {
      const list = this.entries.get(k);
      if (list === undefined || list.length === 0) return undefined;
      index = new ColumnIndex(list);
      this.indexes.set(k, index);
    }
    return index;
  }

  /**
   * Calls `visit` with every unit that reads a cell of `box`. Blockers are included only with `typed`, for a change
   * a person made rather than a formula's own result. A unit may be visited more than once.
   */
  readers(box: Box, typed: boolean, visit: (unit: number) => void): void {
    for (let c = box.c1; c <= box.c2; c++) this.readersIn(box.s, c, box.r1, box.r2, typed, visit);
  }

  /** The readers of rows `r1` to `r2` of one column. */
  readersIn(s: number, c: number, r1: number, r2: number, typed: boolean, visit: (unit: number) => void): void {
    this.index(key(s, c))?.units(r1, r2, typed, visit);
  }
}
