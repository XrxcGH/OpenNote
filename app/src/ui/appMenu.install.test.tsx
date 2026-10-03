// The app installs the context menu listener itself, so an element marked data-app-menu gets the app's menu in the
// running app and not only where a test adds the listener.

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test';

describe('the app context menu in the running app', () => {
  it('replaces the browser menu in an editor and leaves plain fields and the rest alone', async () => {
    await renderApp();
    const editor = document.body.appendChild(document.createElement('div'));
    editor.setAttribute('data-app-menu', 'editor');
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', 'Page text');
    editor.contentEditable = 'true';
    editor.textContent = 'Cells divide by mitosis.';
    const field = document.body.appendChild(document.createElement('input'));
    field.setAttribute('aria-label', 'Plain field');
    try {
      expect(fireEvent.contextMenu(editor, { button: 2, clientX: 40, clientY: 40 })).toBe(false);
      await screen.findByRole('menu', { name: 'Edit' });
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.replace(/Ctrl\+.$/, ''))).toEqual([
        'Cut',
        'Copy',
        'Paste',
        'Select all',
      ]);
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(fireEvent.contextMenu(field, { button: 2, clientX: 60, clientY: 60 })).toBe(true);
      expect(screen.queryByRole('menu', { name: 'Edit' })).toBeNull();
    } finally {
      editor.remove();
      field.remove();
    }
  });
});
