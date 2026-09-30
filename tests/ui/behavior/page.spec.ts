// The page placeholder in the production build: a prompt with no page open, then the page's title as a heading.

import { expect, test } from '../fixtures';

test('shows a prompt, then the open page as a heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'No page open' })).toBeVisible();
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await expect(page.getByText(/Writing and drawing on pages arrive in a later version/)).toBeVisible();
});
