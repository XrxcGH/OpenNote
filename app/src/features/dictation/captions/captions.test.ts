// checks-disable-file brand-consistency: the fixtures are colors reported by Windows, not design colors.
import { describe, expect, it } from 'vitest';
import { EMPTY, KEPT_LINES, LATE_MS, MAX_LINE_CHARS, isLate, reduceCaptions, shown } from './model';
import { captionCss, withAlpha } from './style';
import type { CaptionStyle } from './style';

const partial = (text: string, behindMs = 0) => ({ kind: 'partial' as const, text, behindMs });
const final = (text: string, behindMs = 0) => ({ kind: 'final' as const, text, startMs: 0, endMs: 1, behindMs });

describe('the caption words', () => {
  it('shows the rough phrase, then replaces it with the finished one', () => {
    let state = reduceCaptions(EMPTY, partial('hello wor'));
    expect(shown(state)).toEqual(['hello wor']);
    state = reduceCaptions(state, partial('hello world'));
    expect(shown(state)).toEqual(['hello world']);
    state = reduceCaptions(state, final('Hello, world.'));
    expect(shown(state)).toEqual(['Hello, world.']);
    expect(state.partial).toBe('');
  });

  it('keeps only the last few phrases', () => {
    let state = EMPTY;
    for (const word of ['one', 'two', 'three', 'four', 'five']) state = reduceCaptions(state, final(word));
    expect(state.lines).toEqual(['three', 'four', 'five'].slice(-KEPT_LINES));
    expect(shown(reduceCaptions(state, partial('six')))).toEqual(['four', 'five', 'six']);
  });

  it('clips a very long phrase to its end', () => {
    const state = reduceCaptions(EMPTY, final('word '.repeat(200)));
    expect(state.lines[0]?.length).toBeLessThanOrEqual(MAX_LINE_CHARS + 1);
    expect(state.lines[0]?.startsWith('…')).toBe(true);
  });

  it('says so when the words trail the speech by several seconds', () => {
    expect(isLate(reduceCaptions(EMPTY, partial('hi', LATE_MS - 1)))).toBe(false);
    expect(isLate(reduceCaptions(EMPTY, partial('hi', LATE_MS)))).toBe(true);
    expect(isLate(reduceCaptions(EMPTY, final('hi', 0)))).toBe(false);
  });

  it('ignores updates that carry no words', () => {
    expect(reduceCaptions(EMPTY, { kind: 'listening' })).toBe(EMPTY);
    expect(reduceCaptions(EMPTY, { kind: 'speaking' })).toBe(EMPTY);
  });
});

const WINDOWS: CaptionStyle = {
  fontColor: '#ffff00',
  fontOpacity: 0.75,
  scale: 1.5,
  family: 'mono',
  backgroundColor: '#000000',
  backgroundOpacity: 0.5,
  regionColor: '#0000ff',
  regionOpacity: 0,
};

describe('following the Windows caption settings', () => {
  it('uses the size, font, and color the person chose', () => {
    const { text, box } = captionCss(WINDOWS);
    expect(text.fontSize).toBe('1.5em');
    expect(String(text.fontFamily)).toContain('monospace');
    expect(text.color).toBe('rgb(255 255 0 / 0.75)');
    expect(box.background).toBe('rgb(0 0 0 / 0.5)');
  });

  it('uses the caption window color when it is visible', () => {
    expect(captionCss({ ...WINDOWS, regionOpacity: 1 }).box.background).toBe('rgb(0 0 255 / 1)');
  });

  it('leaves the theme alone when Windows gave nothing', () => {
    expect(captionCss(null)).toEqual({ text: {}, box: {} });
  });

  it('never passes on a value that is not a color or a sane size', () => {
    expect(withAlpha('red; background: url(x)', 1)).toBeUndefined();
    expect(withAlpha('#aabbcc', 5)).toBe('rgb(170 187 204 / 1)');
    expect(captionCss({ ...WINDOWS, scale: 99, fontColor: 'javascript:1' }).text).toMatchObject({ fontSize: '2.5em' });
    expect(captionCss({ ...WINDOWS, fontColor: 'javascript:1' }).text.color).toBeUndefined();
  });
});
