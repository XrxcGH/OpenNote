// Paragraph direction in a real browser (lane text:language-direction): computed styles and measured positions.
// A right-to-left paragraph computes direction rtl, with its start on the right. An Arabic word never turns a
// left-to-right paragraph around. The caret and the selection follow the text's own order.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost } from '../commands/testing';
import { applyElementData } from '../markdown/elements';
import { parseTextBlock } from '../markdown/parse';
// Importing the module registers the extension in every editor whose host has text.language on.
import { paragraphDirection, setParagraphAttr, setParagraphDirection } from './direction';
import { createBlockEditor } from './kit';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

const ARABIC = 'مرحبا';

function mount(markdown: string, entry: Record<string, unknown> = {}, language = 'en-US'): HTMLElement {
  const root = document.body.appendChild(document.createElement('div'));
  root.style.cssText = 'width: 400px; font: 16px sans-serif; white-space: pre-wrap';
  const doc = applyElementData(parseTextBlock(markdown), { ids: ['a'], paras: { a: entry } });
  const host = testHost();
  host.editing = { ...host.editing, spelling: { enabled: false, languages: [language] } };
  editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host });
  return root;
}

const first = (root: HTMLElement) => root.querySelector('p') as HTMLParagraphElement;

/** The box of the first `text` in `root`. */
function boxOf(root: HTMLElement, text: string): DOMRect {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent?.indexOf(text) ?? -1;
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    return range.getBoundingClientRect();
  }
  throw new Error(`no ${text}`);
}

describe('paragraph direction', () => {
  it('computes direction rtl for a paragraph set to rtl, and align start maps to text-align right', () => {
    const p = first(mount('hello world', { dir: 'rtl', align: 'start' }));
    expect(getComputedStyle(p).direction).toBe('rtl');
    expect(getComputedStyle(p).textAlign).toBe('right');
    // The text sits against the right edge.
    expect(p.getBoundingClientRect().right - boxOf(p, 'hello world').right).toBeLessThan(1);
  });

  it('maps end to the left in a right-to-left paragraph and to the right in a left-to-right one', () => {
    expect(getComputedStyle(first(mount('x', { dir: 'rtl', align: 'end' }))).textAlign).toBe('left');
    editor?.destroy();
    document.body.replaceChildren();
    expect(getComputedStyle(first(mount('x', { align: 'end' }))).textAlign).toBe('right');
  });

  it('keeps a left-to-right paragraph left to right when an Arabic word starts it', () => {
    const root = mount(`${ARABIC} hello`);
    const p = first(root);
    expect(getComputedStyle(p).direction).toBe('ltr');
    expect(p.hasAttribute('dir')).toBe(false);
    // In a left-to-right paragraph the Arabic word, first in the text, is drawn first, on the left.
    expect(boxOf(root, ARABIC).left).toBeLessThan(boxOf(root, 'hello').left);
  });

  it('keeps an Arabic word inside a left-to-right paragraph from turning it around', () => {
    const root = mount(`one ${ARABIC} two`);
    expect(getComputedStyle(first(root)).direction).toBe('ltr');
    expect(boxOf(root, 'one').left).toBeLessThan(boxOf(root, ARABIC).left);
    expect(boxOf(root, ARABIC).left).toBeLessThan(boxOf(root, 'two').left);
  });

  it('puts the caret at the start of a right-to-left paragraph on the right, and selects in text order', () => {
    const root = mount(`${ARABIC} ${ARABIC}`, { dir: 'rtl' });
    const view = editor!.view;
    const start = view.coordsAtPos(1);
    const end = view.coordsAtPos(1 + ARABIC.length * 2 + 1);
    expect(start.left).toBeGreaterThan(end.left);
    expect(first(root).getBoundingClientRect().right - start.left).toBeLessThan(2);
    // The selection over the first word holds that word, and it is drawn at the right edge.
    editor!.commands.setTextSelection({ from: 1, to: 1 + ARABIC.length });
    const { from, to } = editor!.state.selection;
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    expect(range.toString()).toBe(ARABIC);
    expect(range.getBoundingClientRect().right).toBeGreaterThan(first(root).getBoundingClientRect().right - 2);
  });

  it('switches a paragraph between right to left and left to right, keeping its logical alignment', () => {
    const root = mount('text', { align: 'start' });
    const state = () => editor!.state;
    expect(paragraphDirection(state())).toBe('ltr');
    setParagraphDirection(state(), editor!.view.dispatch, 'rtl');
    expect(paragraphDirection(state())).toBe('rtl');
    expect(state().doc.firstChild?.attrs.align).toBe('start');
    expect(getComputedStyle(first(root)).textAlign).toBe('right');
    setParagraphDirection(state(), editor!.view.dispatch, 'ltr');
    expect(state().doc.firstChild?.attrs.dir).toBeNull();
    expect(getComputedStyle(first(root)).textAlign).toBe('left');
  });

  it('carries the direction to the new paragraph on Enter', () => {
    mount('abc', { dir: 'rtl' });
    editor!.commands.setTextSelection(4);
    editor!.commands.enter();
    expect(editor!.state.doc.childCount).toBe(2);
    expect(editor!.state.doc.child(1).attrs.dir).toBe('rtl');
    expect(editor!.view.dom.querySelectorAll('p[dir="rtl"]')).toHaveLength(2);
  });
});

describe('language and hyphenation', () => {
  it('gives the root the page language and a paragraph its own', () => {
    const root = mount('bonjour', { lang: 'fr-FR' }, 'en-US');
    expect(editor!.view.dom.getAttribute('lang')).toBe('en-US');
    expect(first(root).getAttribute('lang')).toBe('fr-FR');
  });

  it('hyphenates a paragraph automatically through its language, and not when it is set off', () => {
    const root = mount('internationalization', { hyphenate: true });
    expect(getComputedStyle(first(root)).hyphens).toBe('auto');
    expect(first(root).closest('[lang]')?.getAttribute('lang')).toBe('en-US');
    setParagraphAttr(editor!.state, editor!.view.dispatch, 'hyphenate', false);
    expect(getComputedStyle(first(root)).hyphens).toBe('manual');
  });
});
