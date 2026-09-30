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
    (await screen.findByRole('button', { name: 'Labs' })).focus();
    await screen.findByRole('button', { name: 'Mitosis' });
    const visited: (string | null | undefined)[] = [];
    for (let i = 0; i < 4; i += 1) {
      await pressChord('F6');
      visited.push(regionOfFocus());
    }
    expect(visited).toEqual(['pages', 'page', 'titleBar', 'notebooks']);
    await expectFocus(screen.getByRole('button', { name: 'Labs' }));
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
    (await within(pages).findByRole('button', { name: 'Meiosis' })).focus();
    await pressChord('F6');
    expect(regionOfFocus()).toBe('page');
    await pressChord('Shift+F6');
    await expectFocus(within(pages).getByRole('button', { name: 'Meiosis' }));
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
    await screen.findByRole('button', { name: 'Cell structure' });
    await pressChord('Ctrl+Shift+1');
    await screen.findByRole('button', { name: 'Show notebooks' });
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
