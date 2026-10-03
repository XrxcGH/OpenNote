// @vitest-environment jsdom
// Tab and Shift+Tab, row by row of ARCHITECTURE.md section 22.4: list items indent and outdent, a paragraph at its
// start becomes or joins a bulleted list, elsewhere Tab types a tab, and code keeps its own Tab.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from '../commands/testing';
import type { TestEditor } from '../commands/testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function mount(source: string): TestEditor {
  mounted = mountEditor(source);
  return mounted;
}

function press(editor: Editor, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

describe('Tab', () => {
  it('indents a list item into the one above, and Shift+Tab brings it back', () => {
    const page = mount('- one\n- []two');
    expect(press(page.editor, 'Tab')).toBe(true);
    expect(page.markdown()).toBe('- one\n\n  - two');
    expect(press(page.editor, 'Tab', true)).toBe(true);
    expect(page.markdown()).toBe('- one\n- two');
  });

  it('keeps the first item where it is, and still stays in the editor', () => {
    const page = mount('- []one');
    expect(press(page.editor, 'Tab')).toBe(true);
    expect(page.markdown()).toBe('- one');
  });

  it('outdents a top-level item to a paragraph, announcing it', () => {
    const page = mount('- []one');
    press(page.editor, 'Tab', true);
    expect(page.markdown()).toBe('one');
    expect(page.host.announced).toEqual(['Text.']);
  });

  it('turns a paragraph at its start into a bulleted item, joining the list above', () => {
    const page = mount('- one\n\n[]two');
    press(page.editor, 'Tab');
    expect(page.markdown()).toBe('- one\n- two');
    expect(page.host.announced).toEqual(['Bulleted list.']);
  });

  it('turns several selected paragraphs into bulleted items', () => {
    const page = mount('one\n\ntwo');
    const { doc } = page.editor.state;
    page.editor.view.dispatch(page.editor.state.tr.setSelection(TextSelection.create(doc, 2, doc.content.size - 2)));
    press(page.editor, 'Tab');
    expect(page.markdown()).toBe('- one\n- two');
  });

  it('types a tab character elsewhere, and Shift+Tab does nothing there', () => {
    const page = mount('one[] two');
    press(page.editor, 'Tab');
    expect(page.editor.state.doc.textContent).toBe('one\t two');
    expect(press(page.editor, 'Tab', true)).toBe(true);
    expect(page.editor.state.doc.textContent).toBe('one\t two');
  });

  it('gives way in code blocks, where Tab indents the line', () => {
    const page = mount('```\nco[]de\n```');
    expect(press(page.editor, 'Tab')).toBe(true);
    expect(page.editor.state.doc.textContent).not.toContain('\t');
    expect(page.editor.state.doc.textContent).toMatch(/^ +code$/);
  });
});
