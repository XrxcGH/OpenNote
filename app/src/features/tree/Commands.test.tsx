// The tree's commands in the browser: creating and renaming, moving with the keyboard, and Move to, delete with
// Undo, context menus for every kind, and where focus lands after each. Keys are real key presses.

import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocation } from '../../app/location';
import { announcements, expectFocus, pressChord, renderApp } from '../../test';
import type { NodeId } from '../../services/notes';

const notebooksTree = () => screen.getByRole('tree', { name: 'Notebooks' });
const pagesTree = () => screen.getByRole('tree', { name: 'Pages' });
const row = (tree: HTMLElement, name: string) => within(tree).getByRole('treeitem', { name });
const findRow = (tree: () => HTMLElement, name: string) =>
  expect.poll(() => within(tree()).queryByRole('treeitem', { name })).toBeTruthy();
const names = (tree: HTMLElement) =>
  within(tree)
    .getAllByRole('treeitem')
    .map((item) => item.getAttribute('aria-labelledby'))
    .map((id) => document.getElementById(id ?? '')?.textContent);

async function renderTree() {
  const app = await renderApp();
  await findRow(notebooksTree, 'Biology 101');
  return app;
}

async function focusRow(tree: () => HTMLElement, name: string) {
  await findRow(tree, name);
  row(tree(), name).focus();
  await expectFocus(row(tree(), name));
}

async function openLectures() {
  await focusRow(notebooksTree, 'Lectures');
  await pressChord('Space');
  await findRow(pagesTree, 'Mitosis');
}

/** The labels of the open menu's items, without their shortcuts. */
const menuLabels = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((item) => item.querySelector('span')?.textContent);

async function openMenuOn(tree: () => HTMLElement, name: string) {
  await focusRow(tree, name);
  await pressChord('Shift+F10');
  await expect.poll(() => screen.queryByRole('menu')).toBeTruthy();
}

/** Menus and dialogs mount outside the app's root, so each test closes what it left open. */
afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="menu"], [role="dialog"]'); i += 1) {
    await pressChord('Escape');
  }
});

describe('creating', () => {
  it('adds a page after the current one, in rename mode, and names it with Enter', async () => {
    await renderTree();
    await openLectures();
    await focusRow(pagesTree, 'Mitosis');
    await pressChord('Ctrl+N');
    const field = await screen.findByRole('textbox', { name: 'Rename Untitled page' });
    await expectFocus(field);
    expect((field as HTMLInputElement).value).toBe('Untitled page');
    await userEvent.keyboard('Osmosis{Enter}');
    await findRow(pagesTree, 'Osmosis');
    await expectFocus(row(pagesTree(), 'Osmosis'));
    expect(names(pagesTree()).slice(0, 4)).toEqual(['Cell structure', 'Membranes', 'Mitosis', 'Osmosis']);
  });

  it('keeps the default name when Escape closes the field of a new section', async () => {
    const { notes } = await renderTree();
    await focusRow(notebooksTree, 'Labs');
    await pressChord('Ctrl+T');
    await screen.findByRole('textbox', { name: 'Rename Untitled section' });
    await pressChord('Escape');
    await findRow(notebooksTree, 'Untitled section');
    await expectFocus(row(notebooksTree(), 'Untitled section'));
    const sections = await notes.listChildren('n-biology' as NodeId);
    expect(sections.map((section) => section.title)).toEqual(['Lectures', 'Labs', 'Untitled section', 'Exam prep']);
  });

  it('adds a subpage one level down with Ctrl+Alt+Shift+N', async () => {
    await renderTree();
    await openLectures();
    await focusRow(pagesTree, 'Mitosis');
    fireEvent.keyDown(row(pagesTree(), 'Mitosis'), {
      key: 'N',
      code: 'KeyN',
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    const field = await screen.findByRole('textbox', { name: 'Rename Untitled page' });
    await userEvent.keyboard('Spindle{Enter}');
    await expect.poll(() => field.isConnected).toBe(false);
    expect(row(pagesTree(), 'Spindle').getAttribute('aria-level')).toBe('2');
  });

  it('runs the page created hooks after a new page', async () => {
    const { pageCreated } = await import('../../registries');
    const seen: string[] = [];
    const unregister = pageCreated.register({
      id: 'test.hook',
      order: 1,
      run: async (pageId) => void seen.push(pageId),
    });
    await renderTree();
    await focusRow(notebooksTree, 'Labs');
    await pressChord('Ctrl+N');
    await screen.findByRole('textbox', { name: 'Rename Untitled page' });
    await expect.poll(() => seen.length).toBe(1);
    unregister();
  });
});

describe('moving', () => {
  it('moves a row with Ctrl+Shift+Down, says where it went, and keeps focus on it', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Labs');
    await pressChord('Ctrl+Shift+Down');
    await expect.poll(() => announcements()).toContain('Moved Labs down, 3 of 3.');
    expect(names(notebooksTree()).slice(0, 4)).toEqual(['Biology 101', 'Lectures', 'Exam prep', 'Labs']);
    await expectFocus(row(notebooksTree(), 'Labs'));
    await pressChord('Ctrl+Shift+Down');
    await expect.poll(() => announcements()).toContain('Labs is already last.');
    await pressChord('Ctrl+Shift+Up');
    await expect.poll(() => announcements()).toContain('Moved Labs up, 2 of 3.');
  });

  it('makes a page a subpage with Ctrl+Shift+Right, and promotes it with Ctrl+Shift+Left', async () => {
    await renderTree();
    await openLectures();
    await focusRow(pagesTree, 'Mitosis');
    await pressChord('Ctrl+Shift+Right');
    await expect.poll(() => row(pagesTree(), 'Mitosis').getAttribute('aria-level')).toBe('2');
    expect(announcements()).toContain('Made Mitosis a subpage.');
    await expectFocus(row(pagesTree(), 'Mitosis'));
    await pressChord('Ctrl+Shift+Left');
    await expect.poll(() => row(pagesTree(), 'Mitosis').getAttribute('aria-level')).toBe('1');
    await pressChord('Ctrl+Shift+Left');
    await expect.poll(() => announcements()).toContain('Mitosis is already a page, not a subpage.');
  });

  it('moves a page to another section with Move to, and focuses the row that took its place', async () => {
    const { notes } = await renderTree();
    await openLectures();
    await focusRow(pagesTree, 'Mitosis');
    await pressChord('Ctrl+Shift+M');
    const dialog = await screen.findByRole('dialog', { name: 'Move "Mitosis" to' });
    const filter = within(dialog).getByRole('combobox', { name: 'Find a destination' });
    await expectFocus(filter);
    await userEvent.keyboard('labs');
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull();
    await expect.poll(() => within(pagesTree()).queryByRole('treeitem', { name: 'Mitosis' })).toBeNull();
    await expectFocus(row(pagesTree(), 'Meiosis'));
    expect((await notes.get('p-mitosis' as NodeId))?.parentId).toBe('s-labs');
    expect(screen.getByRole('status', { name: 'Notifications' }).textContent).toContain('Moved "Mitosis" to Labs.');
  });

  it('leaves the row where it was when Move to is cancelled', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Labs');
    await pressChord('Ctrl+Shift+M');
    await screen.findByRole('dialog', { name: 'Move "Labs" to' });
    await pressChord('Escape');
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull();
    await expectFocus(row(notebooksTree(), 'Labs'));
  });
});

describe('delete and Undo', () => {
  it('moves a page to Trash, focuses its neighbor, and undoes from the toast and from Ctrl+Z', async () => {
    await renderTree();
    await openLectures();
    await focusRow(pagesTree, 'Mitosis');
    await pressChord('Delete');
    await expectFocus(row(pagesTree(), 'Meiosis'));
    const toast = screen.getByRole('status', { name: 'Notifications' });
    await expect.poll(() => toast.textContent).toContain('Moved "Mitosis" to Trash.');
    expect(announcements()).toContain('Moved "Mitosis" to Trash. Press Ctrl+Z to undo.');
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await findRow(pagesTree, 'Mitosis');
    await expectFocus(row(pagesTree(), 'Mitosis'));
    // With the toast gone, Ctrl+Z still works through the stack.
    await pressChord('Delete');
    await userEvent.click(within(toast).getByRole('button', { name: 'Close' }));
    await expect.poll(() => within(pagesTree()).queryByRole('treeitem', { name: 'Mitosis' })).toBeNull();
    await pressChord('Ctrl+Z');
    await findRow(pagesTree, 'Mitosis');
    expect(announcements()).toContain('Restored "Mitosis".');
    await pressChord('Ctrl+Y');
    await expect.poll(() => within(pagesTree()).queryByRole('treeitem', { name: 'Mitosis' })).toBeNull();
  });

  it('closes the open page when it is deleted, and opens its neighbor', async () => {
    await renderTree();
    await openLectures();
    await focusRow(pagesTree, 'Mitosis');
    await pressChord('Space');
    await expect.poll(() => getLocation()).toMatchObject({ pageId: 'p-mitosis' });
    await pressChord('Delete');
    await expect.poll(() => getLocation()).toMatchObject({ pageId: 'p-meiosis' });
  });

  it('asks before deleting a notebook, with focus on Cancel', async () => {
    await renderTree();
    await focusRow(notebooksTree, 'Travel');
    await pressChord('Delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete the notebook "Travel"?' });
    await expectFocus(within(dialog).getByRole('button', { name: 'Cancel' }));
    await pressChord('Escape');
    await expectFocus(row(notebooksTree(), 'Travel'));
    await pressChord('Delete');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete notebook' }));
    await expect.poll(() => within(notebooksTree()).queryByRole('treeitem', { name: 'Travel' })).toBeNull();
    await expectFocus(row(notebooksTree(), 'Recipes'));
  });
});

describe('context menu contents', () => {
  it('lists each kind in the design order, with Delete last', async () => {
    await renderTree();
    await openMenuOn(notebooksTree, 'Biology 101');
    expect(menuLabels()).toEqual([
      'New section',
      'New section group',
      'Rename',
      'Color',
      'Move up',
      'Move down',
      'Delete',
    ]);
    await pressChord('Escape');
    await openMenuOn(notebooksTree, 'Exam prep');
    expect(menuLabels()).toEqual([
      'New section',
      'New section group',
      'Rename',
      'Color',
      'Move up',
      'Move down',
      'Move to',
      'Delete',
    ]);
    await pressChord('Escape');
    await openMenuOn(notebooksTree, 'Labs');
    expect(menuLabels()).toEqual(['New page', 'Rename', 'Color', 'Move up', 'Move down', 'Move to', 'Delete']);
    await pressChord('Escape');
    await openLectures();
    await openMenuOn(pagesTree, 'Mitosis');
    expect(menuLabels()).toEqual([
      'New page',
      'New subpage',
      'Make subpage',
      'Rename',
      'Move up',
      'Move down',
      'Move to',
      'Delete',
    ]);
  });

  it('disables Move up on the first row, and Delete is in the danger style', async () => {
    await renderTree();
    await openMenuOn(notebooksTree, 'Lectures');
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getByRole('menuitem', { name: /^Move up/ })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      within(menu)
        .getByRole('menuitem', { name: /^Move down/ })
        .getAttribute('aria-disabled'),
    ).toBeNull();
    const items = within(menu).getAllByRole('menuitem');
    expect(items[items.length - 1].textContent).toContain('Delete');
  });
});

describe('context menu actions', () => {
  it('opens from the More actions button with one click, for every kind', async () => {
    await renderTree();
    await userEvent.click(
      within(row(notebooksTree(), 'Biology 101')).getByRole('button', { name: 'More actions for Biology 101' }),
    );
    await expect.poll(() => screen.queryByRole('menu', { name: 'Actions for Biology 101' })).toBeTruthy();
    await pressChord('Escape');
    await openLectures();
    await userEvent.click(
      within(row(pagesTree(), 'Mitosis')).getByRole('button', { name: 'More actions for Mitosis' }),
    );
    await expect.poll(() => menuLabels()).toContain('Move to');
  });

  it('renames from the menu with focus staying in the field', async () => {
    await renderTree();
    await openMenuOn(notebooksTree, 'Labs');
    await userEvent.click(screen.getByRole('menuitem', { name: /^Rename/ }));
    const field = await screen.findByRole('textbox', { name: 'Rename Labs' });
    await expectFocus(field);
    await userEvent.keyboard('Practicals{Enter}');
    await findRow(notebooksTree, 'Practicals');
    await expectFocus(row(notebooksTree(), 'Practicals'));
  });

  it('colors from the Color submenu, with the current color checked', async () => {
    await renderTree();
    await openMenuOn(notebooksTree, 'Labs');
    await userEvent.click(screen.getByRole('menuitem', { name: /^Color/ }));
    const submenu = await screen.findByRole('menu', { name: 'Color' });
    expect(within(submenu).getByRole('menuitemradio', { name: 'Amber' }).getAttribute('aria-checked')).toBe('true');
    expect(within(submenu).getAllByRole('menuitemradio')).toHaveLength(8);
    await userEvent.click(within(submenu).getByRole('menuitemradio', { name: 'Fern' }));
    await expect
      .poll(
        () => document.getElementById(row(notebooksTree(), 'Labs').getAttribute('aria-describedby') ?? '')?.textContent,
      )
      .toBe('Section, color Fern');
    await expectFocus(row(notebooksTree(), 'Labs'));
  });
});
