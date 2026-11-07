// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../markdown';
import { renderStatic, renderStaticSliced } from './dom';
import { markSpecs, nodeSpecs, tableNodeSpecs } from './specs';

describe('static DOM', () => {
  it('renders a document through the schema, never as HTML text', () => {
    const into = document.createElement('div');
    renderStatic(parseTextBlock('# Hi\n\nSome *this* and <script>alert(1)</script>'), into);
    expect(into.querySelector('h1')?.textContent).toBe('Hi');
    expect(into.querySelector('script')).toBeNull();
    expect(into.querySelector('em')?.textContent).toBe('this');
  });

  it('adds the empty line the editor keeps below a last equation', () => {
    const into = document.createElement('div');
    renderStatic(parseTextBlock('Before\n\n$$\nx^2\n$$'), into);
    expect([...into.children].map((child) => child.tagName)).toEqual(['P', 'DIV', 'P']);
    renderStatic(parseTextBlock('$$\nx^2\n$$\n\nAfter'), into);
    expect([...into.children].map((child) => child.tagName)).toEqual(['DIV', 'P']);
  });

  it('renders in slices and stops when aborted', async () => {
    const items = ['one', 'two', 'three'].map((text) => ({
      doc: parseTextBlock(text),
      into: document.createElement('div'),
    }));
    await renderStaticSliced(items, 0, new AbortController().signal);
    expect(items.map(({ into }) => into.textContent)).toEqual(['one', 'two', 'three']);
    const stop = new AbortController();
    stop.abort();
    await expect(renderStaticSliced(items, 0, stop.signal)).rejects.toBeDefined();
  });
});

describe('specs', () => {
  it('lists every node and mark of both schemas', () => {
    expect(Object.keys(nodeSpecs)).toContain('callout');
    expect(Object.keys(tableNodeSpecs)).toEqual(expect.arrayContaining(['table', 'tableCell', 'paragraph']));
    expect(Object.keys(markSpecs)[0]).toBe('float');
  });
});
