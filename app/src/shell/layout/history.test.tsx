// Back and forward (ARCHITECTURE.md section 5.3, FEATURES.md "Back and forward"): Alt+Left and Alt+Right, the
// mouse's side buttons, the scroll position each step returns to, "Reveal in tree", and the window title.

import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getLocation, navigate } from '../../app/location';
import type { Location } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeId } from '../../services/notes/types';
import { sessionStore } from '../../state/session';
import { expectFocus, pressChord, renderApp } from '../../test';

const pageAt = (pageId: string): Location => ({
  view: 'workspace',
  notebookId: 'n-biology' as NodeId,
  sectionId: 's-lectures' as NodeId,
  pageId: pageId as NodeId,
});

describe('history', () => {
  it('steps back and forward with Alt+Left and Alt+Right', async () => {
    await renderApp();
    act(() => navigate(pageAt('p-mitosis')));
    act(() => navigate(pageAt('p-meiosis')));
    await pressChord('Alt+Left');
    await expect.poll(getLocation).toEqual(pageAt('p-mitosis'));
    await pressChord('Alt+Right');
    await expect.poll(getLocation).toEqual(pageAt('p-meiosis'));
    await expect.poll(() => document.title).toBe('Meiosis - OpenNote');
  });

  it('steps back and forward with the mouse’s side buttons', async () => {
    await renderApp();
    act(() => navigate(pageAt('p-mitosis')));
    act(() => navigate(pageAt('p-meiosis')));
    const main = screen.getByRole('main');
    const down = fireEvent.mouseDown(main, { button: 3 });
    fireEvent.mouseUp(main, { button: 3 });
    expect(down).toBe(false);
    await expect.poll(getLocation).toEqual(pageAt('p-mitosis'));
    fireEvent.mouseUp(main, { button: 4 });
    await expect.poll(getLocation).toEqual(pageAt('p-meiosis'));
  });

  it('returns to the earlier scroll position of the page', async () => {
    const { container } = await renderApp();
    // The page scrolls inside the window; a test container has no height of its own.
    container.style.blockSize = '600px';
    const main = screen.getByRole('main');
    const filler = document.createElement('div');
    filler.style.blockSize = '5000px';
    main.append(filler);
    act(() => navigate(pageAt('p-mitosis')));
    main.scrollTop = 900;
    fireEvent.scroll(main);
    act(() => navigate(pageAt('p-meiosis')));
    await expect.poll(() => main.scrollTop).toBe(0);
    await pressChord('Alt+Left');
    await expect.poll(() => main.scrollTop).toBe(900);
    filler.remove();
  });

  it('reveals the open page in the tree, showing a collapsed pane first', async () => {
    await renderApp({ sizeClass: 'wide' });
    act(() => navigate(pageAt('p-meiosis')));
    await pressChord('Ctrl+Shift+2');
    await screen.findByRole('button', { name: 'Show pages' });
    await executeCommand('nav.revealInTree', undefined, 'palette');
    await expectFocus(await screen.findByRole('button', { name: 'Meiosis' }));
    expect(sessionStore.get().expanded).toContain('n-biology');
  });
});
