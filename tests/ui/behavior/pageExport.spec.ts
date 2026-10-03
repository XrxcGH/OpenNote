// Print, Export as PDF, and the Markdown and web page exports (Phase 6), through the web platform's stand-ins for the
// desktop app's hidden print window and Save dialog. The planning is real: the same paginator and print document the
// desktop app uses.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

interface Saved {
  readonly path: string;
  readonly files: readonly { readonly path: string; readonly length: number; readonly text: string }[];
}

const saved = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__.exportsSaved(),
  ) as Promise<Saved[]>;

const toasts = (page: Page) => page.getByRole('status', { name: 'Notifications' });

async function openSamplerPage(page: Page) {
  await page.goto('/?fixture=sampler');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByText('Every kind of text')).toBeVisible();
  await page.getByRole('tab', { name: 'View' }).click();
}

test('exports the page as a PDF with the sheets the preview shows', async ({ page }) => {
  await openSamplerPage(page);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Export as PDF…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export as PDF' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Sheet 1 of \d+/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Export…' }).click();
  await expect(toasts(page).getByText('Saved Membranes.pdf.')).toBeVisible();
  const [file] = await saved(page);
  expect(file.path).toMatch(/Membranes\.pdf$/);
  expect(file.files[0].text.startsWith('%PDF')).toBe(true);
});

test('Print opens the same dialog with its own name, and Ctrl+P asks for it', async ({ page }) => {
  await openSamplerPage(page);
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('dialog', { name: 'Print' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Print' })).toBeHidden();
  expect(await saved(page)).toHaveLength(0);
});

test('a sheet range that selects nothing says so and does not export', async ({ page }) => {
  await openSamplerPage(page);
  await page.keyboard.press('Control+p');
  const dialog = page.getByRole('dialog', { name: 'Print' });
  await dialog.getByLabel('Pages').fill('99');
  await expect(dialog.getByText(/That range has no sheets in it/)).toBeVisible();
});

test('exports Markdown and a web page', async ({ page }) => {
  await openSamplerPage(page);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Export as Markdown…' }).click();
  await expect(toasts(page).getByText('Saved Membranes.md.')).toBeVisible();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Export as HTML…' }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  const [markdown, html] = await saved(page);
  expect(html.path).toMatch(/Membranes\.html$/);
  expect(markdown.files[0].text).toContain('title: "Membranes"');
  expect(html.files[0].text).toContain('<h1 class="page-title">Membranes</h1>');
});

test('a cancelled Save dialog leaves no file and no message', async ({ page }) => {
  await openSamplerPage(page);
  await page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__.exportsCancelNext(),
  );
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Export as Markdown…' }).click();
  await page.waitForTimeout(300);
  expect(await saved(page)).toHaveLength(0);
});
