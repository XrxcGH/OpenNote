// The navigation tree's screen states (ARCHITECTURE.md section 21.4): a selected page, the context menu, rename with
// an error, a drag over a target, Move to, a toast with Undo, Trash, and the 1,000-page section. WP6 owns this file.
// They stay at the wide size until WP5's compact layout shows where the trees are there.

import type { Page } from '@playwright/test';
import { defineScreens } from '../screens';

const tree = (page: Page, name: string) => page.getByRole('tree', { name });

async function openLectures(page: Page) {
  await tree(page, 'Notebooks').getByRole('treeitem', { name: 'Lectures' }).click();
  await tree(page, 'Pages').getByRole('treeitem', { name: 'Mitosis' }).click();
}

export default defineScreens([
  {
    id: 'tree.contextMenu',
    description: 'The context menu open on a section',
    sizes: ['wide'],
    prepare: async (page) => {
      await openLectures(page);
      const row = tree(page, 'Notebooks').getByRole('treeitem', { name: 'Labs' });
      await row.focus();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menu').waitFor();
    },
  },
  {
    id: 'tree.renameError',
    description: 'A rename with an empty name, with the message under the field',
    sizes: ['wide'],
    prepare: async (page) => {
      await openLectures(page);
      await tree(page, 'Notebooks').getByRole('treeitem', { name: 'Labs' }).focus();
      await page.keyboard.press('F2');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Enter');
      await page.locator('input[aria-invalid="true"]').waitFor();
    },
  },
  {
    id: 'tree.drag',
    description: 'A page dragged over a section, with the drop highlighted and its label',
    sizes: ['wide'],
    prepare: async (page) => {
      await openLectures(page);
      const source = await tree(page, 'Pages').getByRole('treeitem', { name: 'Mitosis' }).boundingBox();
      const target = await tree(page, 'Notebooks').getByRole('treeitem', { name: 'Labs' }).boundingBox();
      if (!source || !target) throw new Error('The rows have no place on screen.');
      await page.mouse.move(source.x + 40, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + 60, source.y + source.height / 2 + 20, { steps: 4 });
      await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 6 });
      await page.locator('[data-drop="into"]').waitFor();
    },
  },
  {
    id: 'tree.moveTo',
    description: 'The Move to dialog with a filter and the destinations',
    sizes: ['wide'],
    prepare: async (page) => {
      await openLectures(page);
      await tree(page, 'Pages').getByRole('treeitem', { name: 'Mitosis' }).focus();
      await page.keyboard.press('Control+Shift+KeyM');
      await page.getByRole('dialog', { name: 'Move "Mitosis" to' }).waitFor();
    },
  },
  {
    id: 'tree.undoToast',
    description: 'The toast with Undo after deleting a page',
    sizes: ['wide'],
    prepare: async (page) => {
      await openLectures(page);
      await tree(page, 'Pages').getByRole('treeitem', { name: 'Mitosis' }).focus();
      await page.keyboard.press('Delete');
      await page.getByRole('status', { name: 'Notifications' }).getByRole('button', { name: 'Undo' }).waitFor();
    },
  },
  {
    id: 'tree.trash',
    description: 'The Trash view with one deleted page',
    sizes: ['wide'],
    prepare: async (page) => {
      await openLectures(page);
      await tree(page, 'Pages').getByRole('treeitem', { name: 'Mitosis' }).focus();
      await page.keyboard.press('Delete');
      await page.getByRole('button', { name: 'Trash' }).click();
      await page.getByRole('button', { name: 'Restore Mitosis' }).waitFor();
    },
  },
  {
    id: 'tree.large',
    description: 'A section with 1,000 pages, windowed',
    fixture: 'large',
    sizes: ['wide'],
    boot: {
      state: { location: { view: 'workspace', notebookId: 'lg-n-1', sectionId: 'lg-s-1-1', pageId: 'lg-p-0001' } },
    },
    prepare: async (page) => {
      await tree(page, 'Pages').getByRole('treeitem').first().waitFor();
    },
  },
]);
