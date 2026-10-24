import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cellRect, dropSlot, gridLayout, indexAt, moveGridFocus, rangeBetween, visibleRange } from './grid';
import { clickSelection, dropPages, stepPages } from './order';

describe('the gallery grid', () => {
  it('fits as many columns as the narrowest cell allows, and stretches them to fill the width', () => {
    const wide = gridLayout({ width: 1000, count: 20 });
    expect(wide.columns).toBe(5);
    expect(wide.cellWidth * 5 + wide.gap * 4).toBeCloseTo(1000, 6);
    expect(gridLayout({ width: 300, count: 20 }).columns).toBe(1);
    expect(gridLayout({ width: 4000, count: 20 }).columns).toBe(8);
    expect(gridLayout({ width: 1000, count: 2 }).columns).toBe(2);
    expect(gridLayout({ width: 0, count: 3 }).columns).toBe(1);
  });

  it('is as tall as its rows, and empty for no pages', () => {
    const layout = gridLayout({ width: 500, count: 7, minCell: 100, gap: 10, aspect: 1.5, caption: 20 });
    expect(layout.columns).toBe(4);
    expect(layout.rows).toBe(2);
    expect(layout.height).toBeCloseTo(2 * layout.cellHeight + 10, 6);
    expect(gridLayout({ width: 500, count: 0 }).height).toBe(0);
  });

  it('places each cell on its row and column', () => {
    const layout = gridLayout({ width: 500, count: 7, minCell: 100, gap: 10 });
    expect(cellRect(layout, 0)).toMatchObject({ x: 0, y: 0 });
    const second = cellRect(layout, 5);
    expect(second.x).toBeCloseTo(layout.cellWidth + 10, 6);
    expect(second.y).toBeCloseTo(layout.cellHeight + 10, 6);
  });

  it('finds the cells to draw for a scroll position, with extra rows around them', () => {
    const layout = gridLayout({ width: 500, count: 100, minCell: 100, gap: 10 });
    expect(visibleRange(layout, 0, 300, 0)).toEqual({ first: 0, end: 4 * 2 });
    const { first, end } = visibleRange(layout, 1000, 300);
    expect(first % layout.columns).toBe(0);
    expect(first).toBeGreaterThan(0);
    expect(end).toBeLessThanOrEqual(100);
    expect(visibleRange(layout, 1e9, 300).end).toBe(100);
    expect(visibleRange(gridLayout({ width: 500, count: 0 }), 0, 300)).toEqual({ first: 0, end: 0 });
  });

  it('finds the cell under a point, and none in a gap or past the last cell', () => {
    const layout = gridLayout({ width: 500, count: 6, minCell: 100, gap: 10 });
    const r = cellRect(layout, 5);
    expect(indexAt(layout, r.x + 1, r.y + 1)).toBe(5);
    expect(indexAt(layout, r.x - 5, r.y + 1)).toBeNull();
    expect(indexAt(layout, cellRect(layout, 3).x + 1, cellRect(layout, 3).y + layout.cellHeight + 5)).toBeNull();
    expect(indexAt(layout, r.x + layout.cellWidth + layout.gap + 1, r.y + 1)).toBeNull();
    expect(indexAt(layout, -1, 0)).toBeNull();
  });

  it('drops before a cell in its left half and after it in its right half', () => {
    const layout = gridLayout({ width: 500, count: 6, minCell: 100, gap: 10 });
    const c1 = cellRect(layout, 1);
    expect(dropSlot(layout, c1.x + 5, c1.y + 5)).toBe(1);
    expect(dropSlot(layout, c1.x + c1.w - 5, c1.y + 5)).toBe(2);
    expect(dropSlot(layout, -50, -50)).toBe(0);
    expect(dropSlot(layout, 9999, 9999)).toBe(6);
    expect(dropSlot(gridLayout({ width: 500, count: 0 }), 5, 5)).toBe(0);
  });

  it('moves focus with the arrow keys and clamps at the ends', () => {
    const layout = gridLayout({ width: 500, count: 10, minCell: 100, gap: 10 });
    expect(layout.columns).toBe(4);
    expect(moveGridFocus(layout, 5, 'left')).toBe(4);
    expect(moveGridFocus(layout, 5, 'right')).toBe(6);
    expect(moveGridFocus(layout, 5, 'up')).toBe(1);
    expect(moveGridFocus(layout, 1, 'up')).toBe(0);
    expect(moveGridFocus(layout, 5, 'down')).toBe(9);
    expect(moveGridFocus(layout, 7, 'down')).toBe(9);
    expect(moveGridFocus(layout, 9, 'down')).toBe(9);
    expect(moveGridFocus(layout, 9, 'right')).toBe(9);
    expect(moveGridFocus(layout, 0, 'left')).toBe(0);
    expect(moveGridFocus(layout, 5, 'home')).toBe(0);
    expect(moveGridFocus(layout, 5, 'end')).toBe(9);
    expect(moveGridFocus(layout, 9, 'pageUp', 1)).toBe(5);
    expect(moveGridFocus(layout, 1, 'pageDown', 1)).toBe(5);
    expect(moveGridFocus(gridLayout({ width: 500, count: 0 }), 0, 'down')).toBe(-1);
  });

  it('lists a range of cells for shift-click in either direction', () => {
    expect(rangeBetween(2, 5)).toEqual([2, 3, 4, 5]);
    expect(rangeBetween(5, 2)).toEqual([2, 3, 4, 5]);
    expect(rangeBetween(3, 3)).toEqual([3]);
  });
});

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('reordering pages', () => {
  it('moves a page to a slot and names the page it now sits before', () => {
    expect(dropPages(ids, new Set(['a']), 3)).toEqual({ order: ['b', 'c', 'a', 'd', 'e', 'f'], beforeId: 'd' });
    expect(dropPages(ids, new Set(['f']), 0)).toEqual({ order: ['f', 'a', 'b', 'c', 'd', 'e'], beforeId: 'a' });
    expect(dropPages(ids, new Set(['b']), 6)).toEqual({ order: ['a', 'c', 'd', 'e', 'f', 'b'], beforeId: null });
  });

  it('gathers several pages at the slot, in the order they had', () => {
    expect(dropPages(ids, new Set(['e', 'b']), 3)).toEqual({ order: ['a', 'c', 'b', 'e', 'd', 'f'], beforeId: 'd' });
  });

  it('does nothing when the pages are already there', () => {
    expect(dropPages(ids, new Set(['c']), 2)).toBeNull();
    expect(dropPages(ids, new Set(['c']), 3)).toBeNull();
    expect(dropPages(ids, new Set(['x']), 3)).toBeNull();
    expect(dropPages(ids, new Set(['b', 'c']), 1)).toBeNull();
  });

  it('keeps every page, once, and the moved pages together and in order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.boolean(), { maxLength: 20 }),
        fc.integer({ min: -3, max: 30 }),
        (nums, flags, slot) => {
          const order = nums.map(String);
          const moving = new Set(order.filter((_, i) => flags[i]));
          const result = dropPages(order, moving, slot);
          if (result === null) return;
          expect([...result.order].sort()).toEqual([...order].sort());
          const at = result.order.map((id, i) => (moving.has(id) ? i : -1)).filter((i) => i >= 0);
          expect(at[at.length - 1] - at[0]).toBe(at.length - 1);
          expect(result.order.filter((id) => moving.has(id))).toEqual(order.filter((id) => moving.has(id)));
          const after = result.order[at[at.length - 1] + 1] ?? null;
          expect(result.beforeId).toBe(after);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('moves selected pages up and down one place, and stops at the ends', () => {
    expect(stepPages(ids, new Set(['c']), 'up')?.order).toEqual(['a', 'c', 'b', 'd', 'e', 'f']);
    expect(stepPages(ids, new Set(['c']), 'down')?.order).toEqual(['a', 'b', 'd', 'c', 'e', 'f']);
    expect(stepPages(ids, new Set(['c', 'd']), 'down')?.order).toEqual(['a', 'b', 'e', 'c', 'd', 'f']);
    expect(stepPages(ids, new Set(['a']), 'up')).toBeNull();
    expect(stepPages(ids, new Set(['f']), 'down')).toBeNull();
    expect(stepPages(ids, new Set(), 'up')).toBeNull();
  });
});

describe('selecting pages', () => {
  it('replaces, toggles, and extends from the anchor', () => {
    const one = clickSelection(ids, new Set(), null, 'b', 'replace');
    expect([...one.selected]).toEqual(['b']);
    const toggled = clickSelection(ids, one.selected, one.anchor, 'd', 'toggle');
    expect([...toggled.selected].sort()).toEqual(['b', 'd']);
    expect([...clickSelection(ids, toggled.selected, toggled.anchor, 'd', 'toggle').selected]).toEqual(['b']);
    const range = clickSelection(ids, one.selected, one.anchor, 'e', 'extend');
    expect([...range.selected]).toEqual(['b', 'c', 'd', 'e']);
    expect(range.anchor).toBe('b');
    expect([...clickSelection(ids, new Set(), null, 'c', 'extend').selected]).toEqual(['c']);
  });
});
