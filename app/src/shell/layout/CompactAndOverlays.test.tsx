// The medium drawer, the expanded pages overlay, the compact stack, and focus through size class changes
// (ARCHITECTURE.md sections 11.4 and 11.6).

import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getLocation, navigate } from '../../app/location';
import type { NodeId } from '../../services/notes/types';
import { layoutStore, setSizeClass } from '../../state/layout';
import { expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';

// Focus that moves to the page lands on its heading, which the page view registers as the region's main control.
const pageHeading = () => screen.getByRole('main').querySelector<HTMLElement>('h1') as HTMLElement;

const lectures: Parameters<typeof navigate>[0] = {
  view: 'workspace',
  notebookId: 'n-biology' as NodeId,
  sectionId: 's-lectures' as NodeId,
  pageId: null,
};

describe('the medium notebooks drawer', () => {
  it('opens from the rail as a dialog, and Escape returns focus to the rail', async () => {
    const { container } = await renderApp({ sizeClass: 'medium' });
    const show = screen.getByRole('button', { name: 'Show notebooks' });
    expect(show.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('treeitem', { name: 'Lectures' })).toBeNull();
    show.focus();
    fireEvent.click(show);
    const dialog = await screen.findByRole('dialog', { name: 'Notebooks' });
    const row = await within(dialog).findByRole('treeitem', { name: 'Lectures' });
    await expectFocus(within(dialog).getAllByRole('treeitem')[0]);
    expect(row).toBeTruthy();
    await expectNoAxeViolations(container.ownerDocument.body);
    await pressChord('Escape');
    await expect.poll(() => screen.queryByRole('dialog', { name: 'Notebooks' })).toBeNull();
    await expectFocus(show);
  });

  it('closes when a section is chosen and moves focus to the pages pane', async () => {
    await renderApp({ sizeClass: 'medium' });
    fireEvent.click(screen.getByRole('button', { name: 'Show notebooks' }));
    const row = await screen.findByRole('treeitem', { name: 'Lectures' });
    row.focus();
    fireEvent.click(row);
    await expect.poll(() => screen.queryByRole('dialog', { name: 'Notebooks' })).toBeNull();
    await expectFocus(await screen.findByRole('treeitem', { name: 'Cell structure' }));
  });

  it('hides and shows the medium pages pane with Ctrl+Shift+2, and focus moves to the page', async () => {
    await renderApp({ sizeClass: 'medium' });
    act(() => navigate(lectures));
    const page = await screen.findByRole('treeitem', { name: 'Cell structure' });
    page.focus();
    await pressChord('Ctrl+Shift+2');
    await expect.poll(() => layoutStore.get().mediumPagesCollapsed).toBe(true);
    await expectFocus(pageHeading());
    await pressChord('Ctrl+Shift+2');
    await expectFocus(await screen.findByRole('treeitem', { name: 'Cell structure' }));
  });
});

describe('the expanded pages overlay', () => {
  it('opens when a section is chosen, with focus on its pages, and closes into the page when one is chosen', async () => {
    await renderApp({ sizeClass: 'expanded' });
    const row = await screen.findByRole('treeitem', { name: 'Lectures' });
    row.focus();
    fireEvent.click(row);
    const first = await screen.findByRole('treeitem', { name: 'Cell structure' });
    await expectFocus(first);
    expect(screen.getByRole('button', { name: 'Show pages' }).getAttribute('aria-expanded')).toBe('true');
    first.focus();
    fireEvent.click(screen.getByRole('treeitem', { name: 'Mitosis' }));
    await expect.poll(() => layoutStore.get().overlayOpen).toBe(false);
    await expectFocus(pageHeading());
  });

  it('closes on Escape and returns focus to the section row', async () => {
    await renderApp({ sizeClass: 'expanded' });
    const row = await screen.findByRole('treeitem', { name: 'Lectures' });
    row.focus();
    fireEvent.click(row);
    await expectFocus(await screen.findByRole('treeitem', { name: 'Cell structure' }));
    await pressChord('Escape');
    await expect.poll(() => layoutStore.get().overlayOpen).toBe(false);
    await expectFocus(row);
  });

  it('closes whenever focus moves outside it, so it never covers the focused element', async () => {
    await renderApp({ sizeClass: 'expanded' });
    act(() => navigate(lectures));
    await pressChord('Ctrl+Shift+2');
    await expectFocus(await screen.findByRole('treeitem', { name: 'Cell structure' }));
    screen.getByRole('treeitem', { name: 'Labs' }).focus();
    await expect.poll(() => layoutStore.get().overlayOpen).toBe(false);
    await expectFocus(screen.getByRole('treeitem', { name: 'Labs' }));
  });
});

describe('the compact stack', () => {
  it('shows one screen at a time, going down by choosing and up with Back and Alt+Left', async () => {
    const { container } = await renderApp({ sizeClass: 'compact' });
    // The screen that shows is the main landmark, and the app bar's title is its heading, so each screen stands alone.
    const main = screen.getByRole('main');
    expect(within(main).getByRole('navigation', { name: 'Notebooks' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Notebooks' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
    await expectNoAxeViolations(container);

    const lecturesRow = await screen.findByRole('treeitem', { name: 'Lectures' });
    lecturesRow.focus();
    fireEvent.click(lecturesRow);
    await expect.poll(() => layoutStore.get().compactScreen).toBe('pages');
    const mitosis = await screen.findByRole('treeitem', { name: 'Mitosis' });
    await expectFocus(screen.getByRole('treeitem', { name: 'Cell structure' }));
    expect(await screen.findByRole('button', { name: 'Back to Biology 101' })).toBeTruthy();

    mitosis.focus();
    fireEvent.click(mitosis);
    await expect.poll(() => layoutStore.get().compactScreen).toBe('page');
    await expectFocus(pageHeading());
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Lectures' }));
    await expect.poll(() => layoutStore.get().compactScreen).toBe('pages');

    await pressChord('Alt+Left');
    await expect.poll(() => layoutStore.get().compactScreen).toBe('notebooks');
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
    // At the top, Alt+Left goes back through history.
    await pressChord('Alt+Left');
    await expect.poll(() => getLocation()).toMatchObject({ sectionId: 's-lectures', pageId: 'p-cell-structure' });
  });

  it('starts on the screen that fits the location', async () => {
    await renderApp({
      sizeClass: 'compact',
      boot: { state: { location: { ...lectures, pageId: 'p-mitosis' } } },
    });
    await expect.poll(() => layoutStore.get().compactScreen).toBe('page');
    expect(await screen.findByRole('button', { name: 'Back to Lectures' })).toBeTruthy();
  });
});

describe('focus through size class changes', () => {
  it('moves focus to the region that now shows the item, never to the body', async () => {
    await renderApp({ sizeClass: 'wide' });
    act(() => navigate(lectures));
    const row = await screen.findByRole('treeitem', { name: 'Lectures' });
    row.focus();
    act(() => setSizeClass('medium'));
    await expect.poll(() => document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('[data-region]')?.getAttribute('data-region')).toBe('pages');
  });

  it('keeps focus where it was when the item still shows', async () => {
    await renderApp({ sizeClass: 'wide' });
    act(() => navigate(lectures));
    const page = await screen.findByRole('treeitem', { name: 'Mitosis' });
    page.focus();
    act(() => setSizeClass('medium'));
    await expectFocus(page);
  });
});
