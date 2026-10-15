// Writing in text fields with the pen: a fake pointer stream of pen, touch, and mouse presses on the fields.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editableOf, installPenFields } from './penFields';

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.innerHTML = '';
});

function page() {
  document.body.innerHTML = `
    <input type="search" id="search" aria-label="Search">
    <input data-pen-field="rename" id="rename" aria-label="Rename">
    <input id="other" aria-label="Other">
    <div class="ProseMirror" contenteditable="true" id="editor"><table><tr><td id="cell">cell</td></tr></table></div>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    search: get('search'),
    rename: get('rename'),
    other: get('other'),
    cell: get('cell'),
    editor: get('editor'),
  };
}

const press = (target: Element, pointerType: string) =>
  target.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true, pointerId: 2 }));

function install(enabled = true) {
  const show = vi.fn();
  const later = (run: () => void) => run();
  stops.push(installPenFields(document, { enabled: () => enabled, keyboard: () => ({ show }), later }));
  return show;
}

describe('writing in text fields with the pen', () => {
  it('opens the handwriting panel when the pen touches the search box, a rename field, or a table cell', () => {
    const { search, rename, cell, editor } = page();
    const show = install();
    search.focus();
    press(search, 'pen');
    rename.focus();
    press(rename, 'pen');
    editor.focus();
    press(cell, 'pen');
    expect(show).toHaveBeenCalledTimes(3);
    expect(search.getAttribute('virtualkeyboardpolicy')).toBe('manual');
    expect(rename.getAttribute('virtualkeyboardpolicy')).toBe('manual');
    expect(editor.getAttribute('virtualkeyboardpolicy')).toBe('manual');
  });

  it('leaves a finger, the mouse, and every other field alone', () => {
    const { search, other } = page();
    const show = install();
    search.focus();
    press(search, 'touch');
    press(search, 'mouse');
    other.focus();
    press(other, 'pen');
    expect(show).not.toHaveBeenCalled();
    expect(other.hasAttribute('virtualkeyboardpolicy')).toBe(false);
  });

  it('does nothing while the setting is off, and does not open it when the field did not take focus', () => {
    const { search, rename } = page();
    const off = install(false);
    search.focus();
    press(search, 'pen');
    expect(off).not.toHaveBeenCalled();
    stops.splice(0).forEach((stop) => stop());
    const show = install();
    search.focus();
    press(rename, 'pen');
    expect(show).not.toHaveBeenCalled();
  });

  it('stops when told to, and finds the editor around a table cell', () => {
    const { search, cell, editor } = page();
    const show = vi.fn();
    const stop = installPenFields(document, { enabled: () => true, keyboard: () => ({ show }), later: (run) => run() });
    stop();
    search.focus();
    press(search, 'pen');
    expect(show).not.toHaveBeenCalled();
    expect(editableOf(cell)).toBe(editor);
    expect(editableOf(document.body)).toBeNull();
    expect(editableOf(null)).toBeNull();
  });

  it('does nothing where the browser has no virtual keyboard', () => {
    const { search } = page();
    stops.push(installPenFields(document, { enabled: () => true, keyboard: () => undefined, later: (run) => run() }));
    search.focus();
    expect(() => press(search, 'pen')).not.toThrow();
  });
});
