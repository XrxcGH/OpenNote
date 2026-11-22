// Known answers are worked by hand from the layout rule: need(100%) = 667 / 0.9 = 741.1, so 742 px; at 125% 927 px;
// at 150% 1,112 px; the cap is 24 px at any width.
import { describe, expect, it } from 'vitest';
import { capFor, deskGutter, needFor, nextGutter } from './deskGutter';
import type { GutterInput } from './deskGutter';

const base: GutterInput = {
  sizeClass: 'wide',
  region: 1384,
  scrollbar: 15,
  column: 667,
  zoom: 1,
  paginated: false,
  forcedColors: false,
  pagePaneOpen: false,
  paperInDark: false,
};
const at = (region: number, zoom = 1, extra: Partial<GutterInput> = {}) =>
  deskGutter({ ...base, region, zoom, ...extra });

describe('the narrowest full column', () => {
  it('is the column plus its two margins', () => {
    expect(needFor(1, 667)).toBe(742);
    expect(needFor(1.25, 667)).toBe(927);
    expect(needFor(1.5, 667)).toBe(1112);
    // A narrow column uses the 32 unit margin, a very wide one the 48 unit margin.
    expect(needFor(1, 500)).toBe(564);
    expect(needFor(1, 1000)).toBe(1096);
  });
});

describe('the cap', () => {
  it('is 24 px at any width', () => {
    for (const region of [820, 1120, 1250, 1384, 2400]) expect(capFor(region)).toBe(24);
  });
});

describe('deskGutter at the test widths', () => {
  it('window 1,280 (region 820)', () => {
    expect(at(820)).toBe(24);
    expect(at(820, 1.1)).toBe(0);
  });
  it('window 1,440 (region 980)', () => {
    expect(at(980, 1.1)).toBe(24);
    expect(at(980, 1.25)).toBe(19);
    expect(at(980, 1.5)).toBe(0);
  });
  it('window 1,600 (region 1,120)', () => {
    expect(at(1120, 1.25)).toBe(24);
    expect(at(1120, 1.5)).toBe(0);
  });
  it('very wide windows', () => {
    expect(at(1384)).toBe(24);
    expect(at(1384, 1.5)).toBe(24);
    expect(at(1464, 1.5)).toBe(24);
    expect(at(1250)).toBe(24);
  });
  it('gives 0 for a spare under 16 px (8 px after halving)', () => {
    expect(deskGutter({ ...base, region: 742 + 15 + 14 })).toBe(0);
    expect(deskGutter({ ...base, region: 742 + 15 + 16 })).toBe(8);
  });
});

describe('deskGutter off conditions', () => {
  it.each(['compact', 'medium', 'expanded'] as const)('is 0 at %s', (sizeClass) => {
    expect(at(1384, 1, { sizeClass })).toBe(0);
  });
  it('is 0 in Pages with breaks, under forced colors, and with Paper in dark', () => {
    expect(at(1384, 1, { paginated: true })).toBe(0);
    expect(at(1384, 1, { forcedColors: true })).toBe(0);
    expect(at(1384, 1, { paperInDark: true })).toBe(0);
  });
  it('is 0 with a page pane open', () => {
    expect(at(980, 1, { pagePaneOpen: true })).toBe(0);
    expect(at(1384, 1, { pagePaneOpen: true })).toBe(0);
  });
});

describe('nextGutter', () => {
  // region = scrollbar 15 + need 742 + spare
  const withSpare = (spare: number): GutterInput => ({ ...base, region: 15 + 742 + spare });
  it('stays at 0 while the larger gutter is within the hysteresis', () => {
    expect(nextGutter(0, withSpare(18))).toBe(0);
    expect(nextGutter(0, withSpare(22))).toBe(11);
  });
  it('shrinks at once', () => {
    expect(nextGutter(24, withSpare(38))).toBe(19);
    expect(nextGutter(11, withSpare(15))).toBe(0);
  });
  it('keeps a gutter that is already right', () => {
    expect(nextGutter(19, withSpare(38))).toBe(19);
  });
});
