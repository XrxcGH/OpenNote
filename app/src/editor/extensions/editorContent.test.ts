// @vitest-environment jsdom
// What the Beta 8 walk found in editor content (group 49): callouts reachable by the keyboard, a line below a last
// equation, an Escape that cancels an empty equation, *** and ___ as dividers, and a Copy button on code blocks.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountEditor, typeInto } from '../commands/testing';
import type { TestEditor } from '../commands/testing';
import { openMathAt } from './math';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function mount(source: string): TestEditor {
  mounted = mountEditor(source);
  return mounted;
}

function press(editor: Editor, key: string, options: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

describe('callouts from the keyboard', () => {
  it('moves from the title to the type button on Tab, to the fold button, and back to the text on Escape', () => {
    const page = mount('> [!note]- Title');
    page.editor.commands.setTextSelection(3);
    expect(page.editor.state.selection.$from.parent.type.name).toBe('calloutTitle');
    expect(press(page.editor, 'Tab')).toBe(true);
    const type = page.root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    expect(type).not.toBeNull();
    expect(document.activeElement).toBe(type);
    // Both buttons are in the tab order now, and Escape returns to the text.
    const buttons = [...page.root.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);
    type!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(page.editor.view.dom);
  });

  it('leaves Tab alone in the body of a callout', () => {
    const page = mount('> [!note] Title\n> body');
    const end = page.editor.state.doc.content.size - 1;
    page.editor.commands.setTextSelection(end);
    expect(page.editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(press(page.editor, 'Tab')).toBe(true);
    expect(page.editor.state.doc.textContent).toContain('\t');
  });
});

describe('dividers', () => {
  it('turns *** and ___ on a line of their own into a rule on Enter', () => {
    for (const marks of ['***', '___']) {
      const page = mount('[]');
      typeInto(page.editor, marks);
      expect(press(page.editor, 'Enter')).toBe(true);
      expect(page.markdown()).toBe('---');
      page.destroy();
      mounted = null;
    }
  });
});

describe('equations', () => {
  it('keeps a line below a last equation, and the Markdown is the same', () => {
    const page = mount('Before\n\n$$\nx^2\n$$');
    page.editor.view.dispatch(page.editor.state.tr.setSelection(TextSelection.atStart(page.editor.state.doc)));
    expect(page.editor.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(page.editor.state.doc.lastChild?.content.size).toBe(0);
    expect(page.markdown()).toBe('Before\n\n$$\nx^2\n$$');
  });

  it('takes an empty new equation away when Escape cancels it', () => {
    const page = mount('Text[]');
    const { state } = page.editor;
    const block = state.schema.nodes.mathBlock.create({ source: '' });
    page.editor.view.dispatch(state.tr.replaceSelectionWith(block, false));
    let at = -1;
    page.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'mathBlock') at = pos;
    });
    expect(openMathAt(page.editor, at)).toBe(true);
    const field = page.root.querySelector<HTMLElement>('textarea, input');
    expect(field).not.toBeNull();
    field!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(page.editor.state.doc.firstChild?.textContent).toBe('Text');
    expect(page.markdown()).toBe('Text');
    let math = 0;
    page.editor.state.doc.descendants((node) => void (node.type.name === 'mathBlock' && math++));
    expect(math).toBe(0);
  });
});

describe('code blocks', () => {
  it('copy their whole text from the Copy button', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const page = mount('```js\nconst a = 1;\nconst b = 2;\n```');
    const copy = [...page.root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Copy');
    expect(copy).toBeDefined();
    copy!.click();
    expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = 2;');
    await vi.waitFor(() => expect(page.host.announced).toContain('Copied the code.'));
  });
});
