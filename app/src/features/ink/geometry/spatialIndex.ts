// A uniform grid that finds the boxes near a query box. Each item sits in every cell its box touches, so a search
// reads only the cells under the query. Items that would fill too many cells go in one short list instead.

import { intersects } from './bounds';
import type { Bounds } from './types';

/** What the index holds for one item: its id, its box, and the value the caller stored with it. */
export interface SpatialEntry<T> {
  readonly id: string;
  readonly bounds: Bounds;
  readonly value: T;
}

export interface SpatialIndex<T> {
  readonly size: number;
  insert(id: string, bounds: Bounds, value: T): void;
  /** Removes an item and returns whether it was there. */
  remove(id: string): boolean;
  /** Moves an item to new bounds, inserting it if it is new. */
  update(id: string, bounds: Bounds, value: T): void;
  has(id: string): boolean;
  /** Every item whose box meets the query box. */
  search(query: Bounds): SpatialEntry<T>[];
}

interface Item<T> extends SpatialEntry<T> {
  /** The grid cells holding the item, or null for an item on the large list. */
  readonly cells: number[] | null;
  stamp: number;
}

interface CellSpan {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export const DEFAULT_CELL_SIZE = 128;
/** An item covering more cells than this goes on the large list. */
const MAX_CELLS_PER_ITEM = 64;
/** A search covering more cells than this scans every item instead. */
const MAX_CELLS_PER_SEARCH = 4096;
const ROW_STRIDE = 2_000_001;
const ROW_LIMIT = 1_000_000;

const cellCount = (s: CellSpan) => (s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1);
const cellKey = (x: number, y: number) => x * ROW_STRIDE + y;

class GridIndex<T> implements SpatialIndex<T> {
  private readonly items = new Map<string, Item<T>>();
  private readonly grid = new Map<number, Item<T>[]>();
  private readonly large = new Set<Item<T>>();
  private stamp = 0;

  constructor(private readonly cellSize: number) {}

  get size(): number {
    return this.items.size;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  update(id: string, bounds: Bounds, value: T): void {
    this.insert(id, bounds, value);
  }

  insert(id: string, bounds: Bounds, value: T): void {
    this.remove(id);
    const span = this.span(bounds);
    if (cellCount(span) > MAX_CELLS_PER_ITEM) {
      const item: Item<T> = { id, bounds, value, cells: null, stamp: 0 };
      this.items.set(id, item);
      this.large.add(item);
      return;
    }
    const cells: number[] = [];
    const item: Item<T> = { id, bounds, value, cells, stamp: 0 };
    for (let x = span.x0; x <= span.x1; x++) {
      for (let y = span.y0; y <= span.y1; y++) {
        const key = cellKey(x, y);
        cells.push(key);
        const list = this.grid.get(key);
        if (list) list.push(item);
        else this.grid.set(key, [item]);
      }
    }
    this.items.set(id, item);
  }

  remove(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    if (!item.cells) this.large.delete(item);
    for (const key of item.cells ?? []) {
      const list = this.grid.get(key)!;
      list.splice(list.indexOf(item), 1);
      if (list.length === 0) this.grid.delete(key);
    }
    return true;
  }

  search(query: Bounds): SpatialEntry<T>[] {
    const found: SpatialEntry<T>[] = [];
    const visit = (item: Item<T>) => {
      if (item.stamp === this.stamp || !intersects(item.bounds, query)) return;
      item.stamp = this.stamp;
      found.push(item);
    };
    const span = this.span(query);
    this.stamp++;
    if (cellCount(span) > MAX_CELLS_PER_SEARCH) {
      this.items.forEach(visit);
      return found;
    }
    for (let x = span.x0; x <= span.x1; x++) {
      for (let y = span.y0; y <= span.y1; y++) this.grid.get(cellKey(x, y))?.forEach(visit);
    }
    this.large.forEach(visit);
    return found;
  }

  private span(b: Bounds): CellSpan {
    const size = this.cellSize;
    return {
      x0: Math.floor(b.minX / size),
      x1: Math.floor(b.maxX / size),
      y0: Math.max(-ROW_LIMIT, Math.floor(b.minY / size)),
      y1: Math.min(ROW_LIMIT, Math.floor(b.maxY / size)),
    };
  }
}

export function createSpatialIndex<T>(cellSize: number = DEFAULT_CELL_SIZE): SpatialIndex<T> {
  return new GridIndex<T>(cellSize);
}
