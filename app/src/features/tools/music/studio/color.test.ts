// checks-disable-file brand-consistency: color values are data here, not styling
import { describe, expect, it } from 'vitest';
import {
  confusablePairs,
  contrast,
  deltaE2000,
  fromLinear,
  hslToRgb,
  luminance,
  MACHADO,
  palette,
  parseColor,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToLab,
  rgbToXyz,
  simulate,
  toHex,
  toLinear,
  typeScale,
  wcag,
} from './color';
import type { Rgb } from './color';

const close = (actual: readonly number[], expected: readonly number[], digits: number) =>
  expected.forEach((value, i) => expect(actual[i]!).toBeCloseTo(value, digits));

describe('reading and writing colors', () => {
  it('reads hex, short hex, rgb(), hsl(), and plain numbers', () => {
    expect(parseColor('#FF8000')).toEqual([255, 128, 0]);
    expect(parseColor('f80')).toEqual([255, 136, 0]);
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseColor('10 20 30')).toEqual([10, 20, 30]);
    close(parseColor('hsl(120, 100%, 50%)')!, [0, 255, 0], 9);
  });
  it('refuses text that is not a color or has a channel out of range', () => {
    expect(parseColor('')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseColor('hsl(10, 120%, 50%)')).toBeNull();
    expect(parseColor('blue')).toBeNull();
  });
  it('writes hex with rounding and clamping', () => {
    expect(toHex([255, 128, 0])).toBe('#ff8000');
    expect(toHex([300, -4, 127.6])).toBe('#ff0080');
  });
});

describe('color spaces', () => {
  it('converts orange to HSL, HSV, and CMYK', () => {
    const orange: Rgb = [255, 128, 0];
    const [h, s, l] = rgbToHsl(orange);
    expect(h).toBeCloseTo(30.12, 2);
    expect(s).toBe(1);
    expect(l).toBe(0.5);
    close(rgbToHsv(orange), [30.12, 1, 1], 2);
    close(rgbToCmyk(orange), [0, 0.498, 1, 0], 3);
  });
  it('converts black and white', () => {
    expect(rgbToCmyk([0, 0, 0])).toEqual([0, 0, 0, 1]);
    close(rgbToLab([255, 255, 255]), [100, 0, 0], 2);
    close(rgbToLab([0, 0, 0]), [0, 0, 0], 9);
  });
  it('puts the sRGB primaries at their published XYZ and Lab positions', () => {
    close(rgbToXyz([255, 0, 0]), [0.4124564, 0.2126729, 0.0193339], 6);
    close(rgbToLab([255, 0, 0]), [53.2408, 80.0925, 67.2032], 1);
    close(rgbToLab([0, 255, 0]), [87.7347, -86.1827, 83.1793], 1);
    close(rgbToLab([0, 0, 255]), [32.297, 79.1875, -107.8602], 1);
  });
  it('round-trips HSL and linear light', () => {
    const [h, s, l] = rgbToHsl([12, 200, 99]);
    close(hslToRgb(h, s, l), [12, 200, 99], 9);
    close(fromLinear(toLinear([12, 200, 99])), [12, 200, 99], 9);
  });
});

describe('contrast', () => {
  it('is 21:1 for black on white', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 9);
  });
  it('fails AA for #777777 on white and passes for #767676', () => {
    const white: Rgb = [255, 255, 255];
    expect(contrast([0x77, 0x77, 0x77], white)).toBeCloseTo(4.48, 2);
    expect(wcag(contrast([0x77, 0x77, 0x77], white)).aaNormal).toBe(false);
    expect(contrast([0x76, 0x76, 0x76], white)).toBeCloseTo(4.54, 2);
    expect(wcag(contrast([0x76, 0x76, 0x76], white)).aaNormal).toBe(true);
  });
  it('is the same whichever color is on top', () => {
    expect(contrast([20, 60, 200], [250, 240, 10])).toBeCloseTo(contrast([250, 240, 10], [20, 60, 200]), 12);
  });
  it('gives luminance 1 for white and grades each level at its threshold', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 12);
    expect(wcag(3)).toEqual({ aaNormal: false, aaaNormal: false, aaLarge: true, aaaLarge: false });
    expect(wcag(7)).toEqual({ aaNormal: true, aaaNormal: true, aaLarge: true, aaaLarge: true });
  });
});

describe('CIEDE2000', () => {
  // Pairs from the published test data of Sharma, Wu, and Dalal (2005).
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
  ])('matches the published difference for %j and %j', (a, b, expected) => {
    expect(deltaE2000(a as [number, number, number], b as [number, number, number])).toBeCloseTo(expected as number, 4);
  });
  it('gives 9.4706 for neutral grays 10 apart in lightness', () => {
    expect(deltaE2000([50, 0, 0], [60, 0, 0])).toBeCloseTo(9.4706, 4);
  });
  it('is zero for the same color and symmetric', () => {
    expect(deltaE2000([40, 10, -20], [40, 10, -20])).toBe(0);
    expect(deltaE2000([40, 10, -20], [55, -30, 5])).toBeCloseTo(deltaE2000([55, -30, 5], [40, 10, -20]), 9);
  });
});

describe('color-vision simulation', () => {
  it('keeps white and gray unchanged, because each matrix row sums to 1', () => {
    for (const kind of ['protan', 'deutan', 'tritan'] as const) {
      for (const row of MACHADO[kind]) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      close(simulate([255, 255, 255], kind), [255, 255, 255], 1);
      close(simulate([128, 128, 128], kind), [128, 128, 128], 1);
    }
  });
  it('makes red and green much closer under red-green deficiencies than under typical vision', () => {
    const typical = deltaE2000(rgbToLab([200, 40, 40]), rgbToLab([40, 160, 40]));
    const deutan = deltaE2000(rgbToLab(simulate([200, 40, 40], 'deutan')), rgbToLab(simulate([40, 160, 40], 'deutan')));
    expect(deutan).toBeLessThan(typical / 2);
  });
  it('does nothing at severity zero', () => {
    close(simulate([200, 40, 40], 'protan', 0), [200, 40, 40], 6);
  });
  it('flags a red and green pair as confusable and a black and white pair as not', () => {
    const pairs = confusablePairs([
      [200, 40, 40],
      [40, 160, 40],
    ]);
    expect(pairs.some((p) => p.kind === 'deutan' || p.kind === 'protan')).toBe(true);
    expect(
      confusablePairs([
        [0, 0, 0],
        [255, 255, 255],
      ]),
    ).toEqual([]);
  });
});

describe('palettes', () => {
  it('rotates hue by 180 degrees for the complement', () => {
    const [base, complement] = palette([255, 0, 0], 'complementary');
    close(base!, [255, 0, 0], 6);
    close(complement!, [0, 255, 255], 6);
  });
  it('makes a triad 120 degrees apart', () => {
    const colors = palette([255, 0, 0], 'triadic');
    close(colors[1]!, [0, 255, 0], 6);
    close(colors[2]!, [0, 0, 255], 6);
  });
  it('mixes toward white for tints and toward black for shades', () => {
    const tints = palette([200, 100, 0], 'tints', 4);
    expect(tints[0]).toEqual([200, 100, 0]);
    close(tints[2]!, [227.5, 177.5, 127.5], 9);
    close(palette([200, 100, 0], 'shades', 4)[2]!, [100, 50, 0], 9);
  });
});

describe('type scale', () => {
  it('steps 16 px by 1.25 to 20, 25, and 31.25', () => {
    const sizes = typeScale(16, 1.25, 1, 3).map((s) => s.size);
    close(sizes, [20, 25, 31.25], 9);
  });
  it('includes steps below the base', () => {
    expect(typeScale(16, 2, -1, 0).map((s) => s.size)).toEqual([8, 16]);
  });
});
