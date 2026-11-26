// Summarize this page: out of the palette until the person turns it on, then the key sentences and keywords, each sentence a way back to
// its place on the page.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openMembranes, runCommand, startWith } from '../intel';

const TEXT =
  'Cells make energy. The mitochondria is the powerhouse of the cell. Plants also use chloroplasts for light.';

async function typeOnPage(page: Page): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.type(TEXT);
  await expect(box).toHaveText(TEXT);
}

test('keeps Summarize this page out of the palette until summaries are on', async ({ page }) => {
  await openMembranes(page);
  await typeOnPage(page);
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await expect(box).toBeFocused();
  await box.fill('Summarize this page');
  await expect(page.getByRole('option', { name: /Summarize this page/i })).toHaveCount(0);
});

test('with the feature on, shows the key sentences and keywords', async ({ page }) => {
  await startWith(page, ['summaries']);
  await openMembranes(page);
  await typeOnPage(page);
  await runCommand(page, 'Summarize this page');
  const summary = page.getByRole('dialog', { name: 'Summary' });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('button', { name: 'Cells make energy.' })).toBeVisible();
  await expect(summary.getByRole('heading', { name: 'Keywords' })).toBeVisible();
  await summary.getByRole('button', { name: 'Close' }).click();
  await expect(summary).toHaveCount(0);
});

test('with the feature on, goes to the chosen sentence on the page', async ({ page }) => {
  await startWith(page, ['summaries']);
  await openMembranes(page);
  await typeOnPage(page);
  await runCommand(page, 'Summarize this page');
  const summary = page.getByRole('dialog', { name: 'Summary' });
  await summary.getByRole('button', { name: /mitochondria/ }).click();
  await expect(summary).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
});

test('tells a page with no text that there is nothing to summarize', async ({ page }) => {
  await startWith(page, ['summaries']);
  await openMembranes(page);
  await runCommand(page, 'Summarize this page');
  await expect(page.getByText("This page doesn't have enough text to summarize yet.")).toBeVisible();
});
