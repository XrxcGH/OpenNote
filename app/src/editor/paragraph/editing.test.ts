// @vitest-environment jsdom
// Paragraph formatting through edits in a real editor (text DESIGN.md 2.3). Enter carries the formatting to a new
// paragraph with a new ID. Backspace keeps the first paragraph's. A version 1 page keeps entries it can't read.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost, typeInto } from '../commands/testing';
import { turnInto } from '../commands/turnInto';
import { createBlockEditor } from '../extensions/kit';
import { applyElementData, extractElementData } from '../markdown/elements';
import { parseTextBlock } from '../markdown/parse';
import { serializeTextBlock } from '../markdown/serialize';
import { LISTS_META } from '../extensions/listItem';
import type { ElementData } from '../markdown/elements';
import { numberItems } from './numbering';
import { deepHeadingAttrs, outlineLevel } from './attributes';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

function mount(markdown: string, data: Partial<ElementData>): Editor {
  const root = document.body.appendChild(document.createElement('div'));
  const doc = applyElementData(parseTextBlock(markdown), data);
  editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host: testHost() });
  return editor;
}

function press(target: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return target.view.someProp('handleKeyDown', (handle) => handle(target.view, event)) ?? false;
}

function caret(target: Editor, pos: number): void {
  target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, pos)));
}

let n = 0;
const newId = () => `new${n++}`;

describe('carrying paragraph formatting', () => {
  it('gives the paragraph that Enter makes at the end of a centered one the same alignment and a new ID', () => {
    const page = mount('Centered', { ids: ['a'], paras: { a: { align: 'center', breakBefore: true } } });
    caret(page, page.state.doc.firstChild!.nodeSize - 1);
    expect(press(page, 'Enter')).toBe(true);
    typeInto(page, 'next');
    // The editor's own document holds no second 'a': extractElementData below would hide one by renaming it.
    expect(page.state.doc.child(0).attrs.id).toBe('a');
    expect(page.state.doc.child(1).attrs.id).not.toBe('a');
    const { data } = extractElementData(page.state.doc, newId);
    expect(data.ids).toHaveLength(2);
    expect(data.ids[0]).toBe('a');
    expect(data.ids[1]).not.toBe('a');
    expect(data.paras).toEqual({ a: { align: 'center', breakBefore: true }, [data.ids[1]]: { align: 'center' } });
  });

  it('keeps the first paragraph and its formatting when Backspace joins the second to it', () => {
    const paras = { a: { align: 'end', indent: { start: 18 } }, b: { align: 'center' } };
    const page = mount('First\n\nSecond', { ids: ['a', 'b'], paras });
    caret(page, page.state.doc.firstChild!.nodeSize + 1);
    expect(press(page, 'Backspace')).toBe(true);
    const { data } = extractElementData(page.state.doc, newId);
    expect(data.ids).toEqual(['a']);
    expect(data.paras).toEqual({ a: paras.a });
    expect(page.state.doc.textContent).toBe('FirstSecond');
  });

  it('gives a new list item the formatting of the item Enter split, but not its ID', () => {
    const page = mount('- one', { ids: ['i1'], paras: { i1: { list: { id: 'l1' }, dropCap: { mode: 'drop' } } } });
    caret(page, page.state.doc.content.size - 3);
    expect(press(page, 'Enter')).toBe(true);
    typeInto(page, 'two');
    const items = page.state.doc.firstChild!;
    expect(items.child(1).attrs.id).not.toBe(items.child(0).attrs.id);
    const { data } = extractElementData(page.state.doc, newId);
    expect(data.ids).toHaveLength(2);
    expect(data.paras[data.ids[1]]).toEqual({ list: { id: 'l1' } });
  });
});

describe('list start numbers in the editor', () => {
  it('counts on after Enter at the end of a restarted item: 1., 2., not 1., 1.', () => {
    const page = mount('1. one', { ids: ['i1'], paras: { i1: { list: { id: 'l1', restart: true } } } });
    caret(page, page.state.doc.content.size - 3);
    expect(press(page, 'Enter')).toBe(true);
    typeInto(page, 'two');
    expect(numberItems(page.state.doc).map((item) => item.label)).toEqual(['1.', '2.']);
    const { data } = extractElementData(page.state.doc, newId);
    expect(data.paras[data.ids[1]]).toEqual({ list: { id: 'l1' } });
  });

  it('keeps a continued list writing the number it shows, and a restart writing its start (R-LIST-3)', () => {
    const list = { list: { id: 'l1' } };
    const page = mount('1. one\n2. two\n\nBetween\n\n1. three', {
      ids: ['i1', 'i2', 'p', 'i3'],
      paras: { i1: list, i2: list, i3: list },
    });
    page.view.dispatch(page.state.tr.setMeta(LISTS_META, { l1: { levels: [{ start: 1 }] } }));
    expect(serializeTextBlock(page.state.doc)).toBe('1. one\n2. two\n\nBetween\n\n3. three');
    const last = page.state.doc.lastChild!.firstChild!;
    const at = page.state.doc.content.size - page.state.doc.lastChild!.nodeSize + 1;
    const restart = { ...last.attrs, list: { id: 'l1', restart: true } };
    page.view.dispatch(page.state.tr.setNodeMarkup(at, undefined, restart));
    expect(serializeTextBlock(page.state.doc)).toBe('1. one\n2. two\n\nBetween\n\n1. three');
  });
});

describe('turning a formatted paragraph into a code block and back', () => {
  it('keeps the entry whole in the code block, then reads its known keys again in the paragraph', () => {
    const entry = { align: 'center', later: 1 };
    const page = mount('Words', { ids: ['a'], paras: { a: entry } });
    caret(page, 2);
    expect(turnInto('codeBlock')(page.state, page.view.dispatch)).toBe(true);
    const code = page.state.doc.firstChild!;
    expect(code.type.name).toBe('codeBlock');
    expect(code.attrs.paraRest).toEqual(entry);
    expect(turnInto('paragraph')(page.state, page.view.dispatch)).toBe(true);
    const back = page.state.doc.firstChild!;
    expect(back.attrs.align).toBe('center');
    expect(back.attrs.paraRest).toEqual({ later: 1 });
    expect(back.attrs.id).toBe('a');
  });
});

describe('a version 1 page', () => {
  it('keeps the paras keys it does not know through typing and Enter', () => {
    const entry = { align: 'justify', fromLater: { x: 1 } };
    const page = mount('Text\n\nMore', { ids: ['a', 'b'], paras: { a: entry, b: { unknownOnly: true } } });
    caret(page, 3);
    typeInto(page, 'xy');
    const { data } = extractElementData(page.state.doc, newId);
    expect(data.paras).toEqual({ a: entry, b: { unknownOnly: true } });
  });
});

describe('headings 7 to 9', () => {
  it('are paragraphs with the style h7 to h9 and an outline level', () => {
    const doc = applyElementData(parseTextBlock('# One\n\nDeep\n\nBody'), {
      ids: ['h', 'p', 'b'],
      styles: { p: 'h8' },
      paras: { p: { outline: deepHeadingAttrs(8).outline } },
    });
    expect(deepHeadingAttrs(8)).toEqual({ style: 'h8', outline: 8 });
    const levels: (number | null)[] = [];
    doc.forEach((node) => levels.push(outlineLevel(node)));
    expect(levels).toEqual([1, 8, null]);
  });
});
