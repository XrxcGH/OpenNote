import { describe, expect, it } from 'vitest';
import { pagesInScope } from './actions';
import { frameOf, handoutSlots, noteSpaceFrames, SHEET, sheetsOf } from './noteSpace';

describe('note space and handouts', () => {
  const pic = { x: 10, y: 20, w: 800, h: 600 };

  it('puts note space on the right, below, or both', () => {
    expect(noteSpaceFrames(pic, 'right')).toEqual([{ x: 810, y: 20, w: 480, h: 600 }]);
    expect(noteSpaceFrames(pic, 'bottom')).toEqual([{ x: 10, y: 620, w: 800, h: 300 }]);
    const both = noteSpaceFrames(pic, 'both');
    expect(both).toHaveLength(2);
    expect(both[1]).toEqual({ x: 10, y: 620, w: 1280, h: 300 });
  });

  it('reads a picture without a position as the top left corner', () => {
    expect(frameOf({ frame: { w: 400, h: 300 } })).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('lays out 3 slides to a sheet with lines beside each, inside the margins', () => {
    const slots = handoutSlots([16 / 9, 4 / 3, 16 / 9, 1], 3);
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.picture.x).toBe(SHEET.margin);
      expect(slot.lines.x).toBeGreaterThan(slot.picture.x + slot.picture.w);
      expect(slot.lines.x + slot.lines.w).toBe(SHEET.w - SHEET.margin);
      expect(slot.picture.y + slot.picture.h).toBeLessThanOrEqual(SHEET.h - SHEET.margin + 1);
    }
    expect(slots[0].picture.w / slots[0].picture.h).toBeCloseTo(16 / 9, 1);
  });

  it('lays out 2 to a sheet and survives a bad ratio', () => {
    const slots = handoutSlots([Number.NaN, 0], 2);
    expect(slots).toHaveLength(2);
    expect(slots[0].picture.w / slots[0].picture.h).toBeCloseTo(4 / 3, 1);
    expect(slots[1].picture.y).toBeGreaterThan(slots[0].picture.y);
  });

  it('splits pictures into sheets', () => {
    expect(sheetsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('chooses the pages of a scope', () => {
    const pages = ['a', 'b', 'c', 'd'];
    expect(pagesInScope(pages, { kind: 'all' }, 1)).toEqual(pages);
    expect(pagesInScope(pages, { kind: 'page' }, 2)).toEqual(['c']);
    expect(pagesInScope(pages, { kind: 'range', from: 3, to: 2 }, 0)).toEqual(['b', 'c']);
    expect(pagesInScope(pages, { kind: 'range', from: 3, to: 99 }, 0)).toEqual(['c', 'd']);
    expect(pagesInScope(pages, { kind: 'page' }, -1)).toEqual([]);
  });
});
