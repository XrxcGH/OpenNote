// The title bar's More menu: every item that moved into it is a labeled row, in the order the bar shows them
// (Beta 8 walk VA-43: Redo, Undo and Dark mode were bare icons, and Redo came before Undo).

import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { titleBarItems } from '../../registries';
import { renderApp } from '../../test';
import { TitleBarOverflow } from './TitleBarOverflow';

describe('the title bar More menu', () => {
  it('lists Undo, Redo and Dark mode as named rows, Undo before Redo', async () => {
    await renderApp();
    // They move in by priority (Redo first), and show in the bar's own order.
    const moved = ['page.redoButton', 'page.undoButton', 'theme.toggle'].map((id) => {
      const item = titleBarItems.get(id);
      if (!item) throw new Error(`no title bar item ${id}`);
      return item;
    });
    render(createElement(TitleBarOverflow, { items: moved }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('dialog', { name: 'More' });
    const rows = [...menu.querySelectorAll('button')].map((row) => row.querySelector('span')?.textContent);
    expect(rows).toEqual(['Undo', 'Redo', 'Dark mode']);
    expect(
      within(menu)
        .getByRole('switch', { name: /Dark mode/ })
        .getAttribute('aria-checked'),
    ).toBe('false');
  });
});
