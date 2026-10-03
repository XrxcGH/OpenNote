import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installLayerEscape } from '../state/layers';
import { expectFocus, pressChord, renderUi } from '../test';
import { openAppContextMenu, registerAppMenu } from './appMenu';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  cleanups.push(installLayerEscape());
  document.addEventListener('contextmenu', openAppContextMenu);
  cleanups.push(() => document.removeEventListener('contextmenu', openAppContextMenu));
});
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function Editor() {
  return (
    <>
      <div data-app-menu="editor" contentEditable suppressContentEditableWarning aria-label="Page text" role="textbox">
        Cells divide by mitosis.
      </div>
      <label>
        Title
        <input defaultValue="Mitosis" />
      </label>
    </>
  );
}

function selectWord(element: Element, word: string) {
  const text = element.firstChild as Text;
  const start = text.data.indexOf(word);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + word.length);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

describe('the app context menu in editors', () => {
  it('replaces the browser menu with Cut, Copy, Paste, and Select all', async () => {
    renderUi(<Editor />);
    const editor = screen.getByRole('textbox', { name: 'Page text' });
    editor.focus();
    selectWord(editor, 'divide');
    const shown = fireEvent.contextMenu(editor, { button: 2, clientX: 40, clientY: 40 });
    expect(shown).toBe(false);
    await screen.findByRole('menu', { name: 'Edit' });
    const names = screen.getAllByRole('menuitem').map((entry) => entry.textContent);
    expect(names).toEqual(['CutCtrl+X', 'CopyCtrl+C', 'PasteCtrl+V', 'Select allCtrl+A']);
    expect(screen.getByRole('menuitem', { name: 'Cut' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('turns off Cut and Copy without a selection', async () => {
    renderUi(<Editor />);
    const editor = screen.getByRole('textbox', { name: 'Page text' });
    editor.focus();
    document.getSelection()?.collapse(editor.firstChild, 0);
    fireEvent.contextMenu(editor, { button: 2, clientX: 40, clientY: 40 });
    await screen.findByRole('menu', { name: 'Edit' });
    expect(screen.getByRole('menuitem', { name: 'Cut' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Copy' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('app context menu items', () => {
  it('selects all of the editor and returns focus to it', async () => {
    renderUi(<Editor />);
    const editor = screen.getByRole('textbox', { name: 'Page text' });
    editor.focus();
    fireEvent.contextMenu(editor, { button: 2, clientX: 40, clientY: 40 });
    await screen.findByRole('menu', { name: 'Edit' });
    await pressChord('End');
    await pressChord('Enter');
    await expectFocus(editor);
    expect(document.getSelection()?.toString()).toBe('Cells divide by mitosis.');
  });

  it('keeps the browser menu in plain text fields', () => {
    renderUi(<Editor />);
    const shown = fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Title' }), { button: 2 });
    expect(shown).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uses the builder registered for the kind', async () => {
    const remove = registerAppMenu('editor', ({ host }) => ({
      label: 'Spelling',
      items: [{ id: 'fix', label: `Replace in ${host.getAttribute('aria-label')}` }],
    }));
    cleanups.push(remove);
    expect(() => registerAppMenu('editor', () => null)).toThrow();
    renderUi(<Editor />);
    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Page text' }), { button: 2, clientX: 5, clientY: 5 });
    await screen.findByRole('menu', { name: 'Spelling' });
    expect(screen.getByRole('menuitem', { name: 'Replace in Page text' })).toBeTruthy();
  });
});
