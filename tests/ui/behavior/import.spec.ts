// Import notes in the production build, on the web platform's fake host. The command opens a dialog.
// The dry run shows what comes over and what does not. The import runs with progress and Cancel.
// The new notebook then appears in the tree with its pages. Nothing is added before the person presses Import.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

type Hooks = Record<string, (...args: unknown[]) => unknown>;

async function openImport(page: Page, prepare?: () => Promise<unknown>) {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await prepare?.();
  await page.keyboard.press('Control+KeyK');
  await page
    .getByRole('combobox', { name: 'Search commands and pages' })
    .pressSequentially('import notes', { delay: 10 });
  await page.getByRole('option', { name: /Import notes/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Import notes' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('imports an Evernote file after showing what will change', async ({ page }) => {
  const dialog = await openImport(page);
  await dialog.getByRole('button', { name: 'Choose a file…' }).click();
  await expect(
    dialog.getByRole('heading', { name: /5 pages will come into a new notebook called "Recipes"/ }),
  ).toBeFocused();
  await expect(dialog.getByText('Reminders have no place in OpenNote yet.')).toBeVisible();
  await expect(dialog.getByText('Not imported')).toBeVisible();
  // The review adds nothing yet.
  await expect(page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Recipes' })).toHaveCount(1);

  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await expect(dialog.getByText(/5 pages were added to the notebook "Recipes"/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Open notebook' }).click();
  await expect(dialog).toHaveCount(0);

  const notebooks = page.getByRole('tree', { name: 'Notebooks' });
  await expect(notebooks.getByRole('treeitem', { name: 'Recipes' })).toHaveCount(2);
  const pages = page.getByRole('tree', { name: 'Pages' });
  await expect(pages.getByRole('treeitem', { name: 'Sourdough' })).toBeVisible();
  await expect(pages.getByRole('treeitem', { name: 'Lentil soup' })).toBeVisible();
});

test('sits on the Home tab after the New buttons, and in Export on the tree menus last before Delete', async ({
  page,
}) => {
  await page.goto('/');
  const home = page.getByRole('toolbar', { name: 'Home' });
  await expect(home.getByRole('button', { name: 'Import notes…' })).toBeVisible();
  const names = await home.getByRole('button').allInnerTexts();
  expect(names.indexOf('Import notes…')).toBeGreaterThan(names.indexOf('New notebook'));
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Biology 101' }).click({
    button: 'right',
  });
  const items = await page.getByRole('menu').getByRole('menuitem').allInnerTexts();
  expect(items.at(-2)).toContain('Export…');
  expect(items.at(-1)).toContain('Delete');
});

test('Cancel during the check adds nothing and says so', async ({ page }) => {
  const dialog = await openImport(page);
  await page.evaluate(() => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopStepMs(300));
  await dialog.getByRole('button', { name: 'Choose a file…' }).click();
  await expect(dialog.getByRole('progressbar', { name: 'Checking your notes' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByText('Import canceled. Nothing was added.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose a file…' })).toBeVisible();
});

test('a OneNote file says what to export instead', async ({ page }) => {
  const dialog = await openImport(page);
  await page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopPickNext('C:\\Notes\\Work.one'),
  );
  await dialog.getByRole('button', { name: 'Choose a file…' }).click();
  await expect(dialog.getByRole('heading', { name: "OpenNote can't import this yet" })).toBeVisible();
  await expect(dialog.getByText(/choose File, then Export/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
});

test('offers the Sticky Notes of this PC only when the app is there', async ({ page }) => {
  const dialog = await openImport(page, () =>
    page.evaluate(() =>
      (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopSticky(
        'C:/Users/Sample/plum.sqlite',
      ),
    ),
  );
  await dialog.getByRole('button', { name: 'Import Sticky Notes from this PC' }).click();
  await expect(dialog.getByRole('heading', { name: /will come into a new notebook called "plum"/ })).toBeFocused();
});

test('works with the keyboard alone', async ({ page }) => {
  const dialog = await openImport(page);
  // The dialog opens with focus on its first button.
  await expect(dialog.getByRole('button', { name: 'Choose a file…' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading', { name: /will come into a new notebook/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
