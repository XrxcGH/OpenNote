// Players and live embeds in the production build: the Insert from a link command works on a page that is still empty,
// the card shows a Play (or live view) control first, and only that control puts a sandboxed frame on the page.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openMembranes(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
}

async function insertFromLink(page: Page, link: string): Promise<void> {
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially('Insert video', { delay: 10 });
  await page.getByRole('option', { name: /Insert video, podcast, or embed from link/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert from a link' });
  await dialog.getByRole('textbox', { name: 'Link' }).fill(link);
  await dialog.getByRole('button', { name: 'Insert' }).click();
}

test.beforeEach(async ({ page }) => {
  // No site is reached from a test: a frame that is allowed to load gets an empty page.
  await page.route(/youtube-nocookie\.com|player\.vimeo\.com|desmos\.com/, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>frame</title>' }),
  );
});

test('inserts a video on an empty page, and plays it in a sandboxed frame only after Play', async ({ page }) => {
  await openMembranes(page);
  await insertFromLink(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const card = page.getByRole('group', { name: 'YouTube video', exact: true });
  await expect(card).toBeVisible();
  await expect(page.locator('iframe[src*="youtube-nocookie"]')).toHaveCount(0);
  await card.getByRole('button', { name: /^Play / }).click();
  const frame = page.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]');
  await expect(frame).toBeVisible();
  const sandbox = (await frame.getAttribute('sandbox')) ?? '';
  expect(sandbox).toContain('allow-scripts');
  expect(sandbox).not.toContain('allow-top-navigation');
});

test('inserts a live Desmos view, shown only after the person asks', async ({ page }) => {
  await openMembranes(page);
  await insertFromLink(page, 'https://www.desmos.com/calculator/abcdefghij');
  const show = page.getByRole('button', { name: /^Show the live view of / });
  await expect(show).toBeVisible();
  await expect(page.locator('iframe[src*="desmos.com"]')).toHaveCount(0);
  await show.click();
  await expect(page.locator('iframe[src*="desmos.com"]')).toBeVisible();
});

test('leaves a link from another site alone', async ({ page }) => {
  await openMembranes(page);
  await insertFromLink(page, 'https://example.com/video');
  await expect(page.getByText('That link is not one of the sites that can be shown on a page.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(0);
});
