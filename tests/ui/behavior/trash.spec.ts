// Trash in the production build: a deleted page appears in the Trash view with where it came from, and Restore
// puts it back where it was.

import { expect, test } from '../fixtures';

test('lists a deleted page in Trash and restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  const pages = page.getByRole('tree', { name: 'Pages' });
  await pages.getByRole('treeitem', { name: 'Mitosis' }).focus();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Trash' }).click();
  const item = page.getByRole('listitem').filter({ hasText: 'Mitosis' });
  await expect(item).toContainText('From Lectures');
  await item.getByRole('button', { name: 'Restore Mitosis' }).click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await expect(pages.getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();
});
