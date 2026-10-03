// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { testHost } from '../../../editor/commands/testing';
import { parseTextBlock } from '../../../editor/markdown';
import { addressRange, isBareAddress, showTitle, usableTitle } from './linkTitle';

const host = testHost();

function editorFor(markdown: string): Editor {
  const root = document.createElement('div');
  document.body.append(root);
  return createBlockEditor(root, parseTextBlock(markdown), { kind: 'text', block: 'b1', host });
}

describe('link titles', () => {
  it('knows a lone web address', () => {
    expect(isBareAddress('https://example.com/a?b=1')).toBe(true);
    expect(isBareAddress('  http://example.com  ')).toBe(true);
    expect(isBareAddress('see https://example.com')).toBe(false);
    expect(isBareAddress('ftp://example.com')).toBe(false);
    expect(isBareAddress('https://')).toBe(false);
  });

  it('shows only a title that adds something', () => {
    expect(usableTitle('  Cell   division ', 'https://x.test')).toBe('Cell division');
    expect(usableTitle(null, 'https://x.test')).toBeNull();
    expect(usableTitle('https://x.test', 'https://x.test')).toBeNull();
    expect(usableTitle('x'.repeat(201), 'https://x.test')).toBeNull();
  });

  it('replaces the address with a linked title where the address still stands', () => {
    const address = 'https://example.com/cells';
    const editor = editorFor(`Read ${address}`);
    const end = editor.state.doc.content.size - 1;
    expect(addressRange(editor, end, address)).toEqual({ from: end - address.length, to: end });
    expect(showTitle(editor, end, address, 'Cell division')).toBe(true);
    const text = editor.state.doc.textContent;
    expect(text).toBe('Read Cell division');
    let href = '';
    editor.state.doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === 'link');
      if (mark) href = mark.attrs.href as string;
    });
    expect(href).toBe(address);
    editor.destroy();
  });

  it('leaves the text alone when the address is gone', () => {
    const address = 'https://example.com/cells';
    const editor = editorFor('Something else entirely here, longer than the address');
    expect(showTitle(editor, editor.state.doc.content.size - 1, address, 'Title')).toBe(false);
    editor.destroy();
  });
});
