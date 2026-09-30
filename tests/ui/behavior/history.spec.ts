// Back and forward (FEATURES.md, Phase 2, "Back and forward"): Alt+Left and Alt+Right move through the pages
// opened, and the window title follows the location.

import { expect, test } from '../fixtures';

test('steps back and forward through pages, and the title follows', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('treeitem', { name: 'Mitosis' }).click();
  await expect(page).toHaveTitle('Mitosis - OpenNote');
  await page.getByRole('treeitem', { name: 'Meiosis' }).click();
  await expect(page).toHaveTitle('Meiosis - OpenNote');

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
  await expect(page).toHaveTitle('Mitosis - OpenNote');

  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByRole('heading', { level: 1, name: 'Meiosis' })).toBeVisible();
  await expect(page).toHaveTitle('Meiosis - OpenNote');
});

test('the toolbar arrows step through history and say when there is nowhere to go', async ({ page }) => {
  await page.goto('/');
  const back = page.getByRole('button', { name: 'Go back' });
  const forward = page.getByRole('button', { name: 'Go forward' });
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('treeitem', { name: 'Mitosis' }).click();
  await back.click();
  await expect(forward).not.toHaveAttribute('aria-disabled', 'true');
  await forward.click();
  await expect(page).toHaveTitle('Mitosis - OpenNote');
});
