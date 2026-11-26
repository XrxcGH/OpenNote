// @vitest-environment jsdom
// checks-disable-file brand-consistency: these tests feed in the fonts and colors people choose
// The Text styles dialog's values. Version 2 keys show in page units and are written back as version 2 keys.
// Custom colors get a contrast check on both pages.
import { describe, expect, it } from 'vitest';
import { contrastRatio, contrastWarning, dialogValues, fromDialog, withStyle } from './styleVars';

describe('the dialog values', () => {
  it('shows version 2 keys in page units, and a version 2 key wins over its version 1 twin', () => {
    // 18 pt x 4/3 = 24 px; 12 pt x 4/3 = 16 px.
    expect(dialogValues({ h2: { sizePt: 18, size: 99, before: 12, line: { rule: 'multiple', value: 1.4 } } })).toEqual({
      h2: { size: 24, spaceBefore: 16, lineHeight: 1.4 },
    });
  });

  it('writes only the changed values, as version 2 keys, and keeps every other key', () => {
    const sheet = { h2: { sizePt: 18, keepNext: true, future: 'kept' } };
    const before = dialogValues(sheet);
    const next = fromDialog(sheet, before, { h2: { ...before.h2, size: 32, color: 'indigo' } });
    expect(next).toEqual({ h2: { sizePt: 24, keepNext: true, future: 'kept', textColor: 'indigo' } });
  });

  it('removes a cleared value and its version 1 twin, and drops a style left empty', () => {
    expect(fromDialog({ code: { size: 14 } }, { code: { size: 14 } }, {})).toEqual({});
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
