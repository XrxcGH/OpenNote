// PDF pages to write on (A4-10) and note space (A2-20), on the web platform. pdf.js reads a small PDF made by the test,
// so this checks the whole path from the file chooser to locked page pictures.

import { expect, test } from '../fixtures';
import { openMembranes, runCommand } from '../intel';
import { insertPdf } from '../pdf';

test('Insert PDF puts each page on the page as a picture locked in place', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'lecture.pdf', ['Cell walls', 'Osmosis']);
  await expect(page.getByRole('group', { name: /Page 2 of 2 from lecture\.pdf/ })).toBeVisible();
  await expect(page.getByText('Added 2 pages of lecture.pdf to this page.')).toBeVisible();
});

test('Add note space puts ruled paper beside a PDF page', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'notes.pdf', ['Mitosis']);
  await runCommand(page, 'Add note space');
  const dialog = page.getByRole('dialog', { name: 'Add note space' });
  await dialog.getByRole('radio', { name: 'On the right and below' }).click();
  await dialog.getByRole('button', { name: 'Add note space' }).click();
  await expect(page.getByText('Added note space to 1 page.')).toBeVisible();
  await expect(page.getByRole('group', { name: /Ruled note space|Decorative image/ })).toHaveCount(2);
});

test('a damaged PDF is refused calmly and adds nothing', async ({ page }) => {
  await openMembranes(page);
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Insert PDF');
  await (await chooser).setFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByText('broken.pdf could not be read. It may be damaged or not a PDF.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('group', { name: /from broken\.pdf/ })).toHaveCount(0);
});
