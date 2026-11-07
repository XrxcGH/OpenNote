// checks-disable-file brand-consistency: colors and sizes here are test inputs or CSS for other apps, not design values.
// Copy in a real browser (ADR 0084): a real copy event on a real editor, so the style text is the text we wrote and
// not what jsdom writes back. A run in Georgia 13 pt red copies as one span whose style holds all three, and the
// Markdown flavor is on the clipboard too.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost } from '../commands/testing';
import { createBlockEditor } from '../extensions/kit';
import { parseTextBlock } from '../markdown/parse';
// Importing the module registers the extension in every text editor whose host has text.pasteFidelity on.
import './index';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

function copyOf(markdown: string): DataTransfer {
  const root = document.body.appendChild(document.createElement('div'));
  editor = createBlockEditor(root, parseTextBlock(markdown), { kind: 'text', block: 'b1', host: testHost() });
  editor.commands.selectAll();
  const clipboardData = new DataTransfer();
  editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }));
  return clipboardData;
}

describe('copy in a browser', () => {
  it('writes Georgia 13 pt red as a span whose style holds all three, with the data attributes beside it', () => {
    const data = copyOf(
      '<span data-font="Georgia"><span data-size="13"><span data-color="#c00000">Hello</span></span></span>',
    );
    const html = data.getData('text/html');
    const span = new DOMParser().parseFromString(html, 'text/html').querySelector('span[style]') as HTMLElement;
    expect(span.textContent).toBe('Hello');
    const style = span.getAttribute('style') ?? '';
    expect(style).toContain('font-family:Georgia');
    expect(style).toContain('font-size:13pt');
    expect(style).toContain('color:#c00000');
    expect(span.getAttribute('data-color')).toBe('#c00000');
    expect(data.getData('text/plain')).toBe('Hello');
  });

  it('adds the Markdown flavor', () => {
    const data = copyOf('Some **bold** words');
    expect(data.getData('text/markdown')).toBe('Some **bold** words');
  });
});
