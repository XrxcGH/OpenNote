// Scan cleanup on the page (A3-20), on the web platform: a photo of a tilted page drawn by the test is cleaned in place
// as one undo step, and several photos become a multi-page scan.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openMembranes, runCommand } from '../intel';

/** A photo of a white page with lines, tilted on a gray desk, as PNG bytes. */
async function photo(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 380;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#5f5f5f';
    context.fillRect(0, 0, 300, 380);
    context.fillStyle = '#f2f2f2';
    context.beginPath();
    context.moveTo(50, 30);
    context.lineTo(260, 45);
    context.lineTo(270, 350);
    context.lineTo(35, 335);
    context.closePath();
    context.fill();
    context.fillStyle = '#222';
    for (let y = 80; y < 300; y += 40) context.fillRect(80, y, 150, 6);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(url.split(',')[1], 'base64');
}

test('Clean up scan straightens the selected photo, and one undo brings it back', async ({ page }) => {
  await openMembranes(page);
  const bytes = await photo(page);
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Image…');
  await (await chooser).setFiles({ name: 'desk.png', mimeType: 'image/png', buffer: bytes });
  const image = page.getByRole('group', { name: 'Image, no description' });
  await expect(image).toBeVisible();
  const before = await image.locator('img').getAttribute('src');

  await runCommand(page, 'Clean up scan');
  const dialog = page.getByRole('dialog', { name: 'Clean up scan' });
  await expect(dialog.getByRole('img', { name: 'Preview of the cleaned page' })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Black and white' }).click();
  await dialog.getByRole('button', { name: 'Clean up' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => image.locator('img').getAttribute('src')).not.toBe(before);

  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => image.locator('img').getAttribute('src')).toBe(before);
});

test('Scan pages from photos adds each photo as a cleaned page', async ({ page }) => {
  await openMembranes(page);
  const bytes = await photo(page);
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Scan pages from photos');
  await (
    await chooser
  ).setFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: bytes },
    { name: 'two.png', mimeType: 'image/png', buffer: bytes },
  ]);
  const dialog = page.getByRole('dialog', { name: 'Clean up scan' });
  await expect(dialog).toContainText('Cleans 2 photos');
  await dialog.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('group', { name: 'Image: Scan, page 1' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Image: Scan, page 2' })).toBeVisible();
});

test('the page corners can be placed by hand, with a pointer or the arrow keys', async ({ page }) => {
  await openMembranes(page);
  const bytes = await photo(page);
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Image…');
  await (await chooser).setFiles({ name: 'desk.png', mimeType: 'image/png', buffer: bytes });
  const image = page.getByRole('group', { name: 'Image, no description' });
  await expect(image).toBeVisible();
  const before = await image.locator('img').getAttribute('src');

  await runCommand(page, 'Clean up scan');
  const dialog = page.getByRole('dialog', { name: 'Clean up scan' });
  await dialog.getByRole('button', { name: 'Adjust the corners' }).click();
  const corners = dialog.getByRole('group', { name: 'Page corners' });
  const topLeft = corners.getByRole('button', { name: /^Top left corner/ });
  await expect(topLeft).toBeVisible();
  const label = await topLeft.getAttribute('aria-label');

  // Keyboard: Shift+Right moves the corner 5% across.
  await topLeft.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(topLeft).not.toHaveAttribute('aria-label', label ?? '');

  // Pointer: drag the bottom right corner to the photo's bottom right, once the preview has redrawn and the dialog
  // stopped moving.
  const bottomRight = corners.getByRole('button', { name: /^Bottom right corner/ });
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await bottomRight.boundingBox());
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [250] },
    )
    .toBe(true);
  const box = (await corners.locator('img').boundingBox())!;
  const handle = (await bottomRight.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1, { steps: 4 });
  await page.mouse.up();
  await expect(bottomRight).toHaveAttribute('aria-label', /99% across, 99% down|100% across, 100% down/);

  await dialog.getByRole('button', { name: 'Clean up' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => image.locator('img').getAttribute('src')).not.toBe(before);
});
