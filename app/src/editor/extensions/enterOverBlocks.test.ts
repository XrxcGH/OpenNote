// @vitest-environment jsdom
// Enter over a selection that spans text blocks (nightly soak, seed 87). The Enter keys work out where to split from
// the selection's start before they delete the selection. When the selection holds a whole list item, the deletion
// takes the item, the start lands between list items, and Tiptap's splitBlock threw "Cannot join bulletList onto
// paragraph". The editor now deletes the selection first and splits at the caret the deletion leaves.
import type { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from '../commands/testing';
import type { TestEditor } from '../commands/testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

const p = (text = ''): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const list = (type: string, ...content: JSONContent[]): JSONContent => ({ type, content });

/** Mounts a document and selects from `from` to `to`, both in text. */
function mount(content: JSONContent[], from: number, to: number): Editor {
  mounted = mountEditor('[]x');
  const { editor } = mounted;
  editor.commands.setContent({ type: 'doc', content });
  const { doc } = editor.state;
  expect(doc.resolve(from).parent.inlineContent && doc.resolve(to).parent.inlineContent).toBe(true);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)));
  return editor;
}

/** The document as nested type names and text, e.g. "bulletList(listItem(paragraph(cd)))". */
function shape(editor: Editor): string {
  const walk = (node: JSONContent): string =>
    node.type === 'text' ? (node.text ?? '') : `${node.type}(${(node.content ?? []).map(walk).join(',')})`;
  return (editor.getJSON().content ?? []).map(walk).join(',');
}

describe('Enter over a selection that spans text blocks', () => {
  it('splits after deleting a whole item with a nested list (the soak, seed 87)', () => {
    // bulletList(item(""), item("", bulletList(item("ab")))), "": from the second item's empty paragraph (7) to the
    // end of "ab" (13). The deletion takes the whole second item.
    const editor = mount([list('bulletList', li(p()), li(p(), list('bulletList', li(p('ab'))))), p()], 7, 13);
    expect(() => press(editor, 'Enter')).not.toThrow();
    expect(shape(editor)).toBe('bulletList(listItem(paragraph())),paragraph(),paragraph()');
  });

  it('splits after deleting a whole item of a numbered list', () => {
    // orderedList(item("cd"), item("ef", bulletList(item("ab")))), "gh": from the start of "ef" (9) to the end of
    // "ab" (17).
    const editor = mount(
      [list('orderedList', li(p('cd')), li(p('ef'), list('bulletList', li(p('ab'))))), p('gh')],
      9,
      17,
    );
    expect(() => press(editor, 'Enter')).not.toThrow();
    expect(shape(editor)).toBe('orderedList(listItem(paragraph(cd))),paragraph(),paragraph(gh)');
  });

  it('splits after deleting into an item of two paragraphs', () => {
    // "ab", an empty heading, bulletList(item("", "ab"), item("c")): from the heading (5) to inside "ab" (12).
    const heading: JSONContent = { type: 'heading', attrs: { level: 2 }, content: [] };
    const editor = mount([p('ab'), heading, list('bulletList', li(p(), p('ab')), li(p('c')))], 5, 12);
    expect(() => press(editor, 'Enter')).not.toThrow();
    expect(shape(editor)).toBe(
      'paragraph(ab),bulletList(listItem(paragraph()),listItem(paragraph(b)),listItem(paragraph(c)))',
    );
  });

  it('makes a new item, not a second paragraph, over text in two items', () => {
    // bulletList(item("cd"), item("ef")): from after "c" (4) to after "e" (10).
    const editor = mount([list('bulletList', li(p('cd')), li(p('ef')))], 4, 10);
    press(editor, 'Enter');
    expect(shape(editor)).toBe('bulletList(listItem(paragraph(c)),listItem(paragraph(f)))');
  });

  it('leaves a selection inside one block to the usual Enter', () => {
    // "abcd" with "bc" selected: the usual split.
    const editor = mount([p('abcd')], 2, 4);
    press(editor, 'Enter');
    expect(shape(editor)).toBe('paragraph(a),paragraph(d)');
  });
});
