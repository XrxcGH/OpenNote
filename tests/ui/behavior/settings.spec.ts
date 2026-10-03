// Settings and the shortcut list in the production build. Ctrl+, opens Settings on the section heading, and a
// section link moves focus to its heading. Escape leaves. The section list stays in view while a long section
// scrolls. Ctrl+/ lists every shortcut in tables.

import { expect, test } from '../fixtures';

test('Ctrl+, opens Settings on its heading, and Escape leaves it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeFocused();
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'About' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toHaveCount(0);
});

test('the section list stays in view while a long section scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 620 });
  await page.goto('/');
  await expect(page.locator('[data-workspace]')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('link', { name: 'Shortcuts' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Shortcuts' })).toBeFocused();
  await page.getByRole('main').evaluate((main) => (main.scrollTop = main.scrollHeight));
  await expect(page.getByRole('heading', { level: 1, name: 'Shortcuts' })).not.toBeInViewport();
  await expect(nav.getByRole('link', { name: 'About' })).toBeInViewport();
});

test('Ctrl+/ lists the shortcuts in tables, and Escape closes the list', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+Slash');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('row', { name: /Open command palette/ })).toContainText('Ctrl+K');
  await expect(dialog.getByRole('heading', { name: 'Keys that always work' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
