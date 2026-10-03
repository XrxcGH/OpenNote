import { describe, expect, it } from 'vitest';
import { paperDimensions, sheetGeometry } from '../pagination/geometry';
import { fmt } from './canvas';
import { paperPaths } from './patterns';
import { PRESETS } from './presets';
import { MARGIN_OPACITY, PEN_OPACITY, paperSvg, tokenVar, type PaperStyle } from './svg';
import { labNotebook } from './templates';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const SHEET = { x: 0, y: 0, w: 816, h: 1056 };
const STYLE: PaperStyle = {
  tokens: {
    rule: 'border.subtle',
    strong: 'border.control',
    margin: 'accent.clay',
    label: 'text.muted',
    tint: 'surface.sunken',
  },
  palette: { inkblue: 'pen.inkblue' },
  fontToken: 'font.ui',
  labelSizes: { caption: 9, small: 11 },
};

describe('token names', () => {
  it('become CSS custom properties, in kebab case', () => {
    expect(tokenVar('border.subtle')).toBe('var(--color-border-subtle)');
    expect(tokenVar('text.onAccent')).toBe('var(--color-text-on-accent)');
    expect(tokenVar('accent.primaryHover')).toBe('var(--color-accent-primary-hover)');
    expect(tokenVar('font.ui')).toBe('var(--font-ui)');
  });

  it('refuse anything that is not a plain token name', () => {
    expect(() => tokenVar('red;background:url(x)')).toThrow();
    expect(() => tokenVar('')).toThrow();
  });

  it('write numbers in the shortest form, with no trailing zeros or negative zero', () => {
    expect([fmt(96), fmt(96.5), fmt(793.7), fmt(-12.25), fmt(-0.001), fmt(26.4600001)]).toEqual([
      '96',
      '96.5',
      '793.7',
      '-12.25',
      '0',
      '26.46',
    ]);
  });
});

describe('paper as SVG', () => {
  it('colors a default page with the rule tokens and holds no raw colors', () => {
    const svg = paperSvg(paperPaths(PRESETS['ruled-college'], LETTER), SHEET, PRESETS['ruled-college'], STYLE);
    expect(svg).toContain('viewBox="0 0 816 1056"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('stroke:var(--color-border-subtle);stroke-width:1"');
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl|border:|border-width/i);
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });
});

describe('paper colors', () => {
  it('draws the margin line in the clay accent at a fixed share, and only on ruled paper', () => {
    const bg = { pattern: 'ruled', marginLine: true } as const;
    const svg = paperSvg(paperPaths(bg, LETTER), SHEET, bg, STYLE);
    expect(svg).toContain(`stroke:var(--color-accent-clay);stroke-width:1.5;stroke-opacity:${MARGIN_OPACITY}`);
  });

  it('colors a pen name through the palette at 45 percent, and uses the rule color for an unknown name', () => {
    const pen = { pattern: 'grid', color: 'inkblue' } as const;
    expect(paperSvg(paperPaths(pen, LETTER), SHEET, pen, STYLE)).toContain(
      `stroke:var(--color-pen-inkblue);stroke-width:1;stroke-opacity:${PEN_OPACITY}`,
    );
    const unknown = { pattern: 'grid', color: 'not-a-pen' } as const;
    expect(paperSvg(paperPaths(unknown, LETTER), SHEET, unknown, STYLE)).toContain('var(--color-border-subtle)');
  });

  it('uses the rule color for a color named like an Object property', () => {
    for (const color of ['constructor', '__proto__', 'toString']) {
      const bg = { pattern: 'grid', color };
      expect(paperSvg(paperPaths(bg, LETTER), SHEET, bg, STYLE)).toContain('var(--color-border-subtle)');
    }
  });

  it('takes a custom hexadecimal color only in its strict form', () => {
    // checks-disable-next-line brand-consistency: a custom pen color is data stored in a page, not a style choice
    const pen = '#336699';
    const custom = { pattern: 'dots', color: pen } as const;
    const svg = paperSvg(paperPaths(custom, LETTER), SHEET, custom, STYLE);
    expect(svg).toContain(`stroke:${pen}`);
    expect(svg).toContain('stroke-linecap:round');
    const hostile = { pattern: 'dots', color: 'pen;fill:url(x)' } as const;
    expect(paperSvg(paperPaths(hostile, LETTER), SHEET, hostile, STYLE)).not.toContain('url(x)');
  });

  it('draws labels in the font token and escapes their text, and draws no empty paths', () => {
    const template = {
      ...labNotebook({ name: 'Lab', title: 'A & B <1>', date: 'Date', project: 'P', signed: 'S', witnessed: 'W' }),
    };
    const bg = { pattern: 'template', template } as const;
    const svg = paperSvg(paperPaths(bg, LETTER), SHEET, bg, STYLE);
    expect(svg).toContain('>A &amp; B &lt;1&gt;</text>');
    expect(svg).toContain('font-size="9"');
    expect(svg).toContain('font-family:var(--font-ui)');
    expect(svg).not.toContain('d=""');
    expect(paperSvg(paperPaths({ pattern: 'plain' }, LETTER), SHEET, { pattern: 'plain' }, STYLE)).not.toContain(
      '<path',
    );
  });
});
