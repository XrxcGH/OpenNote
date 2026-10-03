// Search in the production build on the web platform (Phase 8): Ctrl+Shift+F opens the panel, finds words typed into
// a page by their text, filters, previews the highlighted page, and opens it; the quick switcher finds a page by words
// in its text.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openPage(page: Page, section: string, title: string) {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: section }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function typeInPage(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await page.keyboard.type(text);
  await expect(box).toContainText(text.slice(0, 12));
  // The page sends typing to its service in batches, and the web index reads the service.
  const held = () =>
    page.evaluate(() => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
      return JSON.stringify(hooks.pagesHeld());
    });
  await expect.poll(held).toContain(text);
}

test('Ctrl+Shift+F finds words typed into a page, previews it, and opens it', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Membranes');
  await typeInPage(page, 'Osmosis moves water across a membrane');
  await page.keyboard.press('Control+Shift+KeyF');
  const box = page.getByRole('combobox', { name: 'Search notes' });
  await expect(box).toBeFocused();
  await box.fill('osmo');
  const result = page.getByRole('option', { name: /Membranes/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Osmosis moves water');
  // The matched word is bold, so a match never rests on color alone.
  await expect(result.locator('strong').first()).toHaveText('Osmosis');
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Osmosis moves water');
  await expect(page.locator('[aria-live="polite"]')).toHaveText(/^1 result$/);
  await box.fill('osmosis zebra');
  await expect(page.getByText('No pages match.')).toBeVisible();
  await box.fill('osmosis -water');
  await expect(page.getByText('No pages match.')).toBeVisible();
  await box.fill('osmosis');
  await page.getByRole('option', { name: /Membranes/ }).click();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
});

test('the panel filters by titles only and a regular expression, and says when a pattern is not valid', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Membranes');
  await typeInPage(page, 'Osmosis moves water');
  await page.keyboard.press('Control+Shift+KeyF');
  const box = page.getByRole('combobox', { name: 'Search notes' });
  await box.fill('osmosis');
  await expect(page.getByRole('option', { name: /Membranes/ })).toBeVisible();
  await page.getByRole('switch', { name: 'Titles only' }).click();
  await expect(page.getByText('No pages match.')).toBeVisible();
  await page.getByRole('switch', { name: 'Titles only' }).click();
  await page.getByRole('switch', { name: 'Regular expression' }).click();
  await box.fill('os+mosis');
  await expect(page.getByRole('option', { name: /Membranes/ })).toBeVisible();
  await box.fill('(unclosed');
  await expect(page.getByRole('alert')).toContainText('not valid');
});

test('a search can be saved on this device and used again', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Membranes');
  await typeInPage(page, 'Osmosis moves water');
  await page.keyboard.press('Control+Shift+KeyF');
  const box = page.getByRole('combobox', { name: 'Search notes' });
  await box.fill('osmosis');
  await page.getByRole('button', { name: 'Save this search' }).click();
  await page.getByRole('textbox', { name: 'Name for this search' }).fill('Water words');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await box.fill('');
  await page.getByLabel('Saved searches').selectOption('Water words');
  await expect(box).toHaveValue('osmosis');
});

test('Ctrl+O finds a page by words in its text', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Membranes');
  await typeInPage(page, 'Phospholipid bilayers form the cell boundary');
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  await page.keyboard.press('Control+KeyO');
  const box = page.getByRole('combobox', { name: 'Page name' });
  await box.fill('bilayers');
  const option = page.getByRole('option', { name: /Membranes/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('Phospholipid bilayers');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
});
