// @vitest-environment jsdom
// Markdown shortcuts in a mounted editor. Each conversion is its own transaction after the typed character, and
// Backspace right after reverts it. Nothing converts while composing, in code, in links, or with the setting off.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { META_AUTO_CHANGE } from '../meta';
import { mountEditor, testHost, typeInto } from '../commands/testing';
import type { TestEditor } from '../commands/testing';

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

const CONVERSIONS: readonly [string, string][] = [
  ['# Title', '# Title'],
  ['### Title', '### Title'],
  ['> Quote', '> Quote'],
  ['- Item', '- Item'],
  ['* Item', '- Item'],
  ['3. Item', '3. Item'],
  ['[ ] Task', '- [ ] Task'],
  ['[x] Done', '- [x] Done'],
  ['> [!tip] Title', '> [!tip] Title'],
  ['```js ', '```js\n```'],
  ['---', '---'],
  ['a **bold** b', 'a **bold** b'],
  ['a __bold__ b', 'a **bold** b'],
  ['a *it* b', 'a *it* b'],
  ['a _it_ b', 'a *it* b'],
  ['a ~~gone~~ b', 'a ~~gone~~ b'],
  ['a ==lit== b', 'a ==lit== b'],
  ['a `code` b', 'a `code` b'],
];

describe('Markdown shortcuts', () => {
  for (const [typed, markdown] of CONVERSIONS) {
    it(`convert “${typed}”`, () => {
      const page = mount('[]');
      typeInto(page.editor, typed);
      expect(page.markdown()).toBe(markdown);
    });
  }

  it('make the conversion its own transaction after the typed character', () => {
    const page = mount('[]');
    const steps: { auto: boolean; text: string }[] = [];
    page.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) {
        steps.push({ auto: Boolean(transaction.getMeta(META_AUTO_CHANGE)), text: transaction.doc.textContent });
      }
    });
    typeInto(page.editor, '# ');
    expect(steps).toEqual([
      { auto: false, text: '#' },
      { auto: false, text: '# ' },
      { auto: true, text: '' },
    ]);
  });

  it('revert on Backspace right after, leaving the typed characters', () => {
    const page = mount('[]');
    typeInto(page.editor, '- ');
    expect(page.markdown()).toBe('-');
    expect(press(page.editor, 'Backspace')).toBe(true);
    expect(page.editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(page.editor.state.doc.textContent).toBe('- ');
  });

  it('keep the conversion when something else happened before Backspace', () => {
    const page = mount('[]');
    typeInto(page.editor, '# T');
    press(page.editor, 'Backspace');
    expect(page.editor.state.doc.firstChild?.type.name).toBe('heading');
  });

  it('check a list item that starts with a box', () => {
    const page = mount('- []');
    typeInto(page.editor, '[ ] Task');
    expect(page.markdown()).toBe('- [ ] Task');
  });

  it('make a code block from a fence on Enter', () => {
    const page = mount('[]');
    typeInto(page.editor, '```py');
    expect(press(page.editor, 'Enter')).toBe(true);
    expect(page.markdown()).toBe('```py\n```');
  });

  it('do nothing in code, in links, or while composing', () => {
    const code = mount('```\n[]\n```');
    typeInto(code.editor, '**b** ');
    expect(code.editor.state.doc.textContent).toBe('**b** ');
    code.destroy();

    const link = mount('[go](https://x.org)');
    link.editor.commands.setTextSelection(2);
    typeInto(link.editor, '**b**');
    expect(link.editor.state.doc.textContent).toContain('**b**');
    link.destroy();

    const composing = mount('[]');
    (composing.editor.view as unknown as { input: { composing: boolean } }).input.composing = true;
    typeInto(composing.editor, '# ');
    expect(composing.editor.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('do nothing when Settings turns them off', () => {
    const host = testHost();
    host.editing = { ...host.editing, markdownShortcuts: false };
    const page = mount('[]', host);
    typeInto(page.editor, '# **b**');
    expect(page.editor.state.doc.textContent).toBe('# **b**');
  });
});
