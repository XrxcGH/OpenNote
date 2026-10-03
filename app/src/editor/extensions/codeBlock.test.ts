// @vitest-environment jsdom
// Code blocks in a text editor (PLAN.md section 10.5). The language button is named for its language, and Tab
// indents by the block's indent width. Enter keeps the indent. Three Enters, Arrow Down at the end, and Ctrl+Enter
// leave the block, and the caret's place puts the editor in the "editor.code" key scope.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indentUnit } from '../commands/code';
import { setLanguagePicker } from '../highlight/picker';
import { DEFAULT_EDITING_VIEW } from '../host';
import type { EditorHost } from '../host';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../markdown';
import { createBlockEditor } from './kit';

// jsdom has no layout, and ProseMirror measures a Range when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => false,
  announce: vi.fn(),
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
  setLanguagePicker(null);
});

/** An editor holding `markdown`, with the caret at the end of the code block's text (or `at` into it). */
function codeEditor(markdown: string, at?: number): Editor {
  const root = document.body.appendChild(document.createElement('div'));
  const editor = createBlockEditor(root, parseTextBlock(markdown), { kind: 'text', block: 'b1', host });
  editors.push(editor);
  let start = -1;
  editor.state.doc.descendants((node, pos) => {
    if (start === -1 && node.type.name === 'codeBlock') start = pos + 1;
    return start === -1;
  });
  const code = editor.state.doc.nodeAt(start - 1)!;
  editor.commands.setTextSelection(start + (at ?? code.content.size));
  return editor;
}

function press(editor: Editor, key: string, options: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

const markdownOf = (editor: Editor) => serializeTextBlock(editor.state.doc, createMarkdownCache());

describe('the language button', () => {
  it('is named for the language, out of the text, and opens the picker', () => {
    const editor = codeEditor('```py\nprint(1)\n```');
    const button = editor.view.dom.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Code language: Python');
    expect(button.textContent).toBe('Python');
    expect(button.getAttribute('contenteditable')).toBe('false');
    expect(editor.view.dom.querySelector('code')!.getAttribute('spellcheck')).toBe('false');
    const picker = vi.fn();
    setLanguagePicker(picker);
    button.click();
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ pos: 0, language: 'py', anchor: button }));
  });

  it('says Plain text without a language', () => {
    const editor = codeEditor('```\nplain\n```');
    expect(editor.view.dom.querySelector('button')!.getAttribute('aria-label')).toBe('Code language: Plain text');
  });
});

describe('code keys', () => {
  it('finds the block’s indent width from its lines, then its language', () => {
    expect(indentUnit('a\n  b\n    c', null)).toBe('  ');
    expect(indentUnit('a\n    b', 'javascript')).toBe('    ');
    expect(indentUnit('a\n\tb', null)).toBe('\t');
    expect(indentUnit('a', 'typescript')).toBe('  ');
    expect(indentUnit('a', 'python')).toBe('    ');
  });

  it('indents and outdents the caret’s line with Tab and Shift+Tab', () => {
    const editor = codeEditor('```python\nif x:\nreturn 1\n```');
    expect(press(editor, 'Tab')).toBe(true);
    expect(markdownOf(editor)).toBe('```python\nif x:\n    return 1\n```');
    press(editor, 'Tab', { shiftKey: true });
    expect(markdownOf(editor)).toBe('```python\nif x:\nreturn 1\n```');
  });

  it('indents every selected line', () => {
    const editor = codeEditor('```js\na\nb\nc\n```');
    const start = 1;
    editor.commands.setTextSelection({ from: start, to: start + 'a\nb\nc'.length });
    press(editor, 'Tab');
    expect(markdownOf(editor)).toBe('```js\n  a\n  b\n  c\n```');
    press(editor, 'Tab', { shiftKey: true });
    expect(markdownOf(editor)).toBe('```js\na\nb\nc\n```');
  });

  it('keeps the line’s indent on Enter, and leaves on the third Enter at the end', () => {
    const editor = codeEditor('```js\n  a\n```');
    press(editor, 'Enter');
    expect(editor.state.doc.firstChild!.textContent).toBe('  a\n  ');
    press(editor, 'Enter');
    press(editor, 'Enter');
    expect(editor.state.doc.firstChild!.textContent).toBe('  a');
    expect(editor.state.selection.$head.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.childCount).toBe(2);
  });

  it('leaves with Ctrl+Enter from anywhere in the block', () => {
    const editor = codeEditor('```js\none\ntwo\n```\n\nafter', 1);
    expect(press(editor, 'Enter', { ctrlKey: true })).toBe(true);
    expect(editor.state.selection.$head.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.child(1).content.size).toBe(0);
    expect(editor.state.doc.child(0).textContent).toBe('one\ntwo');
  });

  it('leaves with Arrow Down at the end of a block that ends the text box', () => {
    const editor = codeEditor('```js\nlast\n```');
    expect(press(editor, 'ArrowDown')).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.selection.$head.parent.type.name).toBe('paragraph');
  });

  it('puts the editor in the editor.code scope while the caret is in code', () => {
    const editor = codeEditor('```js\nx\n```\n\nafter');
    expect(editor.view.dom.getAttribute('data-scope')).toBe('editor.code');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.view.dom.getAttribute('data-scope')).toBeNull();
  });

  it('makes a code block from three backticks and a language name', async () => {
    const editor = codeEditor('```js\nx\n```\n\nafter');
    editor.commands.setTextSelection(editor.state.doc.content.size - 'after'.length - 1);
    for (const char of '```ts ') {
      editor.commands.insertContent(char, { applyInputRules: true });
      // Tiptap runs input rules for inserted content in a task of their own.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const made = editor.state.doc.child(1);
    expect(made.type.name).toBe('codeBlock');
    expect(made.attrs.language).toBe('ts');
    expect(made.textContent).toBe('after');
  });
});
