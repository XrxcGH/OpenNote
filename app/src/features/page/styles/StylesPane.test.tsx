// The Styles pane (text DESIGN.md 5.3): it lists the gallery's styles with a preview, their source, and their look,
// applies one on activate, moves between them with the arrow keys, and closes with Escape.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testHost } from '../../../editor/commands/testing';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { applyElementData, extractElementData } from '../../../editor/markdown/elements';
import { parseTextBlock } from '../../../editor/markdown/parse';
import { closeStylesPane, previewStyle, toggleStylesPane } from './StylesPane';
import { notebookStyles, pageSheet } from './store';

let editor: Editor | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => closeStylesPane());
  editor?.destroy();
  editor = null;
  notebookStyles.set({});
  pageSheet.set(null);
  document.body.replaceChildren();
});

const pane = () => document.querySelector('[data-region="styles-pane"]');
const entry = (name: string) => document.querySelector<HTMLButtonElement>(`button[data-style-name="${name}"]`);

describe('the Styles pane', () => {
  it('lists the gallery with each style source and look, and follows changes to the styles', () => {
    notebookStyles.set({ nb: { h2: { sizePt: 16 }, 'u-lab': { label: 'Lab notes', basedOn: 'h2' } } });
    act(() => toggleStylesPane('nb'));
    const names = [...document.querySelectorAll('button[data-style-name]')].map((b) =>
      b.getAttribute('data-style-name'),
    );
    expect(names.slice(0, 4)).toEqual(['title', 'subtitle', 'normal', 'h1']);
    expect(names).not.toContain('h7');
    expect(entry('u-lab')?.textContent).toContain('Lab notes');
    expect(entry('u-lab')?.textContent).toContain('This notebook');
    expect(entry('u-lab')?.textContent).toContain('16 pt');
    expect(entry('h1')?.textContent).toContain('Built in');
    // The first style has the focus, so the keys work at once.
    expect(document.activeElement).toBe(entry('title'));
    act(() => notebookStyles.set({ nb: { h2: { sizePt: 20 } } }));
    expect(entry('u-lab')).toBeNull();
    expect(entry('h2')?.textContent).toContain('20 pt');
  });

  it('applies the activated style to the selected paragraph', () => {
    const root = document.body.appendChild(document.createElement('div'));
    editor = createBlockEditor(root, applyElementData(parseTextBlock('one'), { ids: ['a'] }), {
      kind: 'text',
      block: 'b1',
      host: testHost(),
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    act(() => toggleStylesPane('nb', () => editor));
    act(() => entry('quote')?.click());
    expect(extractElementData(editor.state.doc, () => 'new').data.styles).toEqual({ a: 'quote' });
    act(() => entry('h2')?.click());
    expect(editor.state.doc.child(0).type.name).toBe('heading');
  });

  it('moves with the arrow keys and closes with Escape, giving the focus back', () => {
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    act(() => toggleStylesPane('nb'));
    const key = (name: string) =>
      act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
      });
    key('ArrowDown');
    expect(document.activeElement).toBe(entry('subtitle'));
    key('End');
    const all = document.querySelectorAll('button[data-style-name]');
    expect(document.activeElement).toBe(all[all.length - 1]);
    key('Home');
    expect(document.activeElement).toBe(entry('title'));
    key('Escape');
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('caps the preview size so a large title still fits', () => {
    expect(previewStyle({ font: 'Georgia', sizePt: 27, weight: 600, italic: true })).toEqual({
      fontFamily: JSON.stringify('Georgia'),
      fontSize: '15pt',
      fontWeight: 600,
      fontStyle: 'italic',
    });
  });
});
