// First-run setup in the production build (ARCHITECTURE.md section 17). It checks the steps, the focus, and the
// names. It checks the theme that is stored before any page opens. It also checks the footer in compact.

import { expect, test } from '../fixtures';

test.use({ boot: { firstRun: true, state: { setup: { status: 'notStarted' } }, os: { dark: true } } });

test('walks through the first steps with Match Windows preselected', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to OpenNote' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get started' })).toBeFocused();
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Choose your look' })).toBeVisible();
  const windows = page.getByRole('radio', { name: 'Match Windows' });
  await expect(windows).toBeChecked();
  await expect(windows).toBeFocused();
  await expect(windows).toContainText('Preselected because Windows is set to Dark.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // A click applies at once and is stored before any page opens.
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Where to keep things' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start taking notes' })).toBeVisible();
});

test('keeps Back and Continue in view at the compact size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Choose your look' })).toBeVisible();
  const box = await page.getByRole('button', { name: 'Continue' }).boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(640);
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
  // The card scrolls inside itself, so the page never does, in either direction.
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow.x).toBeLessThanOrEqual(0);
  expect(overflow.y).toBeLessThanOrEqual(0);
});
