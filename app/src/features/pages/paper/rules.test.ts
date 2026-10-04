// Which papers give text rules to sit on, and that print lays text out on them the way the screen does.
import { describe, expect, it } from 'vitest';
import { documentCss, lightTheme } from '../export/style';
import { sheetGeometry } from '../pagination/geometry';
import { paperRules } from './rules';

const sheet = sheetGeometry({ width: 816, height: 1056 }, [72, 72, 72, 72]);

describe('paperRules', () => {
  it('gives ruled, grid, and dot paper their spacing, anchored at the top margin', () => {
    for (const pattern of ['ruled', 'grid', 'dots']) {
      expect(paperRules({ pattern, spacing: 30 }, sheet, false)).toEqual({ step: 30, origin: 72, sheet: null });
    }
  });

  it('restarts the lattice on every sheet when the page is paginated', () => {
    expect(paperRules({ pattern: 'ruled' }, sheet, true)).toEqual({ step: 26, origin: 72, sheet: 1056 });
  });

  it('gives plain paper, Cornell paper, and templates none', () => {
    for (const pattern of ['plain', 'cornell', 'staff', 'isometric', 'template', 'unknown']) {
      expect(paperRules({ pattern }, sheet, false), pattern).toBeNull();
    }
  });
});

describe('print on ruled paper', () => {
  const ruled = { grid: { step: 26.46, origin: 72, sheet: 1056 } };

  it('lays out text in whole rules with baselines on them', () => {
    const css = documentCss(lightTheme(), {}, ruled);
    expect(css).toContain('--ruled:26.46px');
    // The lift: 12 percent of the spacing, to a whole pixel, at least 2.
    expect(css).toContain('--ruled-lift:3px');
    expect(css).toContain('padding-bottom:var(--ruled-lift)');
    expect(css).toContain('line-height:round(up,1.25em,var(--ruled))');
    expect(css).toContain('text-box:trim-both cap alphabetic;padding-top:calc(1lh - 1cap - var(--ruled-lift))');
  });

  it('is the same stylesheet as before on plain paper', () => {
    expect(documentCss(lightTheme(), {}, null)).toBe(documentCss(lightTheme()));
    expect(documentCss(lightTheme())).not.toContain('--ruled');
  });
});
