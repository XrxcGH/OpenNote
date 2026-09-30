// F6 between regions (ARCHITECTURE.md section 11.6): the title bar, command bar, notebooks, pages, and page, each
// remembering where focus was.

import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navigate } from '../app/location';
import type { NodeId } from '../services/notes/types';
import { expectFocus, pressChord, renderApp } from '../test';

const regionOfFocus = () => document.activeElement?.closest('[data-region]')?.getAttribute('data-region');

describe('regions', () => {
  it('moves through the regions with F6 and back with Shift+F6, wrapping around', async () => {
    await renderApp({ sizeClass: 'wide' });
    act(() =>
      navigate({
        view: 'workspace',
        notebookId: 'n-biology' as NodeId,
        sectionId: 's-lectures' as NodeId,
        pageId: null,
      }),
    );
    (await screen.findByRole('treeitem', { name: 'Labs' })).focus();
    await screen.findByRole('treeitem', { name: 'Mitosis' });
    const visited: (string | null | undefined)[] = [];
    for (let i = 0; i < 5; i += 1) {
      await pressChord('F6');
      visited.push(regionOfFocus());
    }
    expect(visited).toEqual(['pages', 'page', 'titleBar', 'commandBar', 'notebooks']);
    await expectFocus(screen.getByRole('treeitem', { name: 'Labs' }));
    await pressChord('Shift+F6');
    expect(regionOfFocus()).toBe('commandBar');
    await pressChord('Shift+F6');
    expect(regionOfFocus()).toBe('titleBar');
    await pressChord('Shift+F6');
    expect(regionOfFocus()).toBe('page');
  });

  it('returns to the element last focused in a region', async () => {
    await renderApp({ sizeClass: 'wide' });
    act(() =>
      navigate({
        view: 'workspace',
        notebookId: 'n-biology' as NodeId,
        sectionId: 's-lectures' as NodeId,
        pageId: null,
      }),
    );
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    (await within(pages).findByRole('treeitem', { name: 'Meiosis' })).focus();
    await pressChord('F6');
    expect(regionOfFocus()).toBe('page');
    await pressChord('Shift+F6');
    await expectFocus(within(pages).getByRole('treeitem', { name: 'Meiosis' }));
  });

  it('works from a text field, and skips a collapsed pane’s content for its rail', async () => {
    await renderApp({ sizeClass: 'wide' });
    act(() =>
      navigate({
        view: 'workspace',
        notebookId: 'n-biology' as NodeId,
        sectionId: 's-lectures' as NodeId,
        pageId: null,
      }),
    );
    await screen.findByRole('treeitem', { name: 'Cell structure' });
    await pressChord('Ctrl+Shift+1');
    // Collapsing the pane moves focus to its rail once the layout settles. Wait for that before moving focus again.
    await expectFocus(await screen.findByRole('button', { name: 'Show notebooks' }));
    // Start-up focus placement watches the page for a moment longer, and would pull focus back to the rail.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const field = document.createElement('input');
    field.setAttribute('aria-label', 'Scratch');
    screen.getByRole('main').append(field);
    field.focus();
    await pressChord('Shift+F6');
    expect(regionOfFocus()).toBe('pages');
    await pressChord('Shift+F6');
    await expectFocus(screen.getByRole('button', { name: 'Show notebooks' }));
    field.remove();
  });
});
