// @vitest-environment jsdom
// AutoCorrect in a mounted editor: replacements when a word ends, capitals kept, each one its own change that
// Backspace reverts, nothing in code, and the person's list replacing the built-in one.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { META_AUTO_CHANGE } from '../meta';
import { mountEditor, testHost, typeInto } from '../commands/testing';
import type { TestEditor } from '../commands/testing';
import { DEFAULT_REPLACEMENTS, correctionFor } from './autocorrect';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function mount(source: string, host = testHost()): TestEditor {
  mounted = mountEditor(source, host);
  return mounted;
}

function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

describe('AutoCorrect', () => {
  it('knows the built-in replacements and keeps capitals', () => {
    expect(correctionFor('teh', DEFAULT_REPLACEMENTS)).toBe('the');
    expect(correctionFor('Teh', DEFAULT_REPLACEMENTS)).toBe('The');
    expect(correctionFor('TEH', DEFAULT_REPLACEMENTS)).toBe('THE');
    expect(correctionFor('(tm)', DEFAULT_REPLACEMENTS)).toBe('™');
    expect(correctionFor('the', DEFAULT_REPLACEMENTS)).toBeNull();
  });

  it('replaces a word when it ends, as its own change after the typed space', () => {
    const page = mount('[]');
    const auto: boolean[] = [];
    page.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) auto.push(Boolean(transaction.getMeta(META_AUTO_CHANGE)));
    });
    typeInto(page.editor, 'Teh cat -> dog (c) ');
    expect(page.editor.state.doc.textContent).toBe('The cat → dog © ');
    expect(auto.filter(Boolean)).toHaveLength(3);
  });

  it('reverts on Backspace right after', () => {
    const page = mount('[]');
    typeInto(page.editor, 'teh ');
    expect(press(page.editor, 'Backspace')).toBe(true);
    expect(page.editor.state.doc.textContent).toBe('teh ');
  });

  it('corrects before Enter splits the line', () => {
    const page = mount('[]');
    typeInto(page.editor, 'teh');
    press(page.editor, 'Enter');
    expect(page.editor.state.doc.firstChild?.textContent).toBe('the');
  });

  it('leaves code alone, and stops when turned off', () => {
    const code = mount('```\n[]\n```');
    typeInto(code.editor, 'teh ');
    expect(code.editor.state.doc.textContent).toBe('teh ');
    code.destroy();
    const host = testHost();
    host.editing = { ...host.editing, autocorrect: { enabled: false, entries: [] } };
    const off = mount('[]', host);
    typeInto(off.editor, 'teh ');
    expect(off.editor.state.doc.textContent).toBe('teh ');
  });

  it('uses the person’s own list in place of the built-in one', () => {
    const host = testHost();
    host.editing = { ...host.editing, autocorrect: { enabled: true, entries: [{ from: 'omw', to: 'on my way' }] } };
    const page = mount('[]', host);
    typeInto(page.editor, 'omw teh ');
    expect(page.editor.state.doc.textContent).toBe('on my way teh ');
  });
});
