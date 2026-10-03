import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokens } from '../../../theme/tokens';
import {
  DEFAULT_READING,
  TINT_MIX,
  TINTS,
  isActive,
  readReading,
  readingStyle,
  tintColor,
  writeReading,
  type ReadingAids,
} from './aids';
import { dimmedAreas, focusBand, lineAtY, moveFocus, type LineBox } from './focus';
import { SOFT_HYPHEN, breakText, syllables, withoutBreaks } from './syllables';

describe('reading aids setting', () => {
  it('reads an empty setting as the defaults', () => {
    expect(readReading(undefined)).toEqual({ aids: DEFAULT_READING, warnings: [] });
    expect(readReading({})).toEqual({ aids: DEFAULT_READING, warnings: [] });
  });

  it('keeps good values, and replaces bad ones with the default and reports them', () => {
    const { aids, warnings } = readReading({ focus: 3, tint: 'purple', wordSpace: 9, maxLine: 66, syllables: 'yes' });
    expect(aids).toEqual({ ...DEFAULT_READING, focus: 3, maxLine: 66 });
    expect(warnings.map((w) => w.path).sort()).toEqual(['syllables', 'tint', 'wordSpace']);
  });

  it('limits the line width to 30 to 120 characters', () => {
    expect(readReading({ maxLine: 29 }).aids.maxLine).toBeNull();
    expect(readReading({ maxLine: 121 }).warnings).toHaveLength(1);
    expect(readReading({ maxLine: 30 }).aids.maxLine).toBe(30);
    expect(readReading({ maxLine: null }).warnings).toEqual([]);
  });

  it('writes only what differs from the default, and reads it back', () => {
    const aids: ReadingAids = { ...DEFAULT_READING, tint: 'sepia', paragraphSpace: 2, syllables: true };
    expect(writeReading(aids)).toEqual({ tint: 'sepia', paragraphSpace: 2, syllables: true });
    expect(writeReading(DEFAULT_READING)).toEqual({});
    expect(readReading(writeReading(aids)).aids).toEqual(aids);
    expect(isActive(aids)).toBe(true);
    expect(isActive(DEFAULT_READING)).toBe(false);
  });

  it('styles nothing for the defaults, and only what is on otherwise', () => {
    expect(readingStyle(DEFAULT_READING)).toEqual({ vars: {}, css: '' });
    const { vars, css } = readingStyle({ ...DEFAULT_READING, wordSpace: 2, maxLine: 60, tint: 'cream' });
    expect(vars['--reading-word-space']).toBe('0.16em');
    expect(vars['--reading-measure']).toBe('60ch');
    expect(vars['--reading-page']).toContain('color-mix');
    expect(vars).not.toHaveProperty('--reading-paragraph-space');
    expect(css).toContain('word-spacing');
    expect(css).toContain('max-inline-size');
  });
});

/** The WCAG contrast ratio of two #rrggbb colors. */
function luminance([r, g, b]: number[]): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('page tints', () => {
  type Theme = Record<string, Record<string, string>>;
  const themes: Record<'light' | 'dark', Theme> = { light: tokens.color.light, dark: tokens.color.dark };
  const lookup = (theme: Theme, name: string): string => {
    const [group, key] = name.split('.');
    return theme[group][key];
  };

  it('has no tint for none, and mixes the page color with a theme color for the others', () => {
    expect(tintColor('none')).toBeNull();
    for (const tint of TINTS.filter((t) => t !== 'none')) {
      expect(tintColor(tint)).toMatch(
        /^color-mix\(in srgb, var\(--color-surface-page\) \d+%, var\(--color-[a-z-]+\) \d+%\)$/,
      );
    }
  });

  it.each(Object.keys(themes) as (keyof typeof themes)[])(
    'keeps text readable on every tint in the %s theme',
    (name) => {
      const theme = themes[name];
      for (const [tint, { token, percent }] of Object.entries(TINT_MIX)) {
        const page = rgb(theme.surface.page);
        const other = rgb(lookup(theme, token));
        const mixed = page.map((c, i) => (c * (100 - percent) + other[i] * percent) / 100);
        expect(contrast(rgb(theme.text.primary), mixed), `${tint} primary`).toBeGreaterThanOrEqual(7);
        expect(contrast(rgb(theme.text.secondary), mixed), `${tint} secondary`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(rgb(theme.text.muted), mixed), `${tint} muted`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

const lines: LineBox[] = Array.from({ length: 10 }, (_, i) => ({ top: 100 + i * 24, height: 20 }));

describe('line focus band', () => {
  it('is off for 0 lines and for an empty page', () => {
    expect(focusBand(lines, 4, 0)).toBeNull();
    expect(focusBand([], 0, 3)).toBeNull();
  });

  it('lights the active line, centered when the band is 3 or 5 lines', () => {
    expect(focusBand(lines, 4, 1)).toMatchObject({ first: 4, last: 4, top: 196, bottom: 216 });
    expect(focusBand(lines, 4, 3)).toMatchObject({ first: 3, last: 5 });
    expect(focusBand(lines, 4, 5)).toMatchObject({ first: 2, last: 6, top: 148, bottom: 264 });
  });

  it('keeps its size at the first and last lines by sliding over them', () => {
    expect(focusBand(lines, 0, 5)).toMatchObject({ first: 0, last: 4 });
    expect(focusBand(lines, 9, 5)).toMatchObject({ first: 5, last: 9 });
    expect(focusBand(lines.slice(0, 2), 1, 5)).toMatchObject({ first: 0, last: 1 });
  });

  it('finds the line under, or nearest to, a y position', () => {
    expect(lineAtY(lines, 100)).toBe(0);
    expect(lineAtY(lines, 130)).toBe(1);
    expect(lineAtY(lines, 50)).toBe(0);
    expect(lineAtY(lines, 9999)).toBe(9);
    // The 4 units between lines 0 and 1: nearer the first at 121, nearer the second at 123.
    expect(lineAtY(lines, 121)).toBe(0);
    expect(lineAtY(lines, 123)).toBe(1);
    expect(lineAtY([], 5)).toBe(-1);
  });

  it('moves by a line or a whole band and stays on the page', () => {
    expect(moveFocus(10, 4, 1)).toBe(5);
    expect(moveFocus(10, 4, 1, 3, true)).toBe(7);
    expect(moveFocus(10, 8, 1, 5, true)).toBe(9);
    expect(moveFocus(10, 1, -1, 5, true)).toBe(0);
    expect(moveFocus(0, 0, 1)).toBe(-1);
  });

  it('dims the area above and below the band', () => {
    const band = focusBand(lines, 4, 3)!;
    const [above, below] = dimmedAreas(band, { x: 0, y: 0, w: 800, h: 1000 });
    expect(above).toEqual({ x: 0, y: 0, w: 800, h: band.top });
    expect(below).toEqual({ x: 0, y: band.bottom, w: 800, h: 1000 - band.bottom });
    expect(dimmedAreas(band, { x: 0, y: band.top, w: 800, h: band.bottom - band.top })).toEqual([null, null]);
  });
});

describe('syllables', () => {
  const split = (word: string) => syllables(word).join('-');

  it('splits common English words where a dictionary does', () => {
    expect(split('table')).toBe('ta-ble');
    expect(split('little')).toBe('lit-tle');
    expect(split('apple')).toBe('ap-ple');
    expect(split('reading')).toBe('read-ing');
    expect(split('running')).toBe('run-ning');
    expect(split('important')).toBe('im-por-tant');
    expect(split('computer')).toBe('com-pu-ter');
    expect(split('pocket')).toBe('pock-et');
    expect(split('beautiful')).toBe('beau-ti-ful');
  });

  it('leaves short words, silent endings, other languages, and non-words whole', () => {
    for (const word of ['cat', 'snake', 'jumped', 'there', 'x1y2z3']) expect(syllables(word)).toEqual([word]);
    expect(syllables('importante', 'es')).toEqual(['importante']);
    expect(syllables('naïveté')).toEqual(['naïveté']);
  });

  it('keeps the case of the word', () => {
    expect(syllables('Important')).toEqual(['Im', 'por', 'tant']);
  });

  it('always returns the word in order, in parts of two letters or more', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z]{1,16}$/), (word) => {
        const parts = syllables(word);
        expect(parts.join('')).toBe(word);
        if (parts.length > 1) for (const part of parts) expect(part.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 500 },
    );
  });
});

describe('breaking text', () => {
  it('puts a soft hyphen between syllables of long words, and removes them again', () => {
    const text = 'The important table is little.';
    const broken = breakText(text);
    expect(broken).toBe(`The im${SOFT_HYPHEN}por${SOFT_HYPHEN}tant ta${SOFT_HYPHEN}ble is lit${SOFT_HYPHEN}tle.`);
    expect(withoutBreaks(broken)).toBe(text);
  });

  it('can show the breaks with another separator', () => {
    expect(breakText('important', { separator: '·' })).toBe('im·por·tant');
  });

  it('leaves addresses, paths, numbers, and other languages alone', () => {
    for (const token of ['https://example.com/important', 'important_file', 'user@important.org', 'important2']) {
      expect(breakText(token)).toBe(token);
    }
    expect(breakText('importante', { language: 'es' })).toBe('importante');
  });

  it('keeps punctuation and spacing exactly', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (text) => {
        expect(withoutBreaks(breakText(text))).toBe(withoutBreaks(text));
      }),
      { numRuns: 300 },
    );
  });
});
