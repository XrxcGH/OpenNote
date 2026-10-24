// Managing tags in the production build on the web platform (Phase 8): add a tag to the open page, then rename it
// after the dialog says how many pages change.

import { expect, test } from '../fixtures';

test('adds a tag to a page and renames it with a preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox').fill('manage tags');
  await page.getByRole('option', { name: 'Manage tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tags' });
  await expect(dialog.getByText('No page has a tag yet.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Add a tag to the open page' }).fill('School/Biology');
  await dialog.getByRole('button', { name: 'Add tag' }).click();
  const list = dialog.getByRole('list', { name: 'Tags' });
  await expect(list.getByText('biology')).toBeVisible();
  await list.getByRole('button', { name: 'Rename the tag school', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'New name for school' }).fill('uni');
  await expect(dialog.getByRole('status')).toHaveText('Renaming school to uni changes 1 page.');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(list.getByText('uni')).toBeVisible();
  await expect(list.getByRole('button', { name: 'Rename the tag uni/biology' })).toBeVisible();
});
