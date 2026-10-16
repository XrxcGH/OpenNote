// The pen library, ink layers, and links on handwriting on the web platform: the Width menu changes the pen a stroke
// is drawn with, a hidden layer is not drawn, and lassoed writing becomes a link that the list of links shows.
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { choose, draw, ellipse, heldStrokes, inkPixels, line, openPage } from '../ink';

async function command(page: Page, text: string, option: RegExp): Promise<void> {
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially(text, { delay: 10 });
  await page.getByRole('option', { name: option }).first().click();
}

test('draws with a calligraphy pen from the Width menu, and saves a pen set', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Indigo, 0.5 mm');
  await page.getByRole('button', { name: 'Width' }).click();
  await page.getByRole('menuitemradio', { name: 'Calligraphy pen' }).click();
  await expect(page.getByRole('button', { name: /^Calligraphy pen, Indigo/ })).toBeVisible();
  await draw(page, line([150, 350], [400, 330]));
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ tool: 6 })]);

  await page.getByRole('button', { name: 'Width' }).click();
  await page.getByRole('menuitem', { name: 'Save these pens as a set' }).click();
  await page.getByRole('textbox', { name: 'Name of the set' }).fill('Drawing');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Width' }).click();
  await expect(page.getByRole('menuitem', { name: 'Drawing', exact: true })).toBeVisible();
});

test('keeps ink on layers: a hidden layer is not drawn, and showing it brings the ink back', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([150, 350], [400, 350]));
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(100);
  const first = await inkPixels(page);

  await command(page, 'layers', /^Layers/);
  const dialog = page.getByRole('dialog', { name: 'Layers' });
  await dialog.getByRole('button', { name: 'Add a layer' }).click();
  await dialog.getByRole('listitem').first().getByRole('button', { name: 'Make active' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await draw(page, line([150, 420], [400, 420]));
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(first + 100);
  const both = await inkPixels(page);

  await command(page, 'layers', /^Layers/);
  await dialog.getByRole('listitem').first().getByRole('button', { name: 'Hide' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => inkPixels(page)).toBeLessThan(both - 100);

  await command(page, 'layers', /^Layers/);
  await dialog.getByRole('listitem').first().getByRole('button', { name: 'Show' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(both - 20);
});

test('makes lassoed writing a link to a web address, and lists it', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([150, 350], [400, 380]));
  await choose(page, 'Lasso select');
  await draw(page, ellipse(275, 365, 220, 90));
  const bar = page.getByRole('toolbar', { name: 'Selected ink and text' });
  await bar.getByRole('button', { name: 'Make link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make link' });
  await dialog.getByRole('radio', { name: 'A web address' }).click();
  const address = dialog.getByRole('textbox', { name: 'Web address' });
  await address.fill('https://example.com/notes');
  await dialog.getByRole('button', { name: 'Make link' }).click();
  await expect(dialog).toBeHidden();
  await expect(bar.getByRole('button', { name: 'Remove link' })).toBeVisible();

  await page.keyboard.press('Escape');
  await command(page, 'links on this page', /Links on this page/);
  const list = page.getByRole('dialog', { name: 'Links on this page' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('listitem')).toContainText('https://example.com/notes');
});

test('opens a page link on writing when the writing is clicked with Select and type', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([150, 350], [400, 380]));
  await choose(page, 'Lasso select');
  await draw(page, ellipse(275, 365, 220, 90));
  const bar = page.getByRole('toolbar', { name: 'Selected ink and text' });
  await bar.getByRole('button', { name: 'Make link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make link' });
  await dialog.getByRole('textbox', { name: 'Page title' }).fill('Mitosis');
  await dialog.getByRole('list', { name: 'Pages that match' }).getByRole('button', { name: 'Mitosis' }).click();
  await dialog.getByRole('button', { name: 'Make link' }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Escape');
  await choose(page, 'Select and type');
  const box = (await page.locator('[data-ink-overlay]').boundingBox())!;
  await page.mouse.click(box.x + 275, box.y + 365);
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
});
