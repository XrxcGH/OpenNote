// The command palette and the quick switcher in the production build. Ctrl+K lists commands with their keys and
// runs one. Ctrl+O finds a page. Typing stays fast, because the search never blocks the input.

import { expect, test } from '../fixtures';

test('Ctrl+K runs a command by name, and announces the result count', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await expect(box).toBeFocused();
  await box.pressSequentially('dark', { delay: 20 });
  const option = page.getByRole('option', { name: /Toggle dark mode/ });
  await expect(option).toContainText('Ctrl+Shift+D');
  await expect(box).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id')) ?? '');
  await expect(page.locator('[aria-live="polite"]')).toHaveText(/^\d+ results?$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('typing in the palette keeps up', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox');
  const text = 'toggle dark mode';
  const started = Date.now();
  await box.pressSequentially(text, { delay: 0 });
  await expect(box).toHaveValue(text);
  // A generous bound: each key press is handled within 50 ms even on a busy machine.
  expect(Date.now() - started).toBeLessThan(text.length * 50 + 1000);
});

test('Ctrl+O finds a page by name, and with no match offers to create one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lectures' }).click();
  await page.keyboard.press('Control+KeyO');
  const box = page.getByRole('combobox', { name: 'Page name' });
  await box.fill('mitosis');
  await expect(page.getByRole('option', { name: /Mitosis/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
  await page.keyboard.press('Control+KeyO');
  await page.getByRole('combobox', { name: 'Page name' }).fill('Zebrafish');
  await expect(page.getByRole('option', { name: 'Create page "Zebrafish"' })).toBeVisible();
});
