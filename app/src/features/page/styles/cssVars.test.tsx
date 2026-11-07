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

  it('keeps the page line height and spacing on a styled paragraph whose style sets none', () => {
    // The page's own paragraph rule, in the same layer as the generated rules and less specific than them, so a
    // generated line-height or margin would win over it.
    const page = document.head.appendChild(document.createElement('style'));
    page.textContent = `@layer components { [data-scope~='page'] p { line-height: 1.625; margin-block: 6px 12px; } }`;
    try {
      const root = mount('quoted\n\nmine\n\nplain', { ids: ['a', 'b', 'c'], styles: { a: 'quote', b: 'u-x' } });
      show({ 'u-x': { label: 'Mine', weight: 600 } });
      const [quoted, mine, plain] = [...root.querySelectorAll('p')];
      expect(quoted.getAttribute('data-pstyle')).toBe('quote');
      expect(getComputedStyle(quoted).fontStyle).toBe('italic');
      expect(getComputedStyle(mine).fontWeight).toBe('600');
      // The line height as a multiple of the element's own size, so a style's size doesn't change the comparison.
      const box = (element: Element) => {
        const style = getComputedStyle(element);
        return [(Number.parseFloat(style.lineHeight) / px(element)).toFixed(3), style.marginTop, style.marginBottom];
      };
      expect(box(plain)).toEqual(['1.625', '6px', '12px']);
      expect(box(quoted)).toEqual(box(plain));
      expect(box(mine)).toEqual(box(plain));
    } finally {
      page.remove();
    }
  });
});
