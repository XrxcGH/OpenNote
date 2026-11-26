// @vitest-environment jsdom
// Marks draw their CSS through render/runStyle.ts, which the rendering lane fills in. The schema passes it the mark's
// name and attributes, and writes what it returns as the element's style, in the static view and the editor alike.
import { describe, expect, it, vi } from 'vitest';
import { renderStatic } from '../schema/dom';
import { parseTextBlock } from './parse';

const calls: Record<string, unknown>[] = [];

vi.mock('../render/runStyle', () => ({
  runStyle: (attrs: Record<string, unknown>) => {
    calls.push(attrs);
    // checks-disable-next-line brand-consistency: document content, not interface styling
    return attrs.mark === 'font' ? { 'font-family': `"${String(attrs.font)}"` } : {};
  },
}));

describe('the runStyle seam', () => {
  it('styles a mark with the declarations runStyle gives for its name and attributes', () => {
    const into = document.createElement('div');
    renderStatic(parseTextBlock('<span data-font="Georgia">a</span> <span data-caps="small">b</span>'), into);
    expect(calls).toEqual(
      expect.arrayContaining([
        { mark: 'font', font: 'Georgia' },
        { mark: 'caps', caps: 'small' },
      ]),
    );
    expect((into.querySelector('span[data-font]') as HTMLElement).style.fontFamily).toContain('Georgia');
    expect(into.querySelector('span[data-caps]')?.hasAttribute('style')).toBe(false);
  });
});
