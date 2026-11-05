// checks-disable-file brand-consistency: the test colors are inputs to the code under test, not design colors
import { beforeEach, describe, expect, it } from 'vitest';
import { contrastRatio, darken, hexToRgb, hslToRgb, lighten, rgbToHex, rgbToHsl } from './math';
import { parseColor, resolveColor } from './parse';
import { RECENT_LIMIT, recentColors, rememberColor, setRecentStorage } from './recent';
import { STANDARD_COLORS, THEME_COLUMNS, themeColumn } from './swatches';

describe('parseColor', () => {
  it('reads hex with or without the hash, in any case, and rgb()', () => {
    for (const text of ['FDE68A', '#fde68a', 'rgb(253, 230, 138)', ' #FDE68A ', 'rgb(253 230 138)']) {
      expect(parseColor(text)).toEqual({ ok: true, hex: '#fde68a' });
    }
  });
  it('reads the three-digit form and hsl()', () => {
    expect(parseColor('#fa0')).toEqual({ ok: true, hex: '#ffaa00' });
    // Worked by hand: lightness 25 percent, full saturation, hue 120 is #008000 (127.5 rounds to 128).
    expect(parseColor('hsl(120, 100%, 25%)')).toEqual({ ok: true, hex: '#008000' });
  });
  it('refuses everything else', () => {
    for (const text of ['blue-ish', '', '#12345', '#gggggg', 'rgb(256, 0, 0)', 'hsl(400, 10%, 10%)']) {
      expect(parseColor(text)).toEqual({ ok: false });
    }
  });
});

describe('color math', () => {
  it('lightens toward white and darkens toward black (hand-worked)', () => {
    // #2f4f9a is (47, 79, 154). Lighter 40 percent: c + (255 - c) * 0.4 = 130.2, 149.4, 194.4.
    expect(lighten('#2f4f9a', 40)).toBe('#8295c2');
    // Darker 50 percent: c * 0.5 = 23.5, 39.5, 77, which round up to 24, 40, 77.
    expect(darken('#2f4f9a', 50)).toBe('#18284d');
    expect(lighten('#000000', 100)).toBe('#ffffff');
    expect(darken('#ffffff', 100)).toBe('#000000');
  });
  it('converts between RGB and HSL', () => {
    expect(rgbToHsl([255, 0, 0])).toEqual([0, 100, 50]);
    expect(rgbToHsl([128, 128, 128])).toEqual([0, 0, 50]);
    expect(rgbToHsl([0, 0, 255])).toEqual([240, 100, 50]);
    expect(rgbToHex(hslToRgb([240, 100, 50]))).toBe('#0000ff');
  });
  it('gives the WCAG contrast of black on white as 21 and of equal colors as 1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([9, 9, 9], [9, 9, 9])).toBeCloseTo(1, 5);
    expect(contrastRatio(hexToRgb('#767676')!, [255, 255, 255])).toBeGreaterThan(4.5);
  });
});

describe('resolveColor', () => {
  it('resolves pens, highlighters, theme colors and hex to #rrggbb', () => {
    expect(resolveColor('indigo', 'light')).toBe('#2f4f9a');
    expect(resolveColor('indigo', 'dark')).toBe('#9db4ea');
    expect(resolveColor('honey', 'light')).toBe('#f2cf4a');
    expect(resolveColor('theme:accent1', 'light')).toBe('#2f4f9a');
    expect(resolveColor('theme:accent1', 'light', { accent1: '#112233' })).toBe('#112233');
    expect(resolveColor('theme:text', 'light')).toBe('#2b2521');
    expect(resolveColor('#aabbcc')).toBe('#aabbcc');
  });
  it('returns null outside the grammar', () => {
    for (const value of ['theme:accent9', 'newpen', '#ABCDEF', 'rgb(1,2,3)']) expect(resolveColor(value)).toBeNull();
  });
});

describe('swatches', () => {
  it('has eight theme columns of six, and ten standard colors', () => {
    expect(THEME_COLUMNS).toHaveLength(8);
    for (const column of THEME_COLUMNS) {
      const swatches = themeColumn(column, 'light');
      expect(swatches).toHaveLength(6);
      expect(swatches[0].value).toBe(`theme:${column.name}`);
      for (const tint of swatches.slice(1)) expect(tint.value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(STANDARD_COLORS).toHaveLength(10);
  });
});

describe('recent colors', () => {
  let saved = '{}';
  beforeEach(() => {
    saved = '{}';
    setRecentStorage({ read: () => saved, write: (text) => (saved = text) });
  });
  it('keeps the newest first, without repeats, up to ten, per notebook', () => {
    rememberColor('nb1', '#111111');
    rememberColor('nb1', '#222222');
    rememberColor('nb1', '#111111');
    rememberColor('nb2', '#333333');
    expect(recentColors('nb1')).toEqual(['#111111', '#222222']);
    expect(recentColors('nb2')).toEqual(['#333333']);
    for (let i = 0; i < 12; i++) rememberColor('nb1', `#0000${i.toString(16).padStart(2, '0')}`);
    expect(recentColors('nb1')).toHaveLength(RECENT_LIMIT);
  });
  it('survives a reload and ignores damaged storage', () => {
    rememberColor('nb1', '#abcdef');
    const kept = saved;
    setRecentStorage({ read: () => kept, write: () => {} });
    expect(recentColors('nb1')).toEqual(['#abcdef']);
    setRecentStorage({ read: () => '{{nope', write: () => {} });
    expect(recentColors('nb1')).toEqual([]);
  });
});

describe('hostile input', () => {
  it('refuses a very long ambiguous string fast', () => {
    const hostile = ['rgb(1 ' + ' '.repeat(100_000) + '2' + ' '.repeat(100_000) + 'x', 'hsl(1' + ' '.repeat(100_000) + 'x'];
    const start = performance.now();
    for (const text of hostile) expect(parseColor(text)).toEqual({ ok: false });
    expect(performance.now() - start).toBeLessThan(50);
  });
  it('refuses a hostile string just under the input cap fast, and keeps both separators', () => {
    const start = performance.now();
    expect(parseColor('rgb(1 ' + ' '.repeat(25) + '2' + ' '.repeat(25) + 'x')).toEqual({ ok: false });
    expect(performance.now() - start).toBeLessThan(50);
    expect(parseColor('rgb(1 ,  2 3)')).toEqual({ ok: true, hex: '#010203' });
    expect(parseColor('rgb( 1 ,2,   3 )')).toEqual({ ok: true, hex: '#010203' });
    expect(parseColor('hsl(120 100% 25%)')).toEqual({ ok: true, hex: '#008000' });
  });
});

describe('stored tints', () => {
  it('are the same in light and dark', () => {
    for (const column of THEME_COLUMNS) {
      const light = themeColumn(column, 'light').map((s) => s.value);
      const dark = themeColumn(column, 'dark').map((s) => s.value);
      expect(dark).toEqual(light);
    }
  });
});

describe('recent colors cap', () => {
  it('keeps at most 50 notebooks, dropping the oldest, and survives a __proto__ key', () => {
    let saved = '{}';
    setRecentStorage({ read: () => saved, write: (text) => (saved = text) });
    for (let i = 0; i < 55; i++) rememberColor(`nb${i}`, '#111111');
    expect(Object.keys(JSON.parse(saved))).toHaveLength(50);
    expect(recentColors('nb0')).toEqual([]);
    expect(recentColors('nb54')).toEqual(['#111111']);
    const poisoned = '{"__proto__":["#222222"],"nbx":["#333333"]}';
    setRecentStorage({ read: () => poisoned, write: () => {} });
    expect(recentColors('nbx')).toEqual(['#333333']);
    expect(({} as Record<string, unknown>).length).toBeUndefined();
  });
});
