// The tab layout in a real browser (text DESIGN.md 7.2): measured positions, not worked-out ones. A decimal stop at
// 144 pt puts the decimal sign of 12.50 at 144 pt, within half a pixel, and a default stop ends a tab at 36 pt.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost } from '../commands/testing';
import { createBlockEditor } from '../extensions/kit';
import { applyElementData } from '../markdown/elements';
import { parseTextBlock } from '../markdown/parse';
// Importing the module registers the layout in every text editor whose host has text.paraFormats on.
import { PX_PER_PT } from './tabLayout';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

function mount(markdown: string, entry: Record<string, unknown>): HTMLElement {
  const root = document.body.appendChild(document.createElement('div'));
  root.style.cssText = 'width: 600px; padding: 0 0 0 20px; font: 16px serif; white-space: pre-wrap';
  const doc = applyElementData(parseTextBlock(markdown), { ids: ['a'], paras: { a: entry } });
  editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host: testHost() });
  return root;
}

const frames = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise((done) => requestAnimationFrame(() => done(null)));
};

/** The x of the first `char` in `root`, from the root's content edge, in points. */
function xOf(root: HTMLElement, char: string): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent?.indexOf(char) ?? -1;
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    const left = root.getBoundingClientRect().left + 20;
    return (range.getBoundingClientRect().left - left) / PX_PER_PT;
  }
  throw new Error(`no ${char}`);
}

describe('tab layout', () => {
  it('puts the decimal sign of 12.50 at a decimal stop at 144 pt', async () => {
    const root = mount('Total\t12.50', { tabs: [{ pos: 144, align: 'decimal' }] });
    await frames(8);
    expect(Math.abs(xOf(root, '.') - 144) * PX_PER_PT).toBeLessThan(0.5);
  });

  it('ends a tab after a short word at the default stop at 36 pt', async () => {
    const root = mount('ab\tc', {});
    await frames(8);
    expect(Math.abs(xOf(root, 'c') - 36) * PX_PER_PT).toBeLessThan(0.5);
  });

  it('lays out again only the paragraph a key changed, and keeps the stop', async () => {
    const root = mount('ab\tc\n\nother', {});
    await frames(8);
    editor!.view.dispatch(editor!.state.tr.insertText('xy', 1));
    await frames(8);
    expect(Math.abs(xOf(root, 'c') - 36) * PX_PER_PT).toBeLessThan(0.5);
    // A tab typed into the second paragraph is found and laid out, without a walk of the note.
    const end = editor!.state.doc.content.size - 1;
    editor!.view.dispatch(editor!.state.tr.insertText('\tz', end));
    await frames(8);
    expect(Math.abs(xOf(root, 'z') - 36) * PX_PER_PT).toBeLessThan(0.5);
  });
});
