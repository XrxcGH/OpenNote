import { describe, expect, it } from 'vitest';
import type { TabStop } from '../../../editor/paragraph/attributes';
import {
  defaultStops,
  dragValue,
  markerLimits,
  movedIndent,
  movedTab,
  pixelsToPoints,
  withTab,
  withoutTab,
} from './geometry';
import { defaultUnit, fromPoints, shownNumber, snapPoints, toPoints } from './units';

describe('ruler arithmetic', () => {
  it('a CSS pixel is 0.75 point, and zoom divides it', () => {
    expect(pixelsToPoints(48, 1)).toBe(36);
    expect(pixelsToPoints(48, 2)).toBe(18);
    expect(pixelsToPoints(48, 0.5)).toBe(72);
  });

  it('snaps to 1/16 inch (4.5 pt) or 0.25 cm, and free drags keep a twentieth of a point', () => {
    expect(dragValue(0, 10, 1, snapPoints('in'), false)).toBe(9);
    expect(dragValue(0, 10, 1, snapPoints('in'), true)).toBe(7.5);
    expect(dragValue(0, 10, 1, snapPoints('cm'), false)).toBe(7.1);
  });

  it('converts units by their definitions', () => {
    expect(toPoints(1, 'in')).toBe(72);
    expect(toPoints(1, 'pc')).toBe(12);
    expect(fromPoints(72 / 2.54, 'cm')).toBeCloseTo(1, 12);
    expect(shownNumber(36, 'in')).toBe('0.5');
    expect(shownNumber(36, 'pt')).toBe('36');
    expect(shownNumber(72, 'cm')).toBe('2.54');
  });

  it('starts in inches in the United States and centimeters elsewhere', () => {
    expect(defaultUnit('en-US')).toBe('in');
    expect(defaultUnit('de-DE')).toBe('cm');
    expect(defaultUnit('en-GB')).toBe('cm');
  });
});

describe('moving markers', () => {
  const indent = { start: 36, end: 0, first: 0 };

  it('first line changes only first; hanging keeps the first line; left moves both', () => {
    expect(movedIndent('first', indent, 72, 468)).toEqual({ start: 36, end: 0, first: 36 });
    expect(movedIndent('hanging', indent, 72, 468)).toEqual({ start: 72, end: 0, first: -36 });
    expect(movedIndent('left', indent, 72, 468)).toEqual({ start: 72, end: 0, first: 0 });
    expect(movedIndent('right', indent, 48, 468)).toEqual({ start: 36, end: 48, first: 0 });
  });

  it('keeps a stop list sorted, replaces a stop in the same place, and stops at 64', () => {
    const base: TabStop[] = [{ pos: 72, align: 'start', leader: 'none' }];
    const added = withTab(base, { pos: 36, align: 'end', leader: 'none' });
    expect(added?.map((s) => s.pos)).toEqual([36, 72]);
    expect(withTab(base, { pos: 72, align: 'center', leader: 'none' })).toEqual([
      { pos: 72, align: 'center', leader: 'none' },
    ]);
    const full = Array.from({ length: 64 }, (_, i) => ({ pos: i * 10, align: 'start', leader: 'none' }) as TabStop);
    expect(withTab(full, { pos: 645, align: 'start', leader: 'none' })).toBeNull();
  });

  it('a moved stop keeps its type and leader; a removed one is gone', () => {
    const stops: TabStop[] = [{ pos: 72, align: 'decimal', leader: 'dot' }];
    expect(movedTab(stops, 72, 144)).toEqual([{ pos: 144, align: 'decimal', leader: 'dot' }]);
    expect(withoutTab(stops, 72)).toEqual([]);
  });
});

describe('marker limits', () => {
  it('no marker passes another: the column keeps 1/16 inch', () => {
    const indent = { start: 216, end: 0, first: 36 };
    expect(markerLimits('right', indent, 468).min).toBe(252 + 4.5);
    expect(markerLimits('left', { start: 0, end: 72, first: 18 }, 468).max).toBe(468 - 72 - 4.5 - 18);
    expect(markerLimits('first', { start: 0, end: 72, first: 0 }, 468).max).toBe(468 - 72 - 4.5);
  });

  it('a negative indent stays valid, and a move never goes against its direction', () => {
    expect(markerLimits('left', { start: -36, end: 0, first: 0 }, 468).min).toBeLessThan(-36);
    expect(movedIndent('left', { start: -36, end: 0, first: 0 }, -40.5, 468).start).toBe(-40.5);
    expect(movedIndent('first', { start: 0, end: 0, first: -36 }, -40.5, 468).first).toBe(-40.5);
  });

  it('a right marker already across the left one is brought back inside', () => {
    expect(movedIndent('right', { start: 216, end: 468, first: 0 }, 468, 468).end).toBe(468 - 216 - 4.5);
  });
});

describe('default tab stops', () => {
  const stop = (pos: number, align: TabStop['align'] = 'start'): TabStop => ({ pos, align, leader: 'none' });

  it('shows one every interval inside the width, as the tab layout uses them', () => {
    expect(defaultStops([], 36, 200)).toEqual([36, 72, 108, 144, 180]);
    expect(defaultStops([], 72, 216)).toEqual([72, 144]);
  });

  it('starts after the last set stop and ignores cleared ones', () => {
    expect(defaultStops([stop(50)], 36, 200)).toEqual([72, 108, 144, 180]);
    expect(defaultStops([stop(50), stop(150, 'clear')], 36, 120)).toEqual([72, 108]);
  });

  it('shows none for an interval that is not positive', () => {
    expect(defaultStops([], 0, 200)).toEqual([]);
  });
});
