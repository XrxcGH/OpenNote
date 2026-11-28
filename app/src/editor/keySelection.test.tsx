// A key or a press acts on the selection the browser shows, even when the browser's selectionchange event has not
// run yet (keySelection.ts). Each test moves the browser's selection and presses a key in the same task, so the
// queued selectionchange event runs only after the test has looked. That is the order Chromium gave the nightly
// soak: Shift+PageDown, then Backspace before the selectionchange event.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import { mountEditor } from './commands/testing';
import type { TestEditor } from './commands/testing';
import { editorViewAt, installKeySelection, readBrowserSelection } from './keySelection';

let mounted: TestEditor | null = null;
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  mounted?.destroy();
  mounted = null;
  vi.restoreAllMocks();
});

/** ProseMirror's DOM observer, which the module reads through. */
interface Observer {
  flush?: unknown;
  currentSelection?: { eq?: unknown };
}
const observerOf = (view: EditorView) => (view as unknown as { domObserver?: Observer }).domObserver;

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

function pressPointer(element: Element, init: PointerEventInit = {}): void {
  const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', ...init });
  element.dispatchEvent(event);
}

/** The text of the editor's own selection. */
function selected(page: TestEditor): string {
  const { from, to } = page.editor.state.selection;
  return page.editor.state.doc.textBetween(from, to);
}

/** Records the editor's selection when `type` reaches `target`, as a toolbar button or a menu would read it. */
function recordOn(target: EventTarget, type: string, page: TestEditor): string[] {
  const seen: string[] = [];
  const record = () => seen.push(selected(page));
  target.addEventListener(type, record);
  stops.push(() => target.removeEventListener(type, record));
  return seen;
}

/** Waits for the queued selectionchange event, which runs after input and before the next frame. */
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

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

  it('finds the editor from its editable element or anything inside it, and nothing else', () => {
    const page = mount();
    const { view } = page.editor;
    expect(editorViewAt(view.dom)).toBe(view);
    expect(editorViewAt(view.dom.querySelector('p'))).toBe(view);
    expect(editorViewAt(document.body)).toBeNull();
    expect(editorViewAt(null)).toBeNull();
  });

  it('finds no editor in a text field, in editable text ProseMirror does not own, or on the window', () => {
    const field = document.body.appendChild(document.createElement('textarea'));
    const editable = document.body.appendChild(document.createElement('div'));
    editable.contentEditable = 'true';
    stops.push(
      () => field.remove(),
      () => editable.remove(),
    );
    expect(editorViewAt(field)).toBeNull();
    expect(editorViewAt(editable)).toBeNull();
    expect(editorViewAt(window)).toBeNull();
    expect(editorViewAt(document)).toBeNull();
  });
});

describe('input methods', () => {
  it('leaves a composition to the editor, which reads it when the composition ends', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    selectInBrowser(page, 4);
    press(page, 'Process', { isComposing: true, keyCode: 229 });
    expect(page.editor.state.selection.empty).toBe(true);
  });

  it('leaves an Android or on-screen keyboard key (keyCode 229, "Unidentified") to the input method', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    selectInBrowser(page, 4);
    press(page, 'Unidentified', { keyCode: 229 });
    expect(page.editor.state.selection.empty).toBe(true);
  });

  it('leaves the selection alone while the editor composes, even when the key does not say so', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const input = (page.editor.view as unknown as { input: { composing: boolean } }).input;
    input.composing = true;
    selectInBrowser(page, 4);
    press(page, 'a');
    input.composing = false;
    expect(page.editor.state.selection.empty).toBe(true);
  });

  it('reads the selection before a dead key and before each repeat of a held key', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    selectInBrowser(page, 3);
    press(page, 'Dead', { keyCode: 222 });
    expect(selected(page)).toBe('one');
    selectInBrowser(page, 7);
    press(page, 'Shift', { shiftKey: true, repeat: true });
    expect(selected(page)).toBe('one two');
  });
});

describe('a press after the browser moved the selection', () => {
  it('a toolbar button that keeps focus in the text runs on the new selection', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const button = document.body.appendChild(document.createElement('button'));
    stops.push(() => button.remove());
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    const seen = recordOn(button, 'click', page);
    selectInBrowser(page, 3);
    pressPointer(button);
    button.click();
    expect(seen).toEqual(['one']);
  });

  it('a pen press that moves focus to a field keeps the new selection, read only while focused', async () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const field = document.body.appendChild(document.createElement('input'));
    stops.push(() => field.remove());
    selectInBrowser(page, 3);
    pressPointer(field, { pointerType: 'pen' });
    field.focus();
    await settle();
    expect(selected(page)).toBe('one');
  });

  it('the context menu sees the new selection', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const seen = recordOn(document, 'contextmenu', page);
    selectInBrowser(page, 3);
    const text = page.editor.view.dom.querySelector('p');
    text?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(seen).toEqual(['one']);
  });
});

describe('which editor reads', () => {
  it('only the focused one, for a key in it and for a press anywhere', () => {
    stops.push(installKeySelection(window));
    const other = mountEditor('[]alpha beta');
    stops.push(() => other.destroy());
    const page = mount();
    selectInBrowser(page, 3);
    pressPointer(other.editor.view.dom);
    expect(selected(page)).toBe('one');
    expect(other.editor.state.selection.empty).toBe(true);
    selectInBrowser(page, 4);
    press(page, 'Control', { ctrlKey: true });
    expect(selected(page)).toBe('one ');
    expect(other.editor.state.selection.empty).toBe(true);
  });

  it('none, and no error, for an editor that has been destroyed', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const { dom } = page.editor.view;
    page.editor.destroy();
    document.body.appendChild(dom);
    stops.push(() => dom.remove());
    expect(editorViewAt(dom)).toBeNull();
    expect(() => dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))).not.toThrow();
  });
});

describe("ProseMirror's observer, which this module reads through", () => {
  it('still has the flush its selectionchange handler calls, so an upgrade that drops it fails here', () => {
    const page = mount();
    const observer = observerOf(page.editor.view);
    expect(typeof observer?.flush, 'prosemirror-view domObserver.flush: update keySelection.ts').toBe('function');
    expect(typeof observer?.currentSelection?.eq, 'prosemirror-view domObserver.currentSelection').toBe('function');
  });

  it('does nothing, and dispatches nothing, when the selection has not moved', () => {
    stops.push(installKeySelection(window));
    const page = mount();
    const transactions = vi.fn();
    page.editor.on('transaction', transactions);
    for (let i = 0; i < 50; i++) press(page, 'Shift', { shiftKey: true, repeat: i > 0 });
    pressPointer(page.editor.view.dom);
    expect(transactions).not.toHaveBeenCalled();
  });
});

describe('an observer that changed or broke', () => {
  it('warns once and does nothing when the observer has no flush', () => {
    stops.push(installKeySelection(window));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = mount();
    const observer = observerOf(page.editor.view) as Observer;
    Object.defineProperty(observer, 'flush', { value: undefined, configurable: true });
    stops.push(() => delete observer.flush);
    selectInBrowser(page, 4);
    press(page, 'b', { ctrlKey: true });
    press(page, 'i', { ctrlKey: true });
    readBrowserSelection({} as EditorView);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws from the window listener, so the handlers after it still run', () => {
    stops.push(installKeySelection(window));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = mount();
    const observer = observerOf(page.editor.view) as Observer;
    const broken = () => {
      throw new Error('broken observer');
    };
    Object.defineProperty(observer, 'flush', { value: broken, configurable: true });
    stops.push(() => delete observer.flush);
    const uncaught = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener('error', uncaught);
    stops.push(() => window.removeEventListener('error', uncaught));
    const seen = recordOn(window, 'keydown', page);
    press(page, 'Control', { ctrlKey: true });
    pressPointer(page.editor.view.dom);
    expect(uncaught).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(1);
  });
});
