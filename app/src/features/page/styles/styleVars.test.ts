// @vitest-environment jsdom
// checks-disable-file brand-consistency: these tests feed in the fonts and colors people choose
// Text styles as variables. Set values become custom properties with marking attributes, and unset ones go.
// Values are clamped to the dialog's limits, and custom colors get a contrast check on both pages.
import { describe, expect, it } from 'vitest';
import { applyNotebookStyles, contrastRatio, contrastWarning, styleVar, withStyle } from './styleVars';

describe('text style variables', () => {
  it('sets each value as a custom property, marked by an attribute', () => {
    const root = document.createElement('div');
    applyNotebookStyles(root, { h2: { size: 26, font: 'Literata', color: 'indigo', lineHeight: 1.4 } });
    expect(root.style.getPropertyValue(styleVar('h2', 'size'))).toBe('26px');
    expect(root.style.getPropertyValue('--style-h2-font')).toBe('"Literata"');
    expect(root.style.getPropertyValue('--style-h2-color')).toBe('var(--ink-indigo)');
    expect(root.style.getPropertyValue('--style-h2-line-height')).toBe('1.4');
    expect(root.hasAttribute('data-style-h2-size')).toBe(true);
    expect(root.hasAttribute('data-style-h3-size')).toBe(false);
  });

  it('removes what the styles no longer set, and clamps to the limits', () => {
    const root = document.createElement('div');
    applyNotebookStyles(root, { normal: { size: 200, spaceBefore: -4 } });
    expect(root.style.getPropertyValue('--style-normal-size')).toBe('72px');
    expect(root.style.getPropertyValue('--style-normal-space-before')).toBe('0px');
    applyNotebookStyles(root, undefined);
    expect(root.style.getPropertyValue('--style-normal-size')).toBe('');
    expect(root.hasAttribute('data-style-normal-size')).toBe(false);
  });

  it('ignores fonts and colors outside the lists', () => {
    const root = document.createElement('div');
    applyNotebookStyles(root, { quote: { font: 'Comic Sans' as never, color: 'red' } });
    expect(root.style.getPropertyValue('--style-quote-font')).toBe('');
    expect(root.style.getPropertyValue('--style-quote-color')).toBe('');
  });

  it('keeps only values that differ from the defaults', () => {
    expect(withStyle({ h1: { size: 30 } }, 'h1', { size: undefined })).toEqual({});
    expect(withStyle({}, 'code', { font: 'Cascadia Code' })).toEqual({ code: { font: 'Cascadia Code' } });
  });
});

describe('contrast warnings', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('pass the pens and warn on colors that are hard to read on either page', () => {
    expect(contrastWarning('indigo').ok).toBe(true);
    const yellow = contrastWarning('#f2d40c');
    expect(yellow.ok).toBe(false);
    expect(yellow.light).toBeLessThan(4.5);
    const navy = contrastWarning('#1a1a40');
    expect(navy.ok).toBe(false);
    expect(navy.dark).toBeLessThan(4.5);
  });
});
