// Copy text from image: off until the person agrees, then the words found in the selected image reach the clipboard.
// The web platform's recognizer is a fake that answers "Sample text" for any image, so this checks the whole path
// from the image on the page to the clipboard, not the accuracy of recognition (the Rust crate's benchmarks do).

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openMembranes, runCommand, startWith } from '../intel';

/** Puts a small image on the page through Insert image, which leaves it selected. */
async function insertImage(page: Page): Promise<void> {
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 120, 40);
    context.fillStyle = '#000';
    context.fillRect(10, 10, 100, 20);
    return canvas.toDataURL('image/png');
  });
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Image…');
  await (
    await chooser
  ).setFiles({
    name: 'words.png',
    mimeType: 'image/png',
    buffer: Buffer.from(url.split(',')[1], 'base64'),
  });
  await expect(page.getByRole('group', { name: 'Image, no description' })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('offers to turn text recognition on, then copies the text in the image', async ({ page }) => {
  await openMembranes(page);
  await insertImage(page);
  await runCommand(page, 'Copy text from image');
  const offer = page.getByRole('dialog', { name: 'Turn on text in images?' });
  await expect(offer).toContainText('nothing leaves it.');
  await offer.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Copied the text.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Sample text');
});

test('copies at once when the feature is already on, from the image toolbar', async ({ page }) => {
  await startWith(page, ['ocr']);
  await openMembranes(page);
  await insertImage(page);
  await page.getByRole('button', { name: 'Copy text', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Copied the text.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Sample text');
});

test('leaves the clipboard alone when the person chooses not now', async ({ page }) => {
  await openMembranes(page);
  await insertImage(page);
  await page.evaluate(() => navigator.clipboard.writeText('before'));
  await runCommand(page, 'Copy text from image');
  await page.getByRole('dialog', { name: 'Turn on text in images?' }).getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
});
