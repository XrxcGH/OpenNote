// \alpha-style autocompletion in page text, driven by real typing in a real editor.
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Code from '@tiptap/extension-code';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { readRecent, resetRecent } from '../symbols/recent';
import { symbolsExtension } from './symbolsExt';

let editor: Editor;
let host: HTMLElement;

beforeEach(async () => {
  resetRecent();
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [Document, Paragraph, Text, Code, symbolsExtension()],
    content: '<p></p>',
  });
  editor.commands.focus();
  // Tiptap moves the focus on the next frame, and a slow runner types before then: wait until the editor has it.
  await vi.waitFor(() => expect(editor.view.hasFocus()).toBe(true));
});
afterEach(() => {
  editor.destroy();
  host.remove();
});

const list = () => document.querySelector<HTMLElement>('[role="listbox"]');
const text = () => editor.state.doc.textContent;
// userEvent.keyboard treats [ and { as key names, so a backslash is typed with a doubled one only for literal text.
const type = (value: string) => userEvent.keyboard(value);

describe('symbol autocompletion', () => {
  it('turns a complete name followed by a space into the symbol', async () => {
    await type('\\alpha ');
    expect(text()).toBe('α ');
    expect(readRecent()).toEqual(['α']);
  });
  it('turns a name before a closing mark into the symbol too, and keeps the mark', async () => {
    await type('(\\theta)');
    expect(text()).toBe('(θ)');
  });
  it('tells capital letters from small ones', async () => {
    await type('\\Delta \\delta ');
    expect(text()).toBe('Δ δ ');
  });
  it('leaves other LaTeX alone', async () => {
    await type('\\notaname ');
    expect(text()).toBe('\\notaname ');
  });
  it('shows matching symbols while a name is typed, and Enter puts the chosen one in', async () => {
    await type('\\gam');
    expect(list()?.hidden).toBe(false);
    const rows = Array.from(list()?.querySelectorAll('[role="option"]') ?? []);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
    expect(rows[0]?.textContent).toContain('\\gamma');
    await type('{Enter}');
    expect(text()).toBe('γ');
    expect(list()?.hidden).toBe(true);
  });
  it('moves with the arrow keys and accepts with Tab', async () => {
    await type('\\gam{ArrowDown}');
    const rows = Array.from(list()?.querySelectorAll('[role="option"]') ?? []);
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true');
    const expected = rows[1]?.textContent?.charAt(0);
    await type('{Tab}');
    expect(text()).toBe(expected);
  });
  it('closes on Escape and keeps the typed text', async () => {
    await type('\\gam{Escape}');
    expect(list()?.hidden).toBe(true);
    expect(text()).toBe('\\gam');
  });
  it('does nothing inside code', async () => {
    editor.commands.toggleCode();
    await type('\\alpha ');
    expect(text()).toBe('\\alpha ');
    expect(list()?.hidden ?? true).toBe(true);
  });
  it('does not fire in the middle of a word or after a double backslash', async () => {
    await type('a\\alpha \\\\beta ');
    expect(text()).toBe('a\\alpha \\\\beta ');
  });
});
