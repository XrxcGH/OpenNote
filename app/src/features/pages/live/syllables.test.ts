// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attachSyllables, markedRanges } from './syllables';

function page(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe('syllable marks over the page', () => {
  it('finds ranges in the prose without touching the document', () => {
    const root = page('<p>A remarkable afternoon</p><p>short</p>');
    const before = root.innerHTML;
    const ranges = markedRanges(root);
    expect(ranges.length).toBeGreaterThan(1);
    for (const range of ranges) expect(range.toString()).toMatch(/^[A-Za-z]+$/);
    expect(root.innerHTML).toBe(before);
  });

  it('leaves code alone', () => {
    const root = page('<pre><code>transformation implementation</code></pre><p>wonderful</p>');
    const words = markedRanges(root).map((range) => range.commonAncestorContainer.parentElement?.tagName);
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((tag) => tag === 'P')).toBe(true);
  });

  it('stops at the limit', () => {
    const root = page(`<p>${'wonderful '.repeat(50)}</p>`);
    expect(markedRanges(root, 'en', 7)).toHaveLength(7);
  });

  it('does nothing where the browser has no highlight API, and can be stopped', () => {
    const root = page('<p>wonderful</p>');
    const marks = attachSyllables(root);
    expect(() => {
      marks.set(true);
      marks.set(false);
      marks.stop();
    }).not.toThrow();
  });
});
