// The responsive workspace (ARCHITECTURE.md section 11): landmarks, pane commands, rails, and splitters in the wide
// and expanded classes. Drawer, overlay, and compact behavior are in CompactAndOverlays.test.tsx.

import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../../commands/registry';
import { layoutStore } from '../../state/layout';
import { AUTO_PANE_WIDTH, sessionStore } from '../../state/session';
import { announcements, expectFocus, expectNoAxeViolations, pressChord, renderApp } from '../../test';
import { defaultPaneWidth } from './solvePanes';

const notebooksNav = () => screen.getByRole('navigation', { name: 'Notebooks' });
const separator = (pane: 'notebooks' | 'pages') => screen.getByRole('separator', { name: `Resize the ${pane} pane` });
const width = (pane: 'notebooks' | 'pages') => Number(separator(pane).getAttribute('aria-valuenow'));
const storedWidth = (pane: 'notebooks' | 'pages') => sessionStore.get().panes[pane].width;
/** The width a pane nobody has resized gets in this window. */
const auto = (pane: 'notebooks' | 'pages') => defaultPaneWidth(pane, layoutStore.get().width);

/**
 * Puts focus on a splitter once the app has settled. While the tree is still drawing, start-up places focus on a
 * row, so a splitter focused too early can lose it, and the key presses after it then go to the row instead.
 */
async function focusSplitter(pane: 'notebooks' | 'pages') {
  await screen.findByRole('treeitem', { name: 'Lectures' });
  separator(pane).focus();
  await expectFocus(separator(pane));
}

describe('the wide workspace', () => {
  it('shows the notebooks and pages panes and the page as landmarks, and passes axe in both themes', async () => {
    const { container } = await renderApp({ sizeClass: 'wide' });
    expect(notebooksNav()).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(width('notebooks')).toBe(auto('notebooks'));
    expect(width('pages')).toBe(auto('pages'));
    expect(separator('notebooks').getAttribute('aria-valuetext')).toBe(`Notebooks pane, ${auto('notebooks')} pixels`);
    expect(separator('notebooks').getAttribute('aria-controls')).toBe(notebooksNav().id);
    await screen.findByRole('treeitem', { name: 'Lectures' });
    await expectNoAxeViolations(container);
    document.documentElement.dataset.theme = 'dark';
    await expectNoAxeViolations(container);
  });

  it('collapses and expands the panes with Ctrl+Shift+1 and Ctrl+Shift+2, and says so', async () => {
    await renderApp({ sizeClass: 'wide' });
    await pressChord('Ctrl+Shift+1');
    await expect.poll(() => screen.queryByRole('button', { name: 'Show notebooks' })).not.toBeNull();
    expect(announcements()).toContain('Notebooks pane hidden');
    expect(sessionStore.get().panes.notebooks.collapsed).toBe(true);

    await pressChord('Ctrl+Shift+2');
    await expect.poll(() => screen.queryByRole('button', { name: 'Show pages' })).not.toBeNull();

    await pressChord('Ctrl+Shift+1');
    await expect.poll(() => screen.queryByRole('button', { name: 'Show notebooks' })).toBeNull();
    expect(announcements()).toContain('Notebooks pane shown');
    expect(await screen.findByRole('treeitem', { name: 'Lectures' })).toBeTruthy();
  });

  it('moves focus to the rail when the pane that holds it collapses, and back in when it expands', async () => {
    await renderApp({ sizeClass: 'wide' });
    const row = await screen.findByRole('treeitem', { name: 'Lectures' });
    row.focus();
    await pressChord('Ctrl+Shift+1');
    const show = await screen.findByRole('button', { name: 'Show notebooks' });
    await expectFocus(show);
    fireEvent.click(show);
    await expectFocus(await screen.findByRole('treeitem', { name: 'Lectures' }));
  });
});

describe('the wide splitters', () => {
  it('resizes with the splitter keys, and Enter collapses and expands with focus kept', async () => {
    await renderApp({ sizeClass: 'wide' });
    await focusSplitter('notebooks');
    const start = auto('notebooks');
    await pressChord('Right');
    await expect.poll(() => width('notebooks')).toBe(start + 8);
    await pressChord('Shift+Right');
    await expect.poll(() => width('notebooks')).toBe(start + 48);
    await pressChord('Left');
    await expect.poll(() => width('notebooks')).toBe(start + 40);
    await pressChord('Home');
    await expect.poll(() => width('notebooks')).toBe(220);
    await pressChord('End');
    await expect.poll(() => width('notebooks')).toBe(400);
    expect(storedWidth('notebooks')).toBe(400);

    await pressChord('Enter');
    await expect.poll(() => separator('notebooks').getAttribute('aria-valuetext')).toBe('Notebooks pane hidden');
    await expectFocus(separator('notebooks'));
    await pressChord('Enter');
    await expect.poll(() => separator('notebooks').getAttribute('aria-valuetext')).toBe('Notebooks pane, 400 pixels');
  });

  it('resets a pane to its default width on double-click', async () => {
    await renderApp({ sizeClass: 'wide' });
    await focusSplitter('pages');
    await pressChord('Shift+Right');
    await expect.poll(() => width('pages')).toBe(auto('pages') + 40);
    fireEvent.doubleClick(separator('pages'));
    await expect.poll(() => width('pages')).toBe(auto('pages'));
    expect(storedWidth('pages')).toBe(AUTO_PANE_WIDTH);
  });

  it('resizes by dragging, writing the width once per frame and saving it on release', async () => {
    const { container } = await renderApp({ sizeClass: 'wide' });
    const grid = container.querySelector<HTMLElement>('[data-workspace]');
    const handle = separator('notebooks');
    const start = auto('notebooks');
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: start });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: start + 50 });
    await expect.poll(() => grid?.style.getPropertyValue('--pane-notebooks-drag')).toBe(`${start + 50}px`);
    expect(storedWidth('notebooks')).toBe(AUTO_PANE_WIDTH);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: start + 50 });
    await expect.poll(() => width('notebooks')).toBe(start + 50);
    expect(grid?.style.getPropertyValue('--pane-notebooks-drag')).toBe('');
  });

  it('collapses a pane dragged 40 pixels past its minimum', async () => {
    await renderApp({ sizeClass: 'wide' });
    const handle = separator('notebooks');
    const start = auto('notebooks');
    const past = 220 - 45; // 45 px past the 220 px minimum
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: start });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: past });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: past });
    await expect.poll(() => sessionStore.get().panes.notebooks.collapsed).toBe(true);
    expect(storedWidth('notebooks')).toBe(AUTO_PANE_WIDTH);
  });

  it('offers every resize in the splitter menu, without dragging', async () => {
    await renderApp({ sizeClass: 'wide' });
    fireEvent.contextMenu(separator('notebooks'));
    const menu = await screen.findByRole('menu', { name: 'Notebooks pane width' });
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual([
      'Widen the notebooks pane',
      'Narrow the notebooks pane',
      'Reset the notebooks pane width',
      'Collapse the notebooks pane',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Widen the notebooks pane' }));
    await expect.poll(() => width('notebooks')).toBe(auto('notebooks') + 40);
  });

  it('offers the same items for both panes in the View tab’s Pane widths menu', async () => {
    await renderApp({ sizeClass: 'wide' });
    // The command finishes when the menu closes, so it isn't awaited.
    void executeCommand('layout.paneWidths', undefined, 'commandBar');
    const menu = await screen.findByRole('menu', { name: 'Pane widths' });
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(8);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Collapse the pages pane' }));
    await expect.poll(() => sessionStore.get().panes.pages.collapsed).toBe(true);
  });
});

describe('the expanded workspace', () => {
  it('keeps the notebooks pane resizable and the pages pane behind its rail', async () => {
    await renderApp({ sizeClass: 'expanded' });
    expect(separator('notebooks')).toBeTruthy();
    expect(screen.queryByRole('separator', { name: 'Resize the pages pane' })).toBeNull();
    const show = screen.getByRole('button', { name: 'Show pages' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
  });
});
