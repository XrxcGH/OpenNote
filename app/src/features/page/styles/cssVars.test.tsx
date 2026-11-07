// Named styles as CSS in a real browser (ADR 0082). Changing h1 restyles every h1 on the shown page by swapping a
// variable: the editor sees no transaction, its elements stay the same nodes, and the generated rules don't change.
// An element that names a style gets the style's whole look; a heading 7 has no other CSS to draw it.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost } from '../../../editor/commands/testing';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { applyElementData } from '../../../editor/markdown/elements';
import { parseTextBlock } from '../../../editor/markdown/parse';
import { applyNamedStyles } from './cssVars';
// Importing the decorations registers them in every text editor whose host has text.styles2 on.
import './decorations';
import { resolveAll } from './resolve';
import type { StyleSheetJson } from './model';
import { APP_STYLES } from './sets';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  applyNamedStyles(document.documentElement, []);
  document.body.replaceChildren();
});

function mount(markdown: string, data: Parameters<typeof applyElementData>[1]): HTMLElement {
  const page = document.body.appendChild(document.createElement('div'));
  page.setAttribute('data-scope', 'page');
  const root = page.appendChild(document.createElement('div'));
  editor = createBlockEditor(root, applyElementData(parseTextBlock(markdown), data), {
    kind: 'text',
    block: 'b1',
    host: testHost(),
  });
  return root;
}

const show = (notebook: StyleSheetJson) =>
  applyNamedStyles(document.documentElement, resolveAll({ app: APP_STYLES, notebook }).values());

const px = (element: Element) => Number.parseFloat(getComputedStyle(element).fontSize);

describe('named styles as CSS', () => {
  it('restyles every h1 when h1 changes, without an editor transaction', () => {
    const root = mount('# one\n\ntext\n\n# two', { ids: ['a', 'b', 'c'] });
    show({ h1: { sizePt: 20 } });
    const headings = [...root.querySelectorAll('h1')];
    expect(headings).toHaveLength(2);
    // 20 pt is 26.67 px.
    for (const h1 of headings) expect(px(h1)).toBeCloseTo(26.67, 1);
    const rules = document.getElementById('opennote-named-styles')?.textContent;
    let transactions = 0;
    editor?.on('transaction', () => void (transactions += 1));

    show({ h1: { sizePt: 30 } });

    expect(transactions).toBe(0);
    expect([...root.querySelectorAll('h1')]).toEqual(headings);
    for (const h1 of headings) expect(px(h1)).toBeCloseTo(40, 1);
    expect(document.getElementById('opennote-named-styles')?.textContent).toBe(rules);
    expect(px(root.querySelector('p') as Element)).not.toBeCloseTo(40, 1);
  });

  it('draws an element that names a style with the whole look of that style', () => {
    const root = mount('deep\n\nplain', { ids: ['a', 'b'], styles: { a: 'h7' }, paras: { a: { outline: 7 } } });
    show({ h1: { sizePt: 20 } });
    const [deep, plain] = [...root.querySelectorAll('p')];
    expect(deep.getAttribute('data-pstyle')).toBe('h7');
    // h7 in the app's set: 11.5 pt (15.33 px), semibold, italic. Plain text keeps the page's own size.
    expect(px(deep)).toBeCloseTo(15.33, 1);
    expect(getComputedStyle(deep).fontStyle).toBe('italic');
    expect(getComputedStyle(deep).fontWeight).toBe('600');
    expect(plain.hasAttribute('data-pstyle')).toBe(false);
    expect(getComputedStyle(plain).fontStyle).toBe('normal');
  });
});
