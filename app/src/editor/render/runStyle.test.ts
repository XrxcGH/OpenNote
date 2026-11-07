// checks-disable-file brand-consistency: test colors are inputs, not design colors
// The declarations for each mark and paragraph key, by hand-worked values (points times 4/3 for pixels).
import { describe, expect, it } from 'vitest';
import { fontStack } from './fallbacks';
import { paraDom, paraStyle } from './paraStyle';
import { colorValue, runStyle } from './runStyle';

describe('runStyle', () => {
  it('converts points to pixels', () => {
    expect(runStyle({ mark: 'textSize', size: '10.5' })).toEqual({ 'font-size': '14px' });
    expect(runStyle({ mark: 'tracking', tracking: '1.5' })).toEqual({ 'letter-spacing': '2px' });
    expect(runStyle({ mark: 'shift', shift: '-3' })).toEqual({ 'vertical-align': '-4px' });
  });

  it('leaves the version 1 size names to the style sheet', () => {
    expect(runStyle({ mark: 'textSize', size: 'large' })).toEqual({});
  });

  it('maps every underline style to a decoration style', () => {
    expect(runStyle({ mark: 'underline', line: 'wave' })).toMatchObject({ 'text-decoration-style': 'wavy' });
    expect(runStyle({ mark: 'underline', line: 'dashedHeavy' })).toMatchObject({
      'text-decoration-style': 'dashed',
      'text-decoration-thickness': '0.12em',
    });
    expect(runStyle({ mark: 'underline', line: null, color: '#ff0000' })).toEqual({
      'text-decoration-line': 'underline',
      'text-decoration-color': '#ff0000',
    });
    expect(runStyle({ mark: 'underline', line: null, color: null })).toEqual({});
  });

  it('writes caps, weight, kerning, and number and ligature features', () => {
    expect(runStyle({ mark: 'caps', caps: 'all' })).toEqual({ 'text-transform': 'uppercase' });
    expect(runStyle({ mark: 'weight', weight: '300' })).toEqual({ 'font-weight': '300' });
    expect(runStyle({ mark: 'kern', kern: '0' })).toEqual({ 'font-kerning': 'none' });
    expect(runStyle({ mark: 'otf', otf: 'liga-none onum ss02' })).toEqual({
      'font-variant-ligatures': 'no-common-ligatures',
      'font-variant-numeric': 'oldstyle-nums',
      'font-feature-settings': '"ss02" 1',
    });
  });

  it('draws effects and boxes', () => {
    expect(runStyle({ mark: 'effect', effect: 'outline' })).toMatchObject({ color: 'transparent' });
    expect(runStyle({ mark: 'effect', effect: 'emboss shadow' })['text-shadow']).toContain('rgb(255 255 255 / 0.7)');
    expect(runStyle({ mark: 'box', style: 'double', color: 'brick' })).toEqual({
      outline: '3px double var(--ink-brick)',
      'outline-offset': '1px',
    });
  });

  it('keeps a custom highlight on a property and the named ones in the style sheet', () => {
    expect(runStyle({ mark: 'highlight', color: '#336699' })).toEqual({ '--run-fill': '#336699' });
    expect(runStyle({ mark: 'highlight', color: 'mint' })).toEqual({});
    expect(runStyle({ mark: 'highlight', color: null })).toEqual({});
  });

  it('draws nothing for marks it does not style, or values it cannot read', () => {
    expect(runStyle({ mark: 'bold' })).toEqual({});
    expect(runStyle({ mark: 'lang', lang: 'en' })).toEqual({});
    expect(runStyle({ mark: 'tracking', tracking: 'x' })).toEqual({});
  });

  it('resolves colors', () => {
    expect(colorValue('fern')).toBe('var(--ink-fern)');
    expect(colorValue('theme:text')).toBe('var(--color-text-primary)');
    expect(colorValue('nonsense')).toBe('currentcolor');
  });
});

describe('fontStack', () => {
  it('adds the metric alias and the generic stack of the font class', () => {
    expect(fontStack('Calibri')).toMatch(/^"Calibri", "Carlito", "OpenNote Sans"/);
    expect(fontStack('Times New Roman')).toMatch(/^"Times New Roman", "Liberation Serif", "Literata Variable"/);
    expect(fontStack('Courier New')).toMatch(/"Liberation Mono", "Atkinson Hyperlegible Mono"/);
  });

  it('resolves theme tokens through the page style sheet', () => {
    expect(fontStack('+heading')).toMatch(/^var\(--theme-font-heading, /);
  });
});

describe('paraStyle', () => {
  it('writes hanging indents the Word way', () => {
    expect(paraStyle({ indent: { start: 36, first: -18 } })).toEqual({
      'margin-inline-start': '24px',
      'padding-inline-start': '24px',
      'text-indent': '-24px',
    });
  });

  it('writes the three line rules', () => {
    expect(paraStyle({ line: { rule: 'exact', value: 18 } })['line-height']).toBe('24px');
    expect(paraStyle({ line: { rule: 'multiple', value: 1.5 } })['--line-mult']).toBe('1.5');
    expect(paraStyle({ line: { rule: 'atLeast', value: 18 } })['line-height']).toMatch(/^max\(24px, /);
  });

  it('writes automatic spacing as 14 points', () => {
    expect(paraStyle({ before: 'auto', after: 0 })).toEqual({
      'margin-block-start': '18.667px',
      'margin-block-end': '0px',
    });
  });

  it('draws a pattern shade as the fill mixed with the pattern color', () => {
    expect(paraStyle({ shade: { fill: '#ffffff', pattern: 'pct25', color: '#000000' } })).toEqual({
      'background-color': 'color-mix(in srgb, #000000 25%, #ffffff)',
    });
  });

  it('ignores values outside the ranges, as the readers do', () => {
    expect(paraStyle({ before: -1, align: 'sideways' })).toEqual({});
  });

  it('gives a plain paragraph no attributes', () => {
    expect(paraDom({ align: null, border: null })).toEqual({});
  });

  it('marks borders, drop caps, and language', () => {
    const attrs = { border: { top: { style: 'single' } }, dropCap: { mode: 'drop', lines: 3 }, lang: 'en-US' };
    expect(paraDom(attrs)).toMatchObject({ 'data-border': '', 'data-drop-cap': 'drop', lang: 'en-US' });
  });
});
