// A smoke test of the production build: the workspace opens on the sample notebooks, a page opens, and the
// dark mode switch and Ctrl+Shift+D both switch the theme.

import { expect, test } from '../fixtures';

test('opens the workspace and switches the theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.getByRole('button', { name: 'Lectures' }).click();
  await page.getByRole('button', { name: 'Mitosis' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();

  const toggle = page.getByRole('switch', { name: 'Dark mode' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
