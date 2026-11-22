// Apply and change styles, with the Format pane and the ruler: the pane's Paragraph tab sets an alignment, the
// ruler shows for the focused text, and a style change reaches the page.

import type { Page } from '@playwright/test';
import { expect, openNote, runCommand, selectParagraph, test } from './helpers';

test('the Format pane changes the paragraph it was opened on', async ({ page }) => {
  const box = await openNote(page);
  const paragraph = await selectParagraph(page, box, 'A few words');
  await runCommand(page, 'Format pane on Paragraph', /Format pane on Paragraph/);
  const pane = page.getByRole('region', { name: 'Format', exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('tablist', { name: 'Format sections' })).toBeVisible();
  await pane.getByRole('combobox', { name: 'Alignment' }).selectOption({ label: 'Center' });
  await expect(paragraph).toHaveCSS('text-align', 'center');
  await pane.getByRole('button', { name: 'Close' }).click();
  await expect(pane).toHaveCount(0);
  await expect(paragraph).toBeVisible();
});

test('the ruler shows over the focused text', async ({ page }) => {
  const box = await openNote(page);
  await selectParagraph(page, box, 'A few words');
  await runCommand(page, 'Ruler', /^Ruler/);
  await expect(page.getByLabel('Ruler', { exact: true }).first()).toBeVisible();
});

/** Opens the Styles pane and applies a built-in style to the selected paragraph. */
async function applyFromPane(page: Page, name: string): Promise<void> {
  await runCommand(page, 'Styles pane', /Show or hide the Styles pane/);
  const pane = page.getByRole('region', { name: 'Styles', exact: true });
  await expect(pane).toBeVisible();
  await pane.locator(`button[data-style-name="${name}"]`).click();
  await pane.getByRole('button', { name: 'Close' }).click();
  await expect(pane).toHaveCount(0);
}

test('applying Heading 2 from the Styles pane turns the paragraph into a heading', async ({ page }) => {
  const box = await openNote(page);
  await selectParagraph(page, box, 'A few words');
  await expect(box.locator('h2')).toHaveCount(0);
  await applyFromPane(page, 'h2');
  await expect(box.locator('h2', { hasText: 'A few words' })).toHaveCount(1);
  await expect(box.locator('p', { hasText: 'A few words' })).toHaveCount(0);
});

test('Update style to match selection changes every paragraph that uses the style', async ({ page }) => {
  const box = await openNote(page);
  const title = box.locator('h1', { hasText: 'Short note' });
  await expect(title).not.toHaveCSS('text-align', 'center');
  // Both paragraphs use Heading 1, then the second one is centered.
  await selectParagraph(page, box, 'A few words');
  await applyFromPane(page, 'h1');
  const second = box.locator('h1', { hasText: 'A few words' });
  await expect(second).toHaveCount(1);
  await second.click({ clickCount: 3 });
  await runCommand(page, 'Format pane on Paragraph', /Format pane on Paragraph/);
  const pane = page.getByRole('region', { name: 'Format', exact: true });
  await pane.getByRole('combobox', { name: 'Alignment' }).selectOption({ label: 'Center' });
  await expect(second).toHaveCSS('text-align', 'center');
  await expect(title).not.toHaveCSS('text-align', 'center');
  await pane.getByRole('button', { name: 'Close' }).click();
  await second.click({ clickCount: 3 });
  await runCommand(page, 'Update style to match', /Update style to match selection/);
  await expect(title).toHaveCSS('text-align', 'center');
});
