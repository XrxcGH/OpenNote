// A key acts on the selection the browser shows, even when the browser's selectionchange event has not run yet
// (keySelection.ts). Each test moves the browser's selection and presses a key in the same task, so the queued
// selectionchange event runs only after the test has looked. That is the order Chromium gave the nightly soak:
// Shift+PageDown, then Backspace before the selectionchange event.
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from './commands/testing';
import type { TestEditor } from './commands/testing';
import { editorViewAt, installKeySelection } from './keySelection';

let mounted: TestEditor | null = null;
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  mounted?.destroy();
  mounted = null;
});

/** An editor over "one two three" with the caret at its start, focused, and the browser showing that caret. */
function mount(): TestEditor {
  mounted = mountEditor('[]one two three');
  mounted.editor.view.focus();
  return mounted;
}

/** Selects the first `count` characters of the first paragraph in the browser only, as Shift+End would. */
function selectInBrowser(page: TestEditor, count: number): void {
  const text = page.editor.view.dom.querySelector('p')?.firstChild;
  if (!text) throw new Error('The editor has no text.');
  page.editor.view.dom.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, count);
}

function press(page: TestEditor, key: string, init: KeyboardEventInit = {}): void {
  page.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

describe('a key after the browser moved the selection', () => {
  it('Backspace deletes the text the browser shows selected', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    selectInBrowser(page, 4);
    press(page, 'Backspace');
    expect(page.markdown()).toBe('two three');
  });

  it('a shortcut handler on the window, such as the dispatcher, sees the new selection', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const seen: string[] = [];
    const record = () => {
      const { from, to } = page.editor.state.selection;
      seen.push(page.editor.state.doc.textBetween(from, to));
    };
    window.addEventListener('keydown', record, true);
    stops.push(() => window.removeEventListener('keydown', record, true));
    selectInBrowser(page, 3);
    press(page, 'b', { ctrlKey: true });
    expect(seen).toEqual(['one']);
  });

  it('leaves a composition to the editor, which reads it when the composition ends', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    selectInBrowser(page, 4);
    press(page, 'Process', { isComposing: true });
    expect(page.editor.state.selection.empty).toBe(true);
  });

  it('finds the editor from its editable element or anything inside it, and nothing else', () => {
    const page = mount();
    const { view } = page.editor;
    expect(editorViewAt(view.dom)).toBe(view);
    expect(editorViewAt(view.dom.querySelector('p'))).toBe(view);
    expect(editorViewAt(document.body)).toBeNull();
    expect(editorViewAt(null)).toBeNull();
  });
});
