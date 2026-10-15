// Words, highlights, and the dark theme on PDF pages (A1-34, A3-19, A2-23), on the web platform with a PDF made by the
// test. pdf.js gives each word its box, so these check the layers the page puts over the picture.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openMembranes, runCommand } from '../intel';
import { insertPdf } from '../pdf';

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

/** Selects the words of the first PDF page's text layer, from word `from` to word `to`. */
async function selectWords(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(
    ([a, b]) => {
      const layer = document.querySelector('[data-pdf-text]');
      const start = layer?.querySelector(`[data-index="${a}"]`);
      const end = layer?.querySelector(`[data-index="${b}"]`);
      if (!start?.firstChild || !end?.firstChild) throw new Error('The words are not there.');
      const range = document.createRange();
      range.setStart(start.firstChild, 0);
      range.setEnd(end.firstChild, (end.textContent ?? '').trimEnd().length);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    [from, to] as const,
  );
}

test('the words of a PDF page can be selected and copied', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'lecture.pdf', ['Cell walls hold water']);
  const layer = page.getByRole('group', { name: 'Text of page 1 of lecture.pdf' });
  await expect(layer).toBeAttached();
  await expect(layer.locator('[data-index]')).toHaveCount(4);
  await selectWords(page, 0, 1);
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('Cell walls');
  await runCommand(page, 'Copy the text of PDF pages');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Cell walls hold water');
});

test('selected words are highlighted, sent to the notes, and listed as Markdown', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'lecture.pdf', ['Cell walls hold water']);
  await selectWords(page, 2, 3);
  await page.keyboard.press('Control+Alt+KeyH');
  const mark = page.getByRole('button', { name: 'Highlight: hold water' });
  await expect(mark).toBeVisible();
  await mark.click();
  await page.getByRole('menuitem', { name: 'Send to notes' }).click();
  await expect(page.getByRole('link', { name: 'Page 1 of lecture.pdf' })).toBeVisible();

  await runCommand(page, 'PDF highlights');
  const dialog = page.getByRole('dialog', { name: 'Highlights in lecture.pdf' });
  await expect(dialog.getByRole('heading', { name: 'Yellow' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Page 1: hold water' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy as Markdown' }).click();
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  expect(markdown).toContain('# Highlights in lecture.pdf');
  expect(markdown).toContain('> hold water');
});

test('in the dark theme a PDF page is dimmed, and its switch shows the original', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'lecture.pdf', ['Night reading']);
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const picture = page.locator('[data-pdf-look]');
  await expect(picture).toHaveAttribute('data-pdf-look', 'dim');
  const filter = () => picture.locator('img').evaluate((img) => getComputedStyle(img).filter);
  await expect.poll(filter).toContain('brightness');

  const original = page.getByRole('button', { name: 'Original' });
  await original.focus();
  await original.press('Enter');
  await expect(picture).toHaveAttribute('data-pdf-look', 'original');
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(filter).toBe('none');

  await runCommand(page, 'Invert PDF pages in the dark theme');
  await expect(picture).toHaveAttribute('data-pdf-look', 'invert');
  await expect.poll(filter).toContain('invert');
});
